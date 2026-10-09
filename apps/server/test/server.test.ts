import { replayHand, type Action } from '@mahjong/engine';
import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { Client, FAST, gameOver, isTable, playAsBot, startServer, type TableMsg } from './helpers';

describe('game server', () => {
  it('plays a full game against a client and logs replayable hands', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const client = await Client.connect(server);
    expect((await client.hello()).inGame).toBe(false);
    playAsBot(client);
    client.send({ type: 'startGame', options: { private: { handsPerGame: 3, baseScore: 2 } } });
    const final = await client.next(gameOver);

    expect(final.table.handsPerGame).toBe(3);
    expect(client.messages.some((m) => m.type === 'error')).toBe(false);
    expect(server.hands.logs).toHaveLength(3);
    expect(final.table.totals.reduce((a, b) => a + b, 0)).toBe(0);

    for (const log of server.hands.logs) {
      expect(log.sources).toContain('human');
      expect(log.sources).not.toContain('timeout');
      const replayed = replayHand(
        { ruleSet: log.ruleSet, baseScore: log.baseScore, seed: log.seed, dealer: log.dealer },
        log.actions,
      );
      expect(replayed.result).toEqual(log.result);
    }
  });

  it('times out an idle player, switches to auto-play after two timeouts, and finishes the game', async () => {
    const server = await startServer();
    const client = await Client.connect(server);
    await client.hello();
    client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 1 } } });
    const autoPlay = await client.next((m): m is TableMsg => isTable(m) && m.table.autoPlay);
    expect(autoPlay.table.timer).toBeNull();
    await client.next(gameOver);

    const log = server.hands.logs[0];
    expect(log.sources.filter((s) => s === 'timeout')).toHaveLength(2);
    expect(log.sources).toContain('autoPlay');
    log.actions.forEach((a: Action, i) => {
      if (log.sources[i] === 'timeout') expect(['hu', 'zimo', 'pong', 'kong', 'selfKong']).not.toContain(a.type);
    });
  });

  it('gives practice tables longer timers and one more timeout before auto-play', async () => {
    const server = await startServer({ ...FAST, practice: { timerScale: 2, autoPlayAfterTimeouts: 3 } });
    const client = await Client.connect(server);
    await client.hello();
    client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 1 } } });
    const first = await client.next(isTable);
    expect(first.table.timer).toMatchObject({ kind: 'swap', durationMs: FAST.timers.swapMs * 2 });
    await client.next(gameOver);

    const sources = server.hands.logs[0].sources;
    expect(sources.filter((s) => s === 'timeout')).toHaveLength(3);
    expect(sources).toContain('autoPlay');
  });

  it('switches the table to quick pace on request', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 60_000 } });
    const client = await Client.connect(server);
    await client.hello();
    client.send({ type: 'startGame' });
    expect((await client.next(isTable)).table.fastPace).toBe(false);
    client.send({ type: 'setFastPace', on: true });
    await client.next((m): m is TableMsg => isTable(m) && m.table.fastPace);
  });

  it('shows a countdown timer for the human decision', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 15_000 } });
    const client = await Client.connect(server);
    await client.hello();
    client.send({ type: 'startGame' });
    const first = await client.next(isTable);
    expect(first.table.view.phase).toBe('swap');
    expect(first.table.timer).toMatchObject({ kind: 'swap', durationMs: 15_000 });
    expect(first.table.view.players[1].hand).toBeNull();
  });

  it('keeps the game running after a disconnect and lets the player take control back', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 60_000, claimMs: 60_000, swapMs: 60_000, dingqueMs: 60_000 }, ai: { minDelayMs: 50, maxDelayMs: 60, beginnerExtraMs: 0 } });
    const a = await Client.connect(server);
    await a.hello('device-reconnect');
    a.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 8 } } });
    await a.next(isTable);
    a.close();

    const b = await Client.connect(server);
    const welcome = await b.hello('device-reconnect');
    expect(welcome.inGame).toBe(true);
    const resumed = await b.next((m): m is TableMsg => isTable(m) && m.table.autoPlay);
    expect(resumed.table.gameOver).toBe(false);
    b.send({ type: 'setAutoPlay', on: false });
    await b.next((m): m is TableMsg => isTable(m) && !m.table.autoPlay);
  });

  it('finishes an abandoned game without anyone connected', async () => {
    const server = await startServer();
    const client = await Client.connect(server);
    const { playerId } = await client.hello('device-leaver');
    client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 2 } } });
    await client.next(isTable);
    client.send({ type: 'leaveGame' });
    await client.next((m): m is Extract<ServerMessage, { type: 'left' }> => m.type === 'left');

    const deadline = Date.now() + 20_000;
    while (server.lobby.roomOf(playerId) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(server.lobby.roomOf(playerId)).toBeUndefined();
    expect(server.hands.logs).toHaveLength(2);
  });

  it('rejects bad input', async () => {
    // Slow AIs and a long timer keep the view version still while we probe.
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 60_000 }, ai: { minDelayMs: 60_000, maxDelayMs: 60_001, beginnerExtraMs: 0 } });
    const client = await Client.connect(server);
    const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';

    client.send({ type: 'startGame' });
    expect((await client.next(isError)).code).toBe('helloRequired');

    client.ws.send('not json');
    expect((await client.next(isError)).code).toBe('badMessage');

    await client.hello();
    client.send({ type: 'action', action: { type: 'pass' }, version: 0 });
    expect((await client.next(isError)).code).toBe('notInGame');

    client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 1 } } });
    const t = await client.next(isTable);
    client.send({ type: 'action', action: { type: 'discard', tile: 3 }, version: t.table.view.version });
    expect((await client.next(isError)).code).toBe('illegalAction');

    // Actions chosen from an outdated view are ignored, not rejected.
    client.send({ type: 'action', action: { type: 'discard', tile: 3 }, version: t.table.view.version + 5 });
    client.send({ type: 'setAutoPlay', on: true });
    await client.next((m): m is TableMsg => isTable(m) && m.table.autoPlay);
    expect(client.messages.filter(isError)).toHaveLength(4);
  });
});

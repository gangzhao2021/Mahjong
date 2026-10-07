import { chooseAction } from '@mahjong/ai-play';
import { replayHand, type Action } from '@mahjong/engine';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type TableSnapshot } from '@mahjong/protocol';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config';
import { Lobby } from '../src/lobby';
import { MemoryHandLogStore, MemoryPlayerStore } from '../src/store';

const FAST: ServerConfig = {
  ...DEFAULT_CONFIG,
  timers: { swapMs: 40, dingqueMs: 40, discardMs: 40, claimMs: 40, nextHandMs: 30, nextHandAutoPlayMs: 10 },
  autoPlayDelayMs: 0,
  ai: { minDelayMs: 0, maxDelayMs: 2, beginnerExtraMs: 1 },
};

interface TestServer {
  url: string;
  lobby: Lobby;
  hands: MemoryHandLogStore;
  close(): Promise<void>;
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function startServer(config = FAST): Promise<TestServer> {
  const hands = new MemoryHandLogStore();
  let seed = 1;
  const lobby = new Lobby({ config, hands, players: new MemoryPlayerStore(), seed: () => seed++ * 7919 });
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (s) => lobby.handleConnection(s));
  await new Promise<void>((r) => http.listen(0, r));
  const server: TestServer = {
    url: `ws://localhost:${(http.address() as AddressInfo).port}`,
    lobby,
    hands,
    close: async () => {
      lobby.closeAll();
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => http.close(r));
    },
  };
  servers.push(server);
  return server;
}

class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  onMessage: ((m: ServerMessage) => void) | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(m);
      this.onMessage?.(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
    return new Client(ws);
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  next<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 20_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for message; last: ${JSON.stringify(this.messages.slice(-3)).slice(0, 600)}`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  async hello(deviceId = 'device-test-1'): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    const welcome = this.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    this.send({ type: 'hello', deviceId, protocol: PROTOCOL_VERSION });
    return welcome;
  }

  close(): void {
    this.ws.close();
  }
}

type TableMsg = Extract<ServerMessage, { type: 'table' }>;
const isTable = (m: ServerMessage): m is TableMsg => m.type === 'table';
const gameOver = (m: ServerMessage): m is TableMsg => isTable(m) && m.table.gameOver;

/** A bot "human" that answers every decision with the expert policy. */
function playAsBot(client: Client): void {
  const acted = new Set<string>();
  const rng = Math.random;
  client.onMessage = (m) => {
    if (!isTable(m)) return;
    const t: TableSnapshot = m.table;
    if (t.view.phase === 'ended' && !t.gameOver) {
      client.send({ type: 'nextHand' });
      return;
    }
    const key = `${t.handIndex}:${t.view.version}`;
    if (acted.has(key)) return;
    const action = chooseAction(t.view, 'expert', rng);
    if (!action) return;
    acted.add(key);
    const { seat: _seat, ...rest } = action;
    client.send({ type: 'action', action: rest, version: t.view.version });
  };
}

describe('game server', () => {
  it('plays a full game against a client and logs replayable hands', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const client = await Client.connect(server.url);
    expect((await client.hello()).inGame).toBe(false);
    playAsBot(client);
    client.send({ type: 'startGame', options: { handsPerGame: 3, baseScore: 2 } });
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
    const client = await Client.connect(server.url);
    await client.hello();
    client.send({ type: 'startGame', options: { handsPerGame: 1 } });
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

  it('shows a countdown timer for the human decision', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 15_000 } });
    const client = await Client.connect(server.url);
    await client.hello();
    client.send({ type: 'startGame' });
    const first = await client.next(isTable);
    expect(first.table.view.phase).toBe('swap');
    expect(first.table.timer).toMatchObject({ kind: 'swap', durationMs: 15_000 });
    expect(first.table.view.players[1].hand).toBeNull();
  });

  it('keeps the game running after a disconnect and lets the player take control back', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 60_000, claimMs: 60_000, swapMs: 60_000, dingqueMs: 60_000 }, ai: { minDelayMs: 50, maxDelayMs: 60, beginnerExtraMs: 0 } });
    const a = await Client.connect(server.url);
    await a.hello('device-reconnect');
    a.send({ type: 'startGame', options: { handsPerGame: 8 } });
    await a.next(isTable);
    a.close();

    const b = await Client.connect(server.url);
    const welcome = await b.hello('device-reconnect');
    expect(welcome.inGame).toBe(true);
    const resumed = await b.next((m): m is TableMsg => isTable(m) && m.table.autoPlay);
    expect(resumed.table.gameOver).toBe(false);
    b.send({ type: 'setAutoPlay', on: false });
    await b.next((m): m is TableMsg => isTable(m) && !m.table.autoPlay);
  });

  it('finishes an abandoned game without anyone connected', async () => {
    const server = await startServer();
    const client = await Client.connect(server.url);
    const { playerId } = await client.hello('device-leaver');
    client.send({ type: 'startGame', options: { handsPerGame: 2 } });
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
    const client = await Client.connect(server.url);
    const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error';

    client.send({ type: 'startGame' });
    expect((await client.next(isError)).code).toBe('helloRequired');

    client.ws.send('not json');
    expect((await client.next(isError)).code).toBe('badMessage');

    await client.hello();
    client.send({ type: 'action', action: { type: 'pass' }, version: 0 });
    expect((await client.next(isError)).code).toBe('notInGame');

    client.send({ type: 'startGame', options: { handsPerGame: 1 } });
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

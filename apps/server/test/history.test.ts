import { replayHand } from '@mahjong/engine';
import type { CharacterRelation, HandHistoryEntry, HandReplay, PlayerStats } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { api, Client, FAST, gameOver, guestLogin, playAsBot, startServer } from './helpers';

describe('hand history, replay and stats', () => {
  it('lists my finished hands, replays one exactly, and counts them in my stats', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const token = await guestLogin(server, 'device-history');
    const client = await Client.connect(server);
    await client.helloWithToken(token);
    playAsBot(client);
    client.send({ type: 'startGame', options: { private: { handsPerGame: 2, baseScore: 0 } } });
    await client.next(gameOver);
    // Hand logs are saved without waiting for the database.
    await new Promise((r) => setTimeout(r, 200));

    const list = await api<{ hands: HandHistoryEntry[] }>(server, 'GET', '/history', undefined, token);
    expect(list.body.hands).toHaveLength(2);
    // Newest first.
    expect(list.body.hands.map((h) => h.handIndex)).toEqual([1, 0]);
    const entry = list.body.hands[1];
    expect(entry.seats[entry.mySeat].isHuman).toBe(true);
    expect(entry.deltas.reduce((a, b) => a + b, 0)).toBe(0);

    const replay = await api<HandReplay>(server, 'GET', `/history/${entry.gameId}/0`, undefined, token);
    const state = replayHand({ ruleSet: replay.body.ruleSet, baseScore: replay.body.baseScore, seed: replay.body.seed, dealer: replay.body.dealer }, replay.body.actions);
    expect(state.result?.deltas).toEqual(entry.deltas);

    // Someone else's hands are not reachable.
    const other = await guestLogin(server, 'device-history-other');
    expect((await api(server, 'GET', `/history/${entry.gameId}/0`, undefined, other)).status).toBe(404);
    expect((await api<{ hands: HandHistoryEntry[] }>(server, 'GET', '/history', undefined, other)).body.hands).toEqual([]);

    // The three AI opponents now count as table regulars.
    const regulars = await api<{ relations: CharacterRelation[] }>(server, 'GET', '/relationships', undefined, token);
    expect(regulars.body.relations).toHaveLength(3);
    for (const r of regulars.body.relations) expect(r).toMatchObject({ handsTogether: 2, name: expect.any(String), avatar: expect.any(String) });

    const stats = await api<PlayerStats>(server, 'GET', '/stats', undefined, token);
    expect(stats.body.handsPlayed).toBe(2);
    expect(stats.body.gamesPlayed).toBe(1);
  });
});

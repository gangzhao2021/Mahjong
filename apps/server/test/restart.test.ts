import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '../src/config';
import { openDb } from '../src/db/db';
import { Client, FAST, isTable, startServer, type TableMsg } from './helpers';

/** AI seats play instantly; the human seat waits, so the table is stable at the player's decisions. */
const PATIENT: ServerConfig = {
  ...FAST,
  timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000, discardMs: 60_000, claimMs: 60_000 },
  restoreGraceMs: 60_000,
};

const myTurn = (m: ServerMessage): m is TableMsg => isTable(m) && Object.keys(m.table.view.legal).length > 0;

describe('server restart (games in progress survive)', () => {
  it('restores the table exactly and lets the player continue', async () => {
    const db = await openDb({ dataDir: null });
    const first = await startServer(PATIENT, { db });
    const c1 = await Client.connect(first);
    await c1.hello('restart-device');
    c1.send({ type: 'startGame', options: { private: { handsPerGame: 2, baseScore: 1 } } });
    await c1.next(myTurn);
    await new Promise((r) => setTimeout(r, 200)); // AI seats finish their moves
    const before = c1.messages.filter(isTable).at(-1)!.table;
    await first.close();

    const second = await startServer(PATIENT, { db });
    const c2 = await Client.connect(second);
    const welcome = await c2.hello('restart-device');
    expect(welcome.inGame).toBe(true);
    const after = (await c2.next(myTurn)).table;
    expect(after.gameId).toBe(before.gameId);
    expect(after.view).toEqual(before.view);
    expect(after.seats).toEqual(before.seats);

    // Play goes on from where it stopped.
    const legal = after.view.legal;
    const action = legal.swapSuits ? { type: 'swap' as const, tiles: after.view.players[after.mySeat].hand!.filter((t) => Math.floor(t / 9) === legal.swapSuits![0]).slice(0, 3) } : { type: 'pass' as const };
    c2.send({ type: 'action', action, version: after.view.version } as never);
    const next = await c2.next((m): m is TableMsg => isTable(m) && m.table.view.version > after.view.version);
    expect(next.table.gameId).toBe(before.gameId);
    await second.close();
    await db.close();
  });

  it('finishes an abandoned restored game with auto-play and keeps the result for the next login', async () => {
    const db = await openDb({ dataDir: null });
    const first = await startServer(PATIENT, { db });
    const c1 = await Client.connect(first);
    await c1.hello('restart-away');
    c1.send({ type: 'startGame', options: { private: { handsPerGame: 1, baseScore: 1 } } });
    const before = (await c1.next(myTurn)).table;
    await first.close();

    const second = await startServer({ ...PATIENT, restoreGraceMs: 20 }, { db });
    const room = [...(second.lobby as unknown as { rooms: Map<string, { id: string; isClosed: boolean }> }).rooms.values()][0];
    expect(room.id).toBe(before.gameId);
    for (let i = 0; i < 200 && !room.isClosed; i++) await new Promise((r) => setTimeout(r, 25));
    expect(room.isClosed).toBe(true);
    await Promise.all([...second.lobby.settling]);

    const c2 = await Client.connect(second);
    const welcome = await c2.hello('restart-away');
    expect(welcome.inGame).toBe(false);
    const pending = await c2.next((m): m is Extract<ServerMessage, { type: 'pendingResult' }> => m.type === 'pendingResult');
    expect(pending.summary.gameId).toBe(before.gameId);
    expect(await db.query('SELECT 1 FROM active_games')).toHaveLength(0);
    await second.close();
    await db.close();
  });

  it('brings a friend room back with every player in their own seat', async () => {
    const db = await openDb({ dataDir: null });
    const first = await startServer(PATIENT, { db });
    const host = await Client.connect(first);
    await host.hello('restart-host');
    const friend = await Client.connect(first);
    await friend.hello('restart-friend');
    host.send({ type: 'createFriendRoom', handsPerGame: 2 });
    const created = await host.next((m): m is Extract<ServerMessage, { type: 'friendRoom' }> => m.type === 'friendRoom' && !!m.room);
    friend.send({ type: 'joinFriendRoom', code: created.room!.code });
    await host.next((m): m is Extract<ServerMessage, { type: 'friendRoom' }> => m.type === 'friendRoom' && m.room?.members.length === 2);
    host.send({ type: 'startFriendRoom' });
    const hostBefore = (await host.next(myTurn)).table;
    const friendBefore = (await friend.next(myTurn)).table;
    await new Promise((r) => setTimeout(r, 300)); // let the checkpoint write
    await first.close();

    const second = await startServer(PATIENT, { db });
    const h2 = await Client.connect(second);
    expect((await h2.hello('restart-host')).inGame).toBe(true);
    const f2 = await Client.connect(second);
    expect((await f2.hello('restart-friend')).inGame).toBe(true);
    const hostAfter = (await h2.next(isTable)).table;
    const friendAfter = (await f2.next(isTable)).table;
    expect(hostAfter.gameId).toBe(hostBefore.gameId);
    expect(friendAfter.gameId).toBe(hostBefore.gameId);
    expect([hostAfter.mySeat, friendAfter.mySeat]).toEqual([hostBefore.mySeat, friendBefore.mySeat]);
    expect(friendAfter.view.players[friendAfter.mySeat].hand).toEqual(friendBefore.view.players[friendBefore.mySeat].hand);
    expect(hostAfter.stake.kind).toBe('friend');
  });
});

import type { FriendRoomInfo, ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { Client, FAST, gameOver, isTable, playAsBot, startServer, type TableMsg } from './helpers';

type FriendMsg = Extract<ServerMessage, { type: 'friendRoom' }>;
type Rejected = Extract<ServerMessage, { type: 'friendRoomRejected' }>;
const isFriend = (m: ServerMessage): m is FriendMsg => m.type === 'friendRoom';
const isRejected = (m: ServerMessage): m is Rejected => m.type === 'friendRoomRejected';
const roomWith = (n: number) => (m: ServerMessage): m is FriendMsg => isFriend(m) && (m.room?.members.length ?? 0) === n;

const PATIENT = { ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } };

describe('friend rooms', () => {
  it('lets a friend join by number and plays a points-only game with both at the table', async () => {
    const server = await startServer(PATIENT);
    const host = await Client.connect(server);
    await host.hello('device-host');
    const friend = await Client.connect(server);
    await friend.hello('device-friend');

    host.send({ type: 'createFriendRoom', handsPerGame: 1 });
    const created = (await host.next(roomWith(1))).room as FriendRoomInfo;
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.members[0]).toMatchObject({ isHost: true, online: true });

    // Starting alone is refused; a wrong number is refused; the right one joins.
    host.send({ type: 'startFriendRoom' });
    expect((await host.next(isRejected)).reason).toBe('needFriend');
    friend.send({ type: 'joinFriendRoom', code: '000000' });
    expect((await friend.next(isRejected)).reason).toBe('notFound');
    friend.send({ type: 'joinFriendRoom', code: created.code });
    const joined = (await host.next(roomWith(2))).room!;
    expect(joined.members.map((m) => m.isHost)).toEqual([true, false]);
    await friend.next(roomWith(2));

    // Only the host can start.
    friend.send({ type: 'startFriendRoom' });
    expect((await friend.next(isRejected)).reason).toBe('notHost');

    playAsBot(host);
    playAsBot(friend);
    host.send({ type: 'startFriendRoom' });
    const hostTable = (await host.next(isTable)) as TableMsg;
    const friendTable = (await friend.next(isTable)) as TableMsg;
    expect(hostTable.table.mySeat).toBe(0);
    expect(friendTable.table.mySeat).toBe(1);
    expect(hostTable.table.stake).toMatchObject({ kind: 'friend', multiplier: 0, inviteCode: created.code });
    expect(hostTable.table.seats.filter((s) => s.isHuman)).toHaveLength(2);
    // Each sees only their own hand.
    expect(friendTable.table.view.players[0].hand).toBeNull();
    expect(friendTable.table.view.players[1].hand).not.toBeNull();

    const [hostEnd, friendEnd] = await Promise.all([host.next(gameOver), friend.next(gameOver)]);
    expect(hostEnd.table.totals).toEqual(friendEnd.table.totals);
    await Promise.all([...server.lobby.settling]);
    // Points only: nobody's coins moved.
    const ids = [...new Set(server.hands.logs.map((l) => l.playerId))];
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const ledger = await server.services.wallet.history(id);
      expect(ledger.filter((e) => e.type === 'handSettlement')).toEqual([]);
    }
    const summaries = await Promise.all([host, friend].map((c) => c.next((m): m is Extract<ServerMessage, { type: 'gameSummary' }> => m.type === 'gameSummary')));
    expect(summaries.map((s) => s.summary.mySeat)).toEqual([0, 1]);
  });

  it('auto-plays a friend who drops out while the others play on', async () => {
    const server = await startServer(PATIENT);
    const host = await Client.connect(server);
    await host.hello('device-host-2');
    const friend = await Client.connect(server);
    await friend.hello('device-friend-2');
    host.send({ type: 'createFriendRoom', handsPerGame: 1 });
    const { code } = (await host.next(roomWith(1))).room!;
    friend.send({ type: 'joinFriendRoom', code });
    await host.next(roomWith(2));

    playAsBot(host);
    host.send({ type: 'startFriendRoom' });
    await friend.next(isTable);
    friend.close();
    const end = await host.next(gameOver);
    expect(end.table.gameOver).toBe(true);
  });

  it('caps a room at four players and hands the host role on when the host leaves', async () => {
    const server = await startServer(PATIENT);
    const clients = await Promise.all([0, 1, 2, 3, 4].map(() => Client.connect(server)));
    await Promise.all(clients.map((c, i) => c.hello(`device-cap-${i}`)));
    clients[0].send({ type: 'createFriendRoom', handsPerGame: 4 });
    const { code } = (await clients[0].next(roomWith(1))).room!;
    for (const [i, c] of clients.slice(1, 4).entries()) {
      c.send({ type: 'joinFriendRoom', code });
      await clients[0].next(roomWith(i + 2));
    }
    clients[4].send({ type: 'joinFriendRoom', code });
    expect((await clients[4].next(isRejected)).reason).toBe('full');

    clients[0].send({ type: 'leaveFriendRoom' });
    const after = (await clients[1].next(roomWith(3))).room!;
    expect(after.members[0].isHost).toBe(true);
  });

  it.each([
    [3, [0, 1, 2]],
    [2, [0, 2]],
  ])('plays %i friends without AI on a two-suit table (两房)', async (n, seats) => {
    const server = await startServer(PATIENT);
    const clients = await Promise.all(Array.from({ length: n }, () => Client.connect(server)));
    await Promise.all(clients.map((c, i) => c.hello(`device-small-${n}-${i}`)));
    clients[0].send({ type: 'createFriendRoom', handsPerGame: 1 });
    const { code } = (await clients[0].next(roomWith(1))).room!;
    for (const [i, c] of clients.slice(1).entries()) {
      c.send({ type: 'joinFriendRoom', code });
      await clients[0].next(roomWith(i + 2));
    }
    for (const c of clients) playAsBot(c);
    clients[0].send({ type: 'startFriendRoom', fillWithAi: false });
    const tables = await Promise.all(clients.map((c) => c.next(isTable)));
    expect(tables.map((t) => t.table.mySeat)).toEqual(seats);
    const t = tables[0].table;
    expect(t.view.ruleSet.suits).toEqual([1, 2]);
    expect(t.view.phase).toBe('play');
    expect(t.seats.filter((s) => s.empty).length).toBe(4 - n);
    expect(t.seats.filter((s) => !s.empty && !s.isHuman)).toEqual([]);
    const ends = await Promise.all(clients.map((c) => c.next(gameOver)));
    const totals = ends[0].table.totals;
    expect(totals.reduce((a, b) => a + b, 0)).toBe(0);
    for (const seat of [0, 1, 2, 3]) if (!seats.includes(seat)) expect(totals[seat]).toBe(0);
  });
});

import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { ageOn, loadChinaConfig, minorWindowEnd, parseIdNumber } from '../src/china/compliance';
import { openDb } from '../src/db/db';
import { gameDay, loadEconomyConfig, type EconomyConfig } from '../src/economy/config';
import { Wallet } from '../src/economy/wallet';
import { api, Client, FAST, gameOver, guestLogin, isTable, playAsBot, startServer, type TableMsg } from './helpers';

type Rejected = Extract<ServerMessage, { type: 'startRejected' }>;
const isRejected = (m: ServerMessage): m is Rejected => m.type === 'startRejected';

describe('wallet and ledger (PRD §21)', () => {
  it('never goes negative, caps losses, and applies each settlement once', async () => {
    const db = await openDb({ dataDir: null });
    const wallet = new Wallet(db);
    await db.query("INSERT INTO players (id, nickname, avatar) VALUES ('p1', 'n', 'a')");
    await db.tx((q) => wallet.open(q, 'p1', 100));

    expect(await wallet.apply('p1', -30, 'handSettlement', 'g:0')).toMatchObject({ applied: -30, balance: 70, duplicate: false });
    expect(await wallet.apply('p1', -30, 'handSettlement', 'g:0')).toMatchObject({ applied: -30, balance: 70, duplicate: true });
    expect(await wallet.apply('p1', -500, 'handSettlement', 'g:1')).toMatchObject({ applied: -70, requested: -500, balance: 0 });
    expect(await wallet.apply('p1', 40, 'handSettlement', 'g:2')).toMatchObject({ applied: 40, balance: 40 });

    const history = await wallet.history('p1');
    expect(history.map((e) => [e.type, e.amount, e.balanceAfter])).toEqual([
      ['handSettlement', 40, 40],
      ['handSettlement', -70, 0],
      ['handSettlement', -30, 70],
      ['startingCoins', 100, 100],
    ]);
    await db.close();
  });
});

describe('login rewards (PRD §24)', () => {
  it('pays one claim per game day, keeps progress across missed days and restarts the cycle', async () => {
    let now = new Date('2026-10-07T00:00:00Z'); // 08:00 in UTC+8
    const server = await startServer(undefined, { now: () => now });
    const token = await guestLogin(server, 'device-reward');
    const claim = () => api(server, 'POST', '/rewards/claim', {}, token);

    expect((await claim()).body.amount).toBe(1000);
    expect((await claim()).body).toEqual({ error: 'alreadyClaimed' });
    now = new Date('2026-10-07T19:59:00Z'); // 03:59 next day in UTC+8: still the same game day
    expect((await claim()).status).toBe(409);
    now = new Date('2026-10-07T20:00:00Z'); // 04:00 UTC+8: new game day
    expect((await claim()).body.amount).toBe(1200);
    now = new Date('2026-10-20T00:00:00Z'); // missed many days: progress is kept
    expect((await claim()).body.amount).toBe(1500);

    const amounts = [];
    for (let d = 21; d <= 23; d++) {
      now = new Date(`2026-10-${d}T00:00:00Z`);
      amounts.push((await claim()).body.amount);
    }
    expect(amounts).toEqual([1500, 2000, 1000]); // cycle restarts after day 5
    const account = (await api(server, 'GET', '/account', undefined, token)).body.account;
    expect(account.balance).toBe(20000 + 1000 + 1200 + 1500 + 1500 + 2000 + 1000);
    expect(account.reward).toMatchObject({ dayIndex: 1, claimable: false, nextAmount: 1200 });
  });

  it('computes the game day with the configured reset hour', () => {
    const cfg = { rewardResetHour: 4, rewardUtcOffsetHours: 8 };
    expect(gameDay(new Date('2026-10-07T19:59:59Z'), cfg)).toBe('2026-10-07');
    expect(gameDay(new Date('2026-10-07T20:00:00Z'), cfg)).toBe('2026-10-08');
  });
});

describe('starting games (PRD §11–§13)', () => {
  it('enforces table minimums and private-room stake caps', async () => {
    const server = await startServer();
    const client = await Client.connect(server);
    await client.hello('device-start');

    client.send({ type: 'startGame', options: { tableId: 'high' } });
    expect(await client.next(isRejected)).toMatchObject({ reason: 'insufficientCoins', detail: '30000' });
    client.send({ type: 'startGame', options: { tableId: 'nope' } });
    expect((await client.next(isRejected)).reason).toBe('unknownTable');
    client.send({ type: 'startGame', options: { private: { baseScore: 201, handsPerGame: 4 } } });
    expect(await client.next(isRejected)).toMatchObject({ reason: 'baseTooHigh', detail: '200' }); // 1% of 20000
    client.send({ type: 'startGame', options: { private: { baseScore: 10, handsPerGame: 17 } } });
    expect((await client.next(isRejected)).reason).toBe('invalidOptions');
    client.send({ type: 'startGame', options: { private: { baseScore: 10, handsPerGame: 2, rules: { maxFan: 99 } } } });
    expect((await client.next(isRejected)).reason).toBe('invalidOptions');
  });

  it('applies whitelisted private-room rules and shows an invite code', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000 } });
    const client = await Client.connect(server);
    await client.hello('device-private');
    client.send({ type: 'startGame', options: { private: { baseScore: 200, handsPerGame: 2, rules: { huanSanZhang: false, maxFan: 6 } } } });
    const t = await client.next(isTable);
    expect(t.table.view.phase).toBe('dingque'); // no swap
    expect(t.table.view.ruleSet).toMatchObject({ maxFan: 6, handsPerGame: 2 });
    expect(t.table.stake).toMatchObject({ kind: 'private', baseScore: 200, multiplier: 1 });
    expect(t.table.stake.inviteCode).toMatch(/^\d{6}$/);
  });
});

describe('coin settlement', () => {
  it('settles every hand into the wallet and ledger at a public table', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5000, claimMs: 5000, swapMs: 5000, dingqueMs: 5000 } });
    const client = await Client.connect(server);
    const welcome = await client.hello('device-settle');
    playAsBot(client);
    client.send({ type: 'startGame', options: { tableId: 'low' } });
    const final = await client.next(gameOver);
    const summary = await client.next((m): m is Extract<ServerMessage, { type: 'gameSummary' }> => m.type === 'gameSummary');
    await Promise.all([...server.lobby.settling]);

    expect(final.table.stake).toMatchObject({ kind: 'public', tableId: 'low', baseScore: 10 });
    const walletMsgs = client.messages.filter((m): m is Extract<ServerMessage, { type: 'wallet' }> => m.type === 'wallet');
    const ledger = await server.services.wallet.history(welcome.playerId);
    const settlements = ledger.filter((e) => e.type === 'handSettlement');
    expect(settlements.length).toBe(walletMsgs.length);
    const total = settlements.reduce((a, e) => a + e.amount, 0);
    expect(summary.summary.coinChange).toBe(total);
    expect(summary.summary.handsPlayed).toBe(4);
    expect(await server.services.wallet.balance(welcome.playerId)).toBe(20000 + total);
    // Each hand's coins = points × multiplier (no cap needed with a full balance).
    for (const e of settlements) expect((e.meta as { points: number }).points * 1).toBe(e.amount);
  });

  it('the practice table never touches coins', async () => {
    const server = await startServer();
    const client = await Client.connect(server);
    const welcome = await client.hello('device-practice');
    client.send({ type: 'startGame', options: { tableId: 'practice' } });
    await client.next(gameOver);
    await Promise.all([...server.lobby.settling]);
    expect(await server.services.wallet.balance(welcome.playerId)).toBe(20000);
    expect(client.messages.some((m) => m.type === 'wallet')).toBe(false);
  });

  it('a player who cannot cover a loss pays only what they have (balance floor)', async () => {
    const economy: EconomyConfig = { ...loadEconomyConfig(), tables: [...loadEconomyConfig().tables, { id: 'whale', name: 'w', baseScore: 5000, minCoins: 0, multiplier: 1 }] };
    const server = await startServer(undefined, { economy });
    const client = await Client.connect(server);
    const welcome = await client.hello('device-floor');
    await server.services.db.query('UPDATE wallets SET balance = 1 WHERE player_id = $1', [welcome.playerId]);
    client.send({ type: 'startGame', options: { tableId: 'whale' } });
    await client.next(gameOver);
    await Promise.all([...server.lobby.settling]);
    const settlements = (await server.services.wallet.history(welcome.playerId)).filter((e) => e.type === 'handSettlement');
    for (const e of settlements) expect(e.balanceAfter).toBeGreaterThanOrEqual(0);
    expect(await server.services.wallet.balance(welcome.playerId)).toBeGreaterThanOrEqual(0);
  });

  it('shows the result of a game finished while away on the next login (PRD §14.1)', async () => {
    const server = await startServer();
    const a = await Client.connect(server);
    const welcome = await a.hello('device-away');
    a.send({ type: 'startGame', options: { tableId: 'low' } });
    await a.next(isTable);
    a.close();

    const deadline = Date.now() + 30_000;
    while (server.lobby.roomOf(welcome.playerId) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    await Promise.all([...server.lobby.settling]);

    const b = await Client.connect(server);
    expect((await b.hello('device-away')).inGame).toBe(false);
    const pending = await b.next((m): m is Extract<ServerMessage, { type: 'pendingResult' }> => m.type === 'pendingResult');
    expect(pending.summary).toMatchObject({ handsPlayed: 4, stake: { tableId: 'low' } });
    expect(pending.summary.coinChange + 20000).toBe(await server.services.wallet.balance(welcome.playerId));

    // Delivered once.
    const c = await Client.connect(server);
    await c.hello('device-away');
    await new Promise((r) => setTimeout(r, 100));
    expect(c.messages.some((m) => m.type === 'pendingResult')).toBe(false);
  });
});

/** Builds a valid resident ID number for a birth date (GB 11643 checksum). */
function idNumber(birth: string): string {
  const body = `110101${birth.replaceAll('-', '')}123`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((a, w, i) => a + w * Number(body[i]), 0);
  return body + '10X98765432'[sum % 11];
}

describe('China compliance (Appendix D)', () => {
  it('validates resident ID numbers', () => {
    expect(parseIdNumber(idNumber('1990-03-07'))).toBe('1990-03-07');
    expect(parseIdNumber(idNumber('1990-03-07').slice(0, 17) + '0')).toBeNull();
    expect(parseIdNumber('11010119900230123X')).toBeNull(); // Feb 30
    expect(ageOn('2008-10-08', new Date('2026-10-07T12:00:00Z'), 8)).toBe(17);
    expect(ageOn('2008-10-08', new Date('2026-10-07T16:00:00Z'), 8)).toBe(18); // already Oct 8 in UTC+8
  });

  it('knows the minor play windows', () => {
    const cfg = { ...loadChinaConfig(), holidays: ['2026-10-01'] };
    // Friday 2026-10-09 20:30 UTC+8
    expect(minorWindowEnd(new Date('2026-10-09T12:30:00Z'), cfg)?.toISOString()).toBe('2026-10-09T13:00:00.000Z');
    expect(minorWindowEnd(new Date('2026-10-09T13:00:00Z'), cfg)).toBeNull(); // 21:00 sharp
    expect(minorWindowEnd(new Date('2026-10-08T12:30:00Z'), cfg)).toBeNull(); // Thursday
    expect(minorWindowEnd(new Date('2026-10-01T12:30:00Z'), cfg)).not.toBeNull(); // Thursday, but a holiday
  });

  it('requires real-name verification, and limits minors to the allowed window', async () => {
    let now = new Date('2026-10-08T12:30:00Z'); // Thursday 20:30 UTC+8
    const server = await startServer(undefined, { region: 'china', now: () => now });
    const login = async (code: string) => {
      const token = (await api(server, 'POST', '/auth/wechat', { code })).body.token as string;
      const client = await Client.connect(server);
      await client.helloWithToken(token);
      return { token, client };
    };

    const adult = await login('adult');
    adult.client.send({ type: 'startGame', options: { tableId: 'practice' } });
    expect((await adult.client.next(isRejected)).reason).toBe('realNameRequired');
    expect((await api(server, 'POST', '/account/real-name', { name: '张三', idNumber: '110101199003071230' }, adult.token)).body).toEqual({ error: 'invalidIdNumber' });
    const verified = await api(server, 'POST', '/account/real-name', { name: '张三', idNumber: idNumber('1990-03-07') }, adult.token);
    expect(verified.body.account).toMatchObject({ realName: { required: true, verified: true }, playLimit: null });
    adult.client.send({ type: 'startGame', options: { tableId: 'practice' } });
    expect((await adult.client.next(isTable)).table.stake.tableId).toBe('practice');

    const minor = await login('minor');
    await api(server, 'POST', '/account/real-name', { name: '小明', idNumber: idNumber('2012-05-01') }, minor.token);
    minor.client.send({ type: 'startGame', options: { tableId: 'practice' } });
    expect((await minor.client.next(isRejected)).reason).toBe('minorTimeLimit');

    now = new Date('2026-10-09T12:30:00Z'); // Friday 20:30 UTC+8
    const account = (await api(server, 'GET', '/account', undefined, minor.token)).body.account;
    expect(account.playLimit).toEqual({ kind: 'minor', until: Date.parse('2026-10-09T13:00:00Z') });
    minor.client.send({ type: 'startGame', options: { tableId: 'practice' } });
    expect((await minor.client.next(isTable)).table.view.phase).toBe('swap');
  });

  it('limits guests to a one-hour trial per device per 15 days', async () => {
    let now = new Date('2026-10-07T00:00:00Z');
    const server = await startServer(undefined, { region: 'china', now: () => now });
    const token = await guestLogin(server, 'device-trial');
    const start = async () => {
      const client = await Client.connect(server);
      await client.helloWithToken(token);
      client.send({ type: 'startGame', options: { tableId: 'practice' } });
      return client.next((m): m is TableMsg | Rejected => isTable(m) || isRejected(m));
    };
    const first = await start();
    expect(first.type).toBe('table');
    // Leave and let auto-play finish that game, so the next start is a new game.
    const playerId = (await api(server, 'GET', '/account', undefined, token)).body.account.playerId;
    server.lobby.roomOf(playerId)!.leave();
    while (server.lobby.roomOf(playerId)) await new Promise((r) => setTimeout(r, 25));
    now = new Date('2026-10-07T01:01:00Z');
    expect(await start()).toMatchObject({ type: 'startRejected', reason: 'guestTrialOver' });
    now = new Date('2026-10-22T00:00:00Z'); // 15 days later
    expect((await start()).type).toBe('table');
  });
});

import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { hashPassword, totpCode, totpStep, verifyPassword, type AdminAuthConfig } from '../src/admin/auth';
import { LiveConfig } from '../src/admin/liveConfig';
import { openDb } from '../src/db/db';
import { loadDialogueConfig } from '../src/dialogueConfig';
import { DEFAULT_CONFIG } from '../src/config';
import { loadEconomyConfig } from '../src/economy/config';
import { NoLlm } from '../src/llm/provider';
import { api, Client, FAST, guestLogin, isTable, startServer, type TestServer } from './helpers';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 6238 test key "12345678901234567890"
const PASSWORD = 'correct horse battery staple';
const ADMIN: AdminAuthConfig = { username: 'boss', passwordHash: hashPassword(PASSWORD), totpSecret: SECRET, ipAllowlist: [], idleTimeoutMs: 8 * 3_600_000 };

/** Admin HTTP client that keeps the session cookie. */
class AdminClient {
  cookie = '';
  constructor(private readonly server: TestServer) {}

  async request<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.server.http}/admin/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
  }

  login(code: string, password = PASSWORD) {
    return this.request('POST', '/login', { username: 'boss', password, code });
  }
}

async function adminServer(now: () => Date = () => new Date(), dialogue = loadDialogueConfig('global'), config = FAST) {
  const server = await startServer(config, { admin: ADMIN, now, dialogue });
  const admin = new AdminClient(server);
  return { server, admin, code: () => totpCode(SECRET, totpStep(now().getTime())) };
}

describe('admin authentication (PRD §28)', () => {
  it('implements RFC 6238 TOTP and scrypt password hashes', () => {
    expect(totpCode(SECRET, 1)).toBe('287082'); // T = 59 s
    expect(totpCode(SECRET, 37037036)).toBe('081804'); // T = 1111111109 s
    expect(verifyPassword(PASSWORD, ADMIN.passwordHash)).toBe(true);
    expect(verifyPassword('wrong', ADMIN.passwordHash)).toBe(false);
  });

  it('requires password and TOTP, rejects replayed codes, and protects every route', async () => {
    const { admin, code } = await adminServer();
    expect((await admin.request('GET', '/players')).status).toBe(401);
    expect((await admin.login(code(), 'wrong password')).status).toBe(401);
    expect((await admin.login('000000')).status).toBe(401);

    const ok = await admin.login(code());
    expect(ok.status).toBe(200);
    expect(admin.cookie).toMatch(/^mahjong_admin=/);
    expect((await admin.request('GET', '/me')).status).toBe(200);

    const replay = new AdminClient((admin as unknown as { server: TestServer }).server);
    expect((await replay.login(code())).status).toBe(401); // same code twice

    await admin.request('POST', '/logout');
    expect((await admin.request('GET', '/me')).status).toBe(401);
  });

  it('locks out an address after repeated failures and expires idle sessions', async () => {
    let now = new Date('2026-10-07T00:00:00Z');
    const { admin, code } = await adminServer(() => now);
    for (let i = 0; i < 5; i++) await admin.login('000000');
    expect((await admin.login(code())).body).toEqual({ error: 'lockedOut' });

    now = new Date('2026-10-07T00:20:00Z'); // lockout over
    expect((await admin.login(code())).status).toBe(200);
    now = new Date('2026-10-07T09:00:00Z'); // 8 h idle
    expect((await admin.request('GET', '/me')).status).toBe(401);
  });

  it('is disabled when not configured', async () => {
    const server = await startServer();
    const res = await fetch(`${server.http}/admin/api/players`);
    expect(res.status).toBe(503);
  });
});

describe('players, coins and suspension (PRD §29–§31)', () => {
  it('lists and searches players', async () => {
    const { server, admin, code } = await adminServer();
    await guestLogin(server, 'device-admin-1');
    const token = await guestLogin(server, 'device-admin-2');
    await api(server, 'PATCH', '/account', { nickname: '雀神阿明' }, token);
    await admin.login(code());

    const all = await admin.request('GET', '/players');
    expect(all.body.total).toBe(2);
    const found = await admin.request('GET', `/players?q=${encodeURIComponent('雀神')}`);
    expect(found.body.players).toMatchObject([{ nickname: '雀神阿明', balance: 20000, providers: ['guest'], status: 'active' }]);
    expect((await admin.request('GET', '/players?provider=apple')).body.total).toBe(0);
  });

  it('adjusts coins with a required reason and keeps a full log', async () => {
    const { server, admin, code } = await adminServer();
    const token = await guestLogin(server, 'device-coins');
    const id = (await api(server, 'GET', '/account', undefined, token)).body.account.playerId;
    await admin.login(code());

    expect((await admin.request('POST', `/players/${id}/coins`, { amount: 500 })).body).toEqual({ error: 'reasonRequired' });
    expect((await admin.request('POST', `/players/${id}/coins`, { amount: 1.5, reason: 'x' })).body).toEqual({ error: 'invalidAmount' });
    expect((await admin.request('POST', `/players/${id}/coins`, { amount: 500, reason: '补偿掉线' })).body).toEqual({
      previousBalance: 20000,
      requested: 500,
      applied: 500,
      newBalance: 20500,
      reason: '补偿掉线',
    });
    // Removing more than the balance stops at zero (balance floor).
    expect((await admin.request('POST', `/players/${id}/coins`, { amount: -999999, reason: '测试扣除' })).body).toMatchObject({ applied: -20500, newBalance: 0 });

    const log = await admin.request('GET', '/coin-adjustments');
    expect(log.body.adjustments.map((a: { amount: number; reason: string; previousBalance: number }) => [a.amount, a.reason, a.previousBalance])).toEqual([
      [-20500, '测试扣除', 20500],
      [500, '补偿掉线', 20000],
    ]);
    const audit = await admin.request('GET', '/audit');
    expect(audit.body.entries.filter((e: { action: string }) => e.action === 'adjustCoins')).toHaveLength(2);
  });

  it('suspends a player, ending their sessions and live game, and unsuspends them', async () => {
    const { server, admin, code } = await adminServer();
    const client = await Client.connect(server);
    const welcome = await client.hello('device-ban');
    client.send({ type: 'startGame', options: { tableId: 'practice' } });
    await client.next(isTable);
    await admin.login(code());

    const closed = new Promise((r) => client.ws.once('close', r));
    expect((await admin.request('POST', `/players/${welcome.playerId}/suspend`, { duration: '7d', reason: '辱骂' })).status).toBe(200);
    expect(await client.next((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error')).toMatchObject({ code: 'unauthorized' });
    await closed;
    expect(server.lobby.roomOf(welcome.playerId)).toBeUndefined();
    expect((await api(server, 'POST', '/auth/guest', { deviceId: 'device-ban' })).body).toMatchObject({ error: 'suspended' });

    const detail = await admin.request('GET', `/players/${welcome.playerId}`);
    expect(detail.body.player).toMatchObject({ status: 'suspended', suspensionReason: '辱骂' });
    expect((await admin.request('POST', `/players/${welcome.playerId}/unsuspend`)).status).toBe(200);
    expect((await api(server, 'POST', '/auth/guest', { deviceId: 'device-ban' })).status).toBe(200);
  });
});

describe('analytics (PRD §33)', () => {
  it('reports daily signups, active players, coins and session length', async () => {
    const now = () => new Date();
    const { server, admin, code } = await adminServer(now);
    const client = await Client.connect(server);
    await client.hello('device-stats');
    await guestLogin(server, 'device-stats-2');
    client.close();
    await new Promise((r) => setTimeout(r, 100));
    await admin.login(code());

    const res = await admin.request('GET', '/analytics');
    expect(res.body.series).toHaveLength(7);
    const today = res.body.series[6];
    expect(today).toMatchObject({ newPlayers: 2, dau: 1, coinsIssued: 40000, sessions: 1 });
    expect(today.coinsIssuedByType).toEqual({ startingCoins: 40000 });
    expect(res.body.totals).toEqual({ players: 2, coinsInCirculation: 40000 });

    const range = await admin.request('GET', `/analytics?from=${res.body.from}&to=${res.body.to}`);
    expect(range.body.series).toHaveLength(7);
    expect((await admin.request('GET', '/analytics?from=2020-01-01&to=2026-01-01')).body).toEqual({ error: 'invalidRange' });
  });
});

describe('live configuration (PRD §34–§38)', () => {
  it('validates, applies immediately and audits economy changes', async () => {
    const { server, admin, code } = await adminServer();
    await admin.login(code());
    const config = (await admin.request('GET', '/config')).body;
    expect(config.economy.startingCoins).toBe(20000);

    const bad = await admin.request('PUT', '/config/economy', { ...config.economy, tables: config.economy.tables.filter((t: { id: string }) => t.id !== 'practice') });
    expect(bad.body.error).toBe('invalidConfig');
    expect(bad.body.problems).toContain('a practice table (base 0, min 0) is required (PRD §11)');

    expect((await admin.request('PUT', '/config/economy', { ...config.economy, startingCoins: 5000, loginRewards: [800] })).status).toBe(200);
    const fresh = await api(server, 'POST', '/auth/guest', { deviceId: 'device-after-change' });
    expect(fresh.body.account).toMatchObject({ balance: 5000, reward: { cycle: [800], nextAmount: 800 } });
    expect((await admin.request('GET', '/audit')).body.entries[0]).toMatchObject({ action: 'updateConfig', target: 'economy' });
  });

  it('updates quick phrases and AI settings for new connections and games', async () => {
    const { server, admin, code } = await adminServer();
    await admin.login(code());
    expect((await admin.request('PUT', '/config/quickPhrases', [{ id: 'hi', text: '大家好' }])).status).toBe(200);
    const client = await Client.connect(server);
    expect((await client.hello('device-qp')).catalog.quickPhrases).toEqual([{ id: 'hi', text: '大家好' }]);

    const settings = (await admin.request('GET', '/config')).body.dialogueSettings;
    expect((await admin.request('PUT', '/config/dialogueSettings', { ...settings, bluffIntensity: 2 })).body.problems).toEqual(['bluffIntensity must be 0–1']);
    expect((await admin.request('PUT', '/config/dialogueSettings', { ...settings, bluffIntensity: 0 })).status).toBe(200);
    expect((await admin.request('PUT', '/config/skillWeights', { beginner: 0, intermediate: 0, expert: 0 })).body.problems).toEqual(['at least one skill weight must be positive']);
  });

  it('manages personalities and characters, keeping at least three playable', async () => {
    const { server, admin, code } = await adminServer();
    await admin.login(code());
    const { personalities, characters } = (await admin.request('GET', '/roster')).body;
    const base = personalities[0];

    const created = await admin.request('PUT', '/personalities/grumpy', { ...base, name: '暴躁', weight: 10 });
    expect(created.body).toEqual({ ok: true });
    expect((await admin.request('PUT', '/characters/newbie', { name: '新角色', avatar: '🐲', personalityId: 'grumpy', weight: 5, enabled: true })).body).toEqual({ ok: true });
    const roster = (await admin.request('GET', '/roster')).body;
    expect(roster.characters.find((c: { id: string }) => c.id === 'newbie')).toMatchObject({ personalityId: 'grumpy' });
    expect((await admin.request('DELETE', '/personalities/grumpy')).body).toEqual({ error: 'personalityInUse' });
    expect((await admin.request('PUT', '/characters/bad', { name: 'x', avatar: '🐲', personalityId: 'missing', weight: 1, enabled: true })).body.error).toBe('invalidConfig');

    // Disabling all but two characters is refused.
    const disabled = characters.map((c: Record<string, unknown>, i: number) => ({ ...c, enabled: i < 2 }));
    for (const c of disabled.slice(2)) await admin.request('PUT', `/characters/${c.id}`, c);
    const last = await admin.request('PUT', '/characters/newbie', { name: '新角色', avatar: '🐲', personalityId: 'grumpy', weight: 5, enabled: false });
    expect(last.body.problems).toContain('at least 3 enabled characters with enabled personalities are required');

    // Re-enable the others, so deleting one still leaves enough to play.
    for (const c of characters) await admin.request('PUT', `/characters/${c.id}`, c);

    // Deleting a character deletes its memories.
    const token = await guestLogin(server, 'device-memory-admin');
    const playerId = (await api(server, 'GET', '/account', undefined, token)).body.account.playerId;
    await server.services.memory.recordHand(playerId, 'g', [{ characterId: 'newbie', characterWins: 1, playerWins: 0, dealtInByPlayer: 1, dealtInToPlayer: 0, pointsNet: 2, rivalryDelta: 0.1, grudge: null }], [], { dealIns: 1, wins: 0, selfDraws: 0, bigWins: 0, huaZhu: 0 });
    expect((await admin.request('DELETE', '/characters/newbie')).status).toBe(200);
    expect((await server.services.memory.view(playerId)).relationships).toEqual([]);
  });

  it('persists settings across restarts', async () => {
    const db = await openDb({ dataDir: null });
    const make = () => {
      const economy = loadEconomyConfig();
      return { economy, live: new LiveConfig(db, { region: 'global', economy, dialogue: loadDialogueConfig('global'), server: { ...DEFAULT_CONFIG, skillWeights: { ...DEFAULT_CONFIG.skillWeights } }, llm: new NoLlm() }) };
    };
    const first = make();
    await first.live.set('economy', { ...first.economy, startingCoins: 777 });
    const second = make();
    expect(second.economy.startingCoins).toBe(20000);
    await second.live.load();
    expect(second.economy.startingCoins).toBe(777);
    await db.close();
  });
});

describe('moderation queue (Appendix D.5)', () => {
  it('collects blocked player messages and reported AI lines', async () => {
    const dialogue = loadDialogueConfig('global');
    dialogue.chat = { ...dialogue.chat, minIntervalMs: 0 };
    // Slow AIs keep the table still, so the reply is not dropped as stale.
    const calm = { ...FAST, timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000 }, ai: { minDelayMs: 60_000, maxDelayMs: 60_001, beginnerExtraMs: 0 } };
    const { server, admin, code } = await adminServer(undefined, dialogue, calm);
    const client = await Client.connect(server);
    await client.hello('device-mod');
    client.send({ type: 'startGame', options: { tableId: 'practice' } });
    await client.next(isTable);

    // An addressed AI always answers; the player reports that line.
    client.send({ type: 'chat', text: '你好', target: 1 });
    const line = await client.next((m): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat' && m.entry.kind === 'ai' && !!m.entry.text);
    client.send({ type: 'reportLine', entryId: line.entry.id });
    await client.next((m): m is Extract<ServerMessage, { type: 'lineReported' }> => m.type === 'lineReported');

    client.send({ type: 'chat', text: '去死吧' });
    await client.next((m): m is Extract<ServerMessage, { type: 'chatRejected' }> => m.type === 'chatRejected');

    await admin.login(code());
    const events = (await admin.request('GET', '/moderation')).body.events;
    expect(events).toMatchObject([
      { kind: 'blockedPlayerMessage', text: '去死吧', reason: 'blocklist', status: 'open' },
      { kind: 'reportedAiLine', text: line.entry.text, status: 'open' },
    ]);
    expect(events[1].characterId).toBeTruthy();
    for (const e of events) expect((await admin.request('POST', `/moderation/${e.id}/resolve`)).status).toBe(200);
    expect((await admin.request('GET', '/moderation')).body.events).toEqual([]);
  });

  it('shows chat and login logs for a player on request and audits the access', async () => {
    const { server, admin, code } = await adminServer();
    const client = await Client.connect(server);
    const welcome = await client.hello('device-logs');
    await server.services.db.query("INSERT INTO chat_log (player_id, game_id, seat, kind, speaker, text) VALUES ($1, 'g1', 0, 'player', 'me', '你好')", [welcome.playerId]);
    await admin.login(code());

    const logs = await admin.request('GET', `/players/${welcome.playerId}/logs`);
    expect(logs.body.chat).toMatchObject([{ kind: 'player', text: '你好', gameId: 'g1' }]);
    expect(logs.body.logins).toMatchObject([{ method: 'guest' }]);
    const audit = await admin.request('GET', '/audit');
    expect(audit.body.entries.some((e: { action: string; target: string }) => e.action === 'viewLogs' && e.target === welcome.playerId)).toBe(true);
  });
});

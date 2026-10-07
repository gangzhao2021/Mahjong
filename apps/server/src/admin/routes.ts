/**
 * Admin API under /admin/api (PRD §28–§38). Every mutating call is written
 * to the admin audit log. Auth is a session cookie (HttpOnly, SameSite=Strict).
 */
import type { Character, Personality } from '@mahjong/dialogue';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Lobby } from '../lobby';
import type { Services } from '../services';
import type { AdminAuth } from './auth';
import { CONFIG_KEYS, ConfigError, type ConfigKey, type LiveConfig } from './liveConfig';

const COOKIE = 'mahjong_admin';

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

class AdminError extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

type Body = Record<string, unknown>;
const body = (req: FastifyRequest): Body => (req.body && typeof req.body === 'object' ? (req.body as Body) : {});

export interface AdminDeps {
  auth: AdminAuth | null;
  services: Services;
  lobby: Lobby;
  config: LiveConfig;
  /** Serve cookies with the Secure flag (production, behind HTTPS). */
  secureCookies: boolean;
}

export function registerAdminRoutes(app: FastifyInstance, d: AdminDeps): void {
  const s = d.services;
  const db = s.db;

  const audit = (req: FastifyRequest, action: string, target: string | null, detail: unknown) =>
    db.query('INSERT INTO admin_audit (action, target, detail, ip) VALUES ($1, $2, $3, $4)', [action, target, JSON.stringify(detail ?? null), req.ip]);

  void app.register(
    async (admin) => {
      admin.setErrorHandler((error, _req, reply) => {
        if (error instanceof AdminError) return reply.status(error.status).send({ error: error.code, ...error.extra });
        if (error instanceof ConfigError) return reply.status(400).send({ error: 'invalidConfig', problems: error.problems });
        if ((error as { statusCode?: number }).statusCode === 400) return reply.status(400).send({ error: 'badRequest' });
        console.error('Admin API error:', error);
        return reply.status(500).send({ error: 'serverError' });
      });

      // Everything except login needs a valid session.
      admin.addHook('preHandler', async (req) => {
        if (!d.auth) throw new AdminError(503, 'adminNotConfigured');
        if (req.routeOptions.url === '/admin/api/login') return;
        if (!(await d.auth.check(cookie(req, COOKIE), req.ip))) throw new AdminError(401, 'unauthorized');
      });

      admin.post('/login', async (req, reply: FastifyReply) => {
        const b = body(req);
        const result = await d.auth!.login(req.ip, b.username, b.password, b.code);
        if ('error' in result) {
          await audit(req, 'loginFailed', null, { reason: result.error });
          return reply.status(result.error === 'invalidCredentials' ? 401 : 403).send({ error: result.error });
        }
        await audit(req, 'login', null, null);
        const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/admin', d.secureCookies ? 'Secure' : ''].filter(Boolean).join('; ');
        reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(result.token)}; ${flags}`);
        return { ok: true };
      });

      admin.post('/logout', async (req, reply: FastifyReply) => {
        await d.auth!.logout(cookie(req, COOKIE));
        reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
        return { ok: true };
      });

      admin.get('/me', async () => ({ ok: true, region: s.region }));

      // ---------------------------------------------------------------- players
      admin.get('/players', async (req) => {
        const q = req.query as { q?: string; status?: string; provider?: string; sort?: string; page?: string };
        const sort = { created: 'p.created_at DESC', lastLogin: 'p.last_login_at DESC NULLS LAST', balance: 'w.balance DESC NULLS LAST' }[q.sort ?? 'created'] ?? 'p.created_at DESC';
        const page = Math.max(0, Number(q.page ?? 0) || 0);
        const rows = await db.query(
          `SELECT p.id, p.nickname, p.avatar, p.status, p.suspended_until, p.created_at, p.last_login_at, w.balance,
                  (SELECT array_agg(i.provider ORDER BY i.provider) FROM identities i WHERE i.player_id = p.id) AS providers,
                  count(*) OVER () AS total
           FROM players p LEFT JOIN wallets w ON w.player_id = p.id
           WHERE ($1 = '' OR p.id ILIKE '%' || $1 || '%' OR p.nickname ILIKE '%' || $1 || '%')
             AND ($2 = '' OR p.status = $2)
             AND ($3 = '' OR EXISTS (SELECT 1 FROM identities i WHERE i.player_id = p.id AND i.provider = $3))
           ORDER BY ${sort} LIMIT 50 OFFSET $4`,
          [q.q?.trim() ?? '', q.status ?? '', q.provider ?? '', page * 50],
        );
        return { players: rows.map(playerRow), total: Number(rows[0]?.total ?? 0), page };
      });

      admin.get('/players/:id', async (req) => {
        const { id } = req.params as { id: string };
        const rows = await db.query(
          `SELECT p.*, w.balance, (SELECT array_agg(i.provider ORDER BY i.provider) FROM identities i WHERE i.player_id = p.id) AS providers
           FROM players p LEFT JOIN wallets w ON w.player_id = p.id WHERE p.id = $1`,
          [id],
        );
        if (!rows.length) throw new AdminError(404, 'notFound');
        return {
          player: { ...playerRow(rows[0]), suspensionReason: rows[0].suspension_reason ?? null, realNameVerified: rows[0].real_name_verified },
          ledger: await s.wallet.history(id, 50),
          memory: await s.memory.view(id),
        };
      });

      /** Manual coin adjustment (PRD §30): amount and reason required, always logged. */
      admin.post('/players/:id/coins', async (req) => {
        const { id } = req.params as { id: string };
        const b = body(req);
        const amount = Number(b.amount);
        const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000_000) throw new AdminError(400, 'invalidAmount');
        if (!reason) throw new AdminError(400, 'reasonRequired');
        if (!(await s.accounts.get(id))) throw new AdminError(404, 'notFound');
        const previous = await s.wallet.balance(id);
        const change = await s.wallet.apply(id, amount, 'adminAdjustment', null, { reason, previousBalance: previous });
        const entry = { previousBalance: previous, requested: amount, applied: change.applied, newBalance: change.balance, reason };
        await audit(req, 'adjustCoins', id, entry);
        return entry;
      });

      admin.get('/coin-adjustments', async () => {
        const rows = await db.query(
          `SELECT l.id, l.player_id, p.nickname, l.amount, l.balance_after, l.meta, l.created_at
           FROM ledger l LEFT JOIN players p ON p.id = l.player_id
           WHERE l.type = 'adminAdjustment' ORDER BY l.id DESC LIMIT 200`,
        );
        return {
          adjustments: rows.map((r) => {
            const meta = (r.meta ?? {}) as { reason?: string; previousBalance?: number };
            return {
              id: Number(r.id),
              playerId: r.player_id,
              nickname: r.nickname ?? null,
              previousBalance: meta.previousBalance ?? null,
              amount: Number(r.amount),
              newBalance: Number(r.balance_after),
              reason: meta.reason ?? '',
              createdAt: iso(r.created_at),
            };
          }),
        };
      });

      /** Suspension (PRD §31): temporary or permanent; the reason is optional and never shown to the player. */
      admin.post('/players/:id/suspend', async (req) => {
        const { id } = req.params as { id: string };
        const b = body(req);
        const hours = b.duration === 'permanent' ? null : b.duration === '1d' ? 24 : b.duration === '7d' ? 168 : Number(b.hours);
        if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 3650)) throw new AdminError(400, 'invalidDuration');
        const until = hours === null ? null : new Date(s.now().getTime() + hours * 3_600_000);
        const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : null;
        const rows = await db.query(
          "UPDATE players SET status = 'suspended', suspended_until = $2, suspension_reason = $3, token_version = token_version + 1 WHERE id = $1 RETURNING id",
          [id, until, reason],
        );
        if (!rows.length) throw new AdminError(404, 'notFound');
        // Existing sessions are invalid now; also take the player out of any live game.
        d.lobby.kick(id);
        await audit(req, 'suspend', id, { until: until?.toISOString() ?? 'permanent', reason });
        return { ok: true, until: until?.toISOString() ?? null };
      });

      admin.post('/players/:id/unsuspend', async (req) => {
        const { id } = req.params as { id: string };
        const rows = await db.query("UPDATE players SET status = 'active', suspended_until = NULL, suspension_reason = NULL WHERE id = $1 RETURNING id", [id]);
        if (!rows.length) throw new AdminError(404, 'notFound');
        await audit(req, 'unsuspend', id, null);
        return { ok: true };
      });

      // ----------------------------------------------------------------- memory
      admin.post('/players/:id/memory/reset', async (req) => {
        const { id } = req.params as { id: string };
        const characterId = body(req).characterId;
        if (typeof characterId === 'string' && characterId) await s.memory.resetPair(characterId, id);
        else await s.memory.resetPlayer(id);
        await audit(req, 'resetMemory', id, { characterId: characterId ?? 'all' });
        return { ok: true };
      });

      // -------------------------------------------------------------- analytics
      admin.get('/analytics', async (req) => {
        const q = req.query as { from?: string; to?: string };
        return analytics(s, q.from, q.to);
      });

      // ----------------------------------------------------------------- config
      admin.get('/config', async () => Object.fromEntries(CONFIG_KEYS.map((k) => [k, d.config.get(k)])));

      admin.put('/config/:key', async (req) => {
        const { key } = req.params as { key: string };
        if (!CONFIG_KEYS.includes(key as ConfigKey) || key === 'personalities' || key === 'characters') throw new AdminError(404, 'unknownKey');
        const before = d.config.get(key as ConfigKey);
        await d.config.set(key as ConfigKey, req.body as never);
        await audit(req, 'updateConfig', key, { before, after: req.body });
        return { ok: true, value: d.config.get(key as ConfigKey) };
      });

      // ------------------------------------------------- personalities & roster
      admin.get('/roster', async () => ({ personalities: d.config.get('personalities'), characters: d.config.get('characters') }));

      admin.put('/personalities/:id', async (req) => {
        const { id } = req.params as { id: string };
        const p = { ...(req.body as Personality), id };
        const list = d.config.get('personalities');
        const i = list.findIndex((x) => x.id === id);
        const before = i >= 0 ? list[i] : null;
        if (i >= 0) list[i] = p;
        else list.push(p);
        await d.config.setRoster(list, d.config.get('characters'));
        await audit(req, before ? 'updatePersonality' : 'createPersonality', id, { before, after: p });
        return { ok: true };
      });

      admin.delete('/personalities/:id', async (req) => {
        const { id } = req.params as { id: string };
        const characters = d.config.get('characters');
        if (characters.some((c) => c.personalityId === id)) throw new AdminError(409, 'personalityInUse');
        const list = d.config.get('personalities').filter((p) => p.id !== id);
        await d.config.setRoster(list, characters);
        await audit(req, 'deletePersonality', id, null);
        return { ok: true };
      });

      admin.put('/characters/:id', async (req) => {
        const { id } = req.params as { id: string };
        const c = { ...(req.body as Character), id };
        const list = d.config.get('characters');
        const i = list.findIndex((x) => x.id === id);
        const before = i >= 0 ? list[i] : null;
        if (i >= 0) list[i] = c;
        else list.push(c);
        await d.config.setRoster(d.config.get('personalities'), list);
        await audit(req, before ? 'updateCharacter' : 'createCharacter', id, { before, after: c });
        return { ok: true };
      });

      /** Deleting a character also deletes everything it remembers (Appendix B.4). */
      admin.delete('/characters/:id', async (req) => {
        const { id } = req.params as { id: string };
        const list = d.config.get('characters').filter((c) => c.id !== id);
        await d.config.setRoster(d.config.get('personalities'), list);
        await s.memory.deleteCharacter(id);
        await audit(req, 'deleteCharacter', id, null);
        return { ok: true };
      });

      // ------------------------------------------------------------- moderation
      admin.get('/moderation', async (req) => {
        const status = (req.query as { status?: string }).status ?? 'open';
        const rows = await db.query(
          `SELECT m.*, p.nickname FROM moderation_events m LEFT JOIN players p ON p.id = m.player_id
           WHERE ($1 = 'all' OR m.status = $1) ORDER BY m.id DESC LIMIT 200`,
          [status],
        );
        return {
          events: rows.map((r) => ({
            id: Number(r.id),
            kind: r.kind,
            playerId: r.player_id,
            nickname: r.nickname ?? null,
            characterId: r.character_id,
            text: r.text,
            reason: r.reason,
            status: r.status,
            createdAt: iso(r.created_at),
          })),
        };
      });

      admin.post('/moderation/:id/resolve', async (req) => {
        const { id } = req.params as { id: string };
        await db.query("UPDATE moderation_events SET status = 'resolved' WHERE id = $1", [Number(id)]);
        await audit(req, 'resolveModeration', id, null);
        return { ok: true };
      });

      admin.get('/audit', async () => {
        const rows = await db.query('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 200');
        return { entries: rows.map((r) => ({ id: Number(r.id), action: r.action, target: r.target, detail: r.detail, ip: r.ip, createdAt: iso(r.created_at) })) };
      });
    },
    { prefix: '/admin/api' },
  );
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function playerRow(r: Record<string, unknown>) {
  const until = r.suspended_until ? new Date(r.suspended_until as string) : null;
  const suspended = r.status === 'suspended' && (until === null || until > new Date());
  return {
    id: r.id,
    nickname: r.nickname,
    avatar: r.avatar,
    balance: Number(r.balance ?? 0),
    providers: (r.providers as string[] | null) ?? [],
    status: suspended ? 'suspended' : 'active',
    suspendedUntil: suspended ? iso(r.suspended_until) : null,
    createdAt: iso(r.created_at),
    lastLoginAt: iso(r.last_login_at),
  };
}

/** Daily product metrics (PRD §33) in the game's time zone. */
export async function analytics(s: Services, from?: string, to?: string) {
  const offset = s.economy.rewardUtcOffsetHours;
  const day = (d: Date) => new Date(d.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const toDay = valid(to) ?? day(s.now());
  const fromDay = valid(from) ?? day(new Date(Date.parse(`${toDay}T00:00:00Z`) - 6 * 86_400_000));
  const start = new Date(Date.parse(`${fromDay}T00:00:00Z`) - offset * 3_600_000);
  const end = new Date(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000 - offset * 3_600_000);
  if (!(start < end) || end.getTime() - start.getTime() > 366 * 86_400_000) throw new AdminError(400, 'invalidRange');

  const bucket = (col: string) => `to_char(((${col}) AT TIME ZONE 'UTC') + make_interval(hours => ${Number(offset)}), 'YYYY-MM-DD')`;
  const db = s.db;
  const [dau, signups, coins, sessions] = await Promise.all([
    db.query<{ day: string; n: string }>(
      `SELECT ${bucket('started_at')} AS day, count(DISTINCT player_id) AS n FROM play_sessions WHERE started_at >= $1 AND started_at < $2 GROUP BY 1`,
      [start, end],
    ),
    db.query<{ day: string; n: string }>(`SELECT ${bucket('created_at')} AS day, count(*) AS n FROM players WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`, [start, end]),
    db.query<{ day: string; type: string; private: boolean; issued: string; consumed: string }>(
      `SELECT ${bucket('created_at')} AS day, type, COALESCE(meta->'stake'->>'kind', '') = 'private' AS private,
              COALESCE(sum(amount) FILTER (WHERE amount > 0), 0) AS issued,
              COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0) AS consumed
       FROM ledger WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2, 3`,
      [start, end],
    ),
    db.query<{ day: string; minutes: string; n: string }>(
      `SELECT ${bucket('started_at')} AS day, avg(extract(epoch FROM ended_at - started_at)) / 60 AS minutes, count(*) AS n
       FROM play_sessions WHERE started_at >= $1 AND started_at < $2 AND ended_at IS NOT NULL GROUP BY 1`,
      [start, end],
    ),
  ]);

  const days: string[] = [];
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= Date.parse(`${toDay}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const series = days.map((d) => {
    const c = coins.filter((r) => r.day === d);
    const sum = (rows: typeof c, key: 'issued' | 'consumed') => rows.reduce((a, r) => a + Number(r[key]), 0);
    const byType: Record<string, number> = {};
    for (const r of c) byType[r.type] = (byType[r.type] ?? 0) + Number(r.issued);
    const sess = sessions.find((r) => r.day === d);
    return {
      day: d,
      dau: Number(dau.find((r) => r.day === d)?.n ?? 0),
      newPlayers: Number(signups.find((r) => r.day === d)?.n ?? 0),
      coinsIssued: sum(c, 'issued'),
      coinsConsumed: sum(c, 'consumed'),
      coinsIssuedByType: byType,
      privateRoomIssued: sum(c.filter((r) => r.private), 'issued'),
      avgSessionMinutes: sess ? Math.round(Number(sess.minutes) * 10) / 10 : 0,
      sessions: Number(sess?.n ?? 0),
    };
  });
  const [totals] = await db.query<{ players: string; coins: string }>('SELECT (SELECT count(*) FROM players) AS players, (SELECT COALESCE(sum(balance), 0) FROM wallets) AS coins');
  return { from: fromDay, to: toDay, series, totals: { players: Number(totals.players), coinsInCirculation: Number(totals.coins) } };
}

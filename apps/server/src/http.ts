/**
 * HTTP API for accounts and economy. Gameplay stays on the WebSocket.
 * All auth is `Authorization: Bearer <session token>`.
 */
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalPage } from './legal';
import { registerAdminRoutes, type AdminDeps } from './admin/routes';
import type { Moderator } from '@mahjong/dialogue';
import { BANTER_LEVELS } from '@mahjong/dialogue';
import type { LoginMethod } from '@mahjong/protocol';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHmac } from 'node:crypto';
import { AccountSuspendedError, PLAYER_AVATARS, type PlayerRow, type Provider } from './accounts/accounts';
import { exchangeWechatCode, LoginError, verifyAppleIdToken, verifyGoogleIdToken } from './accounts/providers';
import { hashIdNumber, parseIdNumber } from './china/compliance';
import { AlreadyClaimedError } from './economy/rewards';
import type { Lobby } from './lobby';
import { accountSummary, loginMethods, serverInfo, type Services } from './services';

/** Identity checks, injectable so tests don't call Apple / Google / WeChat. */
export interface IdentityVerifiers {
  apple(identityToken: unknown): Promise<string>;
  google(idToken: unknown): Promise<string>;
  wechat(code: unknown): Promise<string>;
}

export function defaultVerifiers(s: Services): IdentityVerifiers {
  return {
    apple: async (t) => (await verifyAppleIdToken(t, s.auth.appleClientIds)).subject,
    google: async (t) => (await verifyGoogleIdToken(t, s.auth.googleClientIds)).subject,
    wechat: async (c) => (await exchangeWechatCode(c, s.auth.wechat)).subject,
  };
}

type Body = Record<string, unknown>;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

export interface HttpOptions {
  verifiers?: IdentityVerifiers;
  /** Admin API + dashboard (PRD §28); omitted in some tests. */
  admin?: Omit<AdminDeps, 'services' | 'lobby'>;
  /** Trust X-Forwarded-For from the reverse proxy (needed for the admin IP allowlist). */
  trustProxy?: boolean;
}

const ADMIN_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../admin/dist');

export function buildHttp(s: Services, lobby: Lobby, moderator: Moderator, options: HttpOptions = {}): FastifyInstance {
  const verifiers = options.verifiers ?? defaultVerifiers(s);
  const app = Fastify({ bodyLimit: 16 * 1024, logger: false, trustProxy: options.trustProxy ?? false });
  // The game API is called from the app / web client on other origins. Admin routes rely on a
  // SameSite=Strict cookie and are never readable cross-origin (no credentials are allowed).
  void app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });

  if (options.admin) {
    registerAdminRoutes(app, { ...options.admin, services: s, lobby });
    if (existsSync(ADMIN_DIST)) {
      void app.register(fastifyStatic, { root: ADMIN_DIST, prefix: '/admin/', decorateReply: false });
      app.get('/admin', (_req, reply) => reply.redirect('/admin/'));
    }
  }

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.status(error.status).send({ error: error.code, ...error.extra });
    if (error instanceof LoginError) return reply.status(error.code === 'notConfigured' ? 503 : 400).send({ error: error.code });
    if (error instanceof AccountSuspendedError) return reply.status(403).send({ error: 'suspended', until: error.until?.getTime() ?? null });
    if ((error as { validation?: unknown }).validation || (error as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({ error: 'badRequest' });
    }
    console.error('HTTP error:', error);
    return reply.status(500).send({ error: 'serverError' });
  });

  const body = (req: FastifyRequest): Body => (req.body && typeof req.body === 'object' ? (req.body as Body) : {});

  const requirePlayer = async (req: FastifyRequest): Promise<PlayerRow> => {
    const header = req.headers.authorization ?? '';
    const player = await s.accounts.authenticate(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!player) throw new HttpError(401, 'unauthorized');
    return player;
  };

  /** Turns login credentials into a verified (provider, subject). */
  const resolveIdentity = async (method: unknown, b: Body): Promise<{ provider: Provider; subject: string; secret: string | null }> => {
    if (!loginMethods(s.region).includes(method as LoginMethod)) throw new HttpError(400, 'methodUnavailable');
    switch (method as LoginMethod) {
      case 'guest': {
        const deviceId = b.deviceId;
        if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 128) throw new HttpError(400, 'badRequest');
        return { provider: 'guest', subject: deviceId, secret: null };
      }
      case 'apple': {
        const subject = await verifiers.apple(b.identityToken);
        // Keep a refresh token so the account's Apple authorization can be revoked on deletion.
        const secret = s.auth.apple && typeof b.authorizationCode === 'string' ? await s.auth.apple.exchange(b.authorizationCode) : null;
        return { provider: 'apple', subject, secret };
      }
      case 'google':
        return { provider: 'google', subject: await verifiers.google(b.idToken), secret: null };
      case 'wechat':
        return { provider: 'wechat', subject: await verifiers.wechat(b.code), secret: null };
      case 'phone': {
        const phone = await s.sms.verify(b.phone, b.code);
        // Store a keyed hash, not the phone number itself.
        return { provider: 'phone', subject: createHmac('sha256', s.auth.idHashSecret).update(phone).digest('hex'), secret: null };
      }
    }
  };

  const respond = async (player: PlayerRow, token?: string) => ({ ...(token ? { token } : {}), account: await accountSummary(s, player) });

  app.get('/health', async () => ({ ok: true }));

  /** Client crash reports; the session is optional (crashes can happen before login). */
  app.post('/telemetry/errors', async (req, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const player = header.startsWith('Bearer ') ? await s.accounts.authenticate(header.slice(7)).catch(() => null) : null;
    const accepted = await s.crashes.record(req.ip, player?.id ?? null, req.body);
    return reply.status(accepted ? 202 : 429).send({ ok: accepted });
  });
  app.get('/config', async () => serverInfo(s));

  for (const name of ['privacy', 'terms', 'sdks'] as const) {
    app.get(`/legal/${name}`, (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPage(name, s.region)));
  }

  app.post('/auth/:method', async (req) => {
    const { method } = req.params as { method: string };
    const identity = await resolveIdentity(method, body(req));
    const { player, token } = await s.accounts.login(identity.provider, identity.subject, identity.secret);
    return respond(player, token);
  });

  app.post('/auth/sms/send', async (req) => {
    if (!loginMethods(s.region).includes('phone')) throw new HttpError(400, 'methodUnavailable');
    await s.sms.send(body(req).phone);
    return { ok: true };
  });

  app.get('/account', async (req) => respond(await requirePlayer(req)));

  app.patch('/account', async (req) => {
    const player = await requirePlayer(req);
    const b = body(req);
    const patch: { nickname?: string; avatar?: string; banterLevel?: PlayerRow['banter_level'] } = {};
    if (b.nickname !== undefined) {
      const nickname = typeof b.nickname === 'string' ? b.nickname.trim() : '';
      if ([...nickname].length < 2 || [...nickname].length > 12) throw new HttpError(400, 'invalidNickname');
      if (!(await moderator.check(nickname, 'nickname')).allowed) throw new HttpError(400, 'nicknameRejected');
      patch.nickname = nickname;
    }
    if (b.avatar !== undefined) {
      if (!PLAYER_AVATARS.includes(b.avatar as string)) throw new HttpError(400, 'invalidAvatar');
      patch.avatar = b.avatar as string;
    }
    if (b.banterLevel !== undefined) {
      if (!BANTER_LEVELS.includes(b.banterLevel as never)) throw new HttpError(400, 'badRequest');
      patch.banterLevel = b.banterLevel as PlayerRow['banter_level'];
    }
    return respond(await s.accounts.updateProfile(player.id, patch));
  });

  /** Guest upgrade (PRD §19): attach another login method to this same account. */
  app.post('/account/link/:method', async (req) => {
    const player = await requirePlayer(req);
    const { method } = req.params as { method: string };
    if (method === 'guest') throw new HttpError(400, 'methodUnavailable');
    const identity = await resolveIdentity(method, body(req));
    const result = await s.accounts.link(player.id, identity.provider, identity.subject, identity.secret);
    if (result.status === 'conflict') throw new HttpError(409, 'identityInUse');
    return respond((await s.accounts.get(player.id))!);
  });

  /** Real-name verification (China build, Appendix D.2). Only a keyed hash of the ID is stored. */
  app.post('/account/real-name', async (req) => {
    const player = await requirePlayer(req);
    if (s.region !== 'china') throw new HttpError(400, 'notRequired');
    const b = body(req);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const idNumber = typeof b.idNumber === 'string' ? b.idNumber.trim() : '';
    const birthDate = parseIdNumber(idNumber);
    if (!name || !birthDate) throw new HttpError(400, 'invalidIdNumber');
    if (!(await s.realName.verify(name, idNumber))) throw new HttpError(400, 'verificationFailed');
    await s.accounts.setRealName(player.id, birthDate, hashIdNumber(idNumber, s.auth.idHashSecret));
    return respond((await s.accounts.get(player.id))!);
  });

  app.post('/rewards/claim', async (req, reply: FastifyReply) => {
    const player = await requirePlayer(req);
    try {
      const claim = await s.rewards.claim(player.id, s.now());
      return { amount: claim.amount, account: await accountSummary(s, (await s.accounts.get(player.id))!) };
    } catch (error) {
      if (error instanceof AlreadyClaimedError) return reply.status(409).send({ error: 'alreadyClaimed' });
      throw error;
    }
  });

  app.get('/ledger', async (req) => {
    const player = await requirePlayer(req);
    const limit = Number((req.query as { limit?: string }).limit ?? 50);
    return { entries: await s.wallet.history(player.id, Number.isFinite(limit) ? limit : 50) };
  });

  /** Account deletion (PRD §19, App Store / Google Play / PIPL). */
  app.delete('/account', async (req, reply: FastifyReply) => {
    const player = await requirePlayer(req);
    if (s.auth.apple) {
      for (const identity of await s.accounts.identitySecrets(player.id)) {
        if (identity.provider === 'apple' && identity.secret) {
          await s.auth.apple.revoke(identity.secret).catch((e) => console.error('Apple token revocation failed:', e));
        }
      }
    }
    lobby.closePlayer(player.id);
    await s.accounts.delete(player.id);
    return reply.status(204).send();
  });

  return app;
}

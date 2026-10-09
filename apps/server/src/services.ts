/**
 * Wires accounts, economy and regional compliance together, and answers the
 * two questions the lobby and HTTP API need: "what does this player's
 * account look like" and "may they start this game".
 */
import { DEFAULT_RULESET, type RuleSet } from '@mahjong/engine';
import type { AccountSummary, GameOptions, LoginMethod, PlayLimit, PrivateRules, ServerInfo, StakeInfo, StartRejection } from '@mahjong/protocol';
import { PROTOCOL_VERSION } from '@mahjong/protocol';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Accounts, PLAYER_AVATARS, type PlayerRow, type Provider } from './accounts/accounts';
import { AppleTokens, ConsoleSmsSender, SmsCodes, type SmsSender } from './accounts/providers';
import { SessionTokens } from './accounts/tokens';
import { ageOn, DevRealNameVerifier, guestTrialEnd, loadChinaConfig, minorWindowEnd, type ChinaConfig, type RealNameVerifier } from './china/compliance';
import type { Db } from './db/db';
import { HandHistory } from './history';
import { loadEconomyConfig, privateRoomMaxBase, type EconomyConfig } from './economy/config';
import { Rewards } from './economy/rewards';
import { Wallet } from './economy/wallet';
import { MemoryStore } from './memory/store';
import { CrashReports } from './telemetry';
import type { Region } from './dialogueConfig';

export interface AuthConfig {
  appleClientIds: string[];
  googleClientIds: string[];
  wechat: { appId: string; secret: string } | null;
  apple: AppleTokens | null;
  /** Keyed hash secret for ID numbers. */
  idHashSecret: string;
}

export interface Services {
  region: Region;
  db: Db;
  wallet: Wallet;
  accounts: Accounts;
  rewards: Rewards;
  memory: MemoryStore;
  history: HandHistory;
  crashes: CrashReports;
  sms: SmsCodes;
  realName: RealNameVerifier;
  economy: EconomyConfig;
  china: ChinaConfig;
  auth: AuthConfig;
  now(): Date;
}

export interface ServiceOptions {
  region: Region;
  db: Db;
  dataDir: string | null;
  env?: NodeJS.ProcessEnv;
  economy?: EconomyConfig;
  sms?: SmsSender;
  realName?: RealNameVerifier;
  now?: () => Date;
}

export function createServices(o: ServiceOptions): Services {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const economy = o.economy ?? loadEconomyConfig();
  const wallet = new Wallet(o.db);
  const tokens = new SessionTokens(requiredSecret(env, 'SESSION_SECRET', o.dataDir, 'session-secret'), () => now().getTime());
  const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const appleKeys =
    env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && list(env.APPLE_CLIENT_IDS)[0]
      ? new AppleTokens({ teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), clientId: list(env.APPLE_CLIENT_IDS)[0] })
      : null;
  if (o.region === 'china' && !o.realName) console.warn('Using the DEVELOPMENT real-name verifier; production needs the national verification system.');

  return {
    region: o.region,
    db: o.db,
    wallet,
    accounts: new Accounts(o.db, wallet, tokens, () => economy.startingCoins, now),
    rewards: new Rewards(o.db, wallet, economy),
    memory: new MemoryStore(o.db, now),
    history: new HandHistory(o.db),
    crashes: new CrashReports(o.db, () => now().getTime()),
    sms: new SmsCodes(o.db, o.sms ?? new ConsoleSmsSender(), () => now().getTime()),
    realName: o.realName ?? new DevRealNameVerifier(),
    economy,
    china: loadChinaConfig(),
    auth: {
      appleClientIds: list(env.APPLE_CLIENT_IDS),
      googleClientIds: list(env.GOOGLE_CLIENT_IDS),
      wechat: env.WECHAT_APP_ID && env.WECHAT_APP_SECRET ? { appId: env.WECHAT_APP_ID, secret: env.WECHAT_APP_SECRET } : null,
      apple: appleKeys,
      idHashSecret: requiredSecret(env, 'ID_HASH_SECRET', o.dataDir, 'id-hash-secret'),
    },
    now,
  };
}

/** Production must configure real secrets; development falls back to one generated in the data dir. */
function requiredSecret(env: Record<string, string | undefined>, name: string, dataDir: string | null, file: string): string {
  const value = env[name];
  if (value) {
    if (env.NODE_ENV === 'production' && value.length < 32) throw new Error(`${name} must be at least 32 characters`);
    return value;
  }
  if (env.NODE_ENV === 'production') throw new Error(`${name} is not set (required in production)`);
  return devSecret(dataDir, file);
}

/** Development-only secret persisted in the data dir so sessions survive restarts. */
function devSecret(dataDir: string | null, name: string): string {
  if (!dataDir) return randomBytes(32).toString('hex');
  const file = path.join(dataDir, `${name}.txt`);
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    mkdirSync(dataDir, { recursive: true });
    const secret = randomBytes(32).toString('hex');
    writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export function loginMethods(region: Region): LoginMethod[] {
  // China: phone + WeChat are primary; Sign in with Apple stays on iOS (App Store rule 4.8).
  return region === 'china' ? ['phone', 'wechat', 'apple', 'guest'] : ['guest', 'apple', 'google'];
}

export function serverInfo(s: Services): ServerInfo {
  return {
    region: s.region,
    protocol: PROTOCOL_VERSION,
    loginMethods: loginMethods(s.region),
    tables: s.economy.tables,
    privateRoom: s.economy.privateRoom,
    avatars: PLAYER_AVATARS,
  };
}

/** Play allowance under the China rules, or null when unrestricted. */
export async function playLimit(s: Services, player: PlayerRow, providers: Provider[]): Promise<PlayLimit | null> {
  if (s.region !== 'china') return null;
  const now = s.now();
  if (providers.every((p) => p === 'guest')) {
    const guest = await s.db.query<{ subject: string }>("SELECT subject FROM identities WHERE player_id = $1 AND provider = 'guest'", [player.id]);
    const end = guest.length ? await guestTrialEnd(s.db, guest[0].subject, now, s.china) : null;
    return { kind: 'guestTrial', until: end ? end.getTime() : null };
  }
  if (player.birth_date && ageOn(dateString(player.birth_date), now, s.china.utcOffsetHours) < 18) {
    const end = minorWindowEnd(now, s.china);
    return { kind: 'minor', until: end ? end.getTime() : null };
  }
  return null;
}

export async function accountSummary(s: Services, player: PlayerRow): Promise<AccountSummary> {
  const providers = await s.accounts.providers(player.id);
  const isGuest = providers.every((p) => p === 'guest');
  return {
    playerId: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    balance: await s.wallet.balance(player.id),
    providers,
    isGuest,
    banterLevel: player.banter_level ?? (s.region === 'china' ? 'mild' : 'spicy'),
    reward: s.rewards.status(player, s.now()),
    realName: { required: s.region === 'china' && !isGuest, verified: player.real_name_verified },
    playLimit: await playLimit(s, player, providers),
  };
}

export interface GamePlan {
  stake: StakeInfo;
  ruleSet: RuleSet;
  baseScore: number;
  multiplier: number;
  /** The game must stop for this player at this time (minor window / guest trial end). */
  limitEndsAt: number | null;
  limitKind: PlayLimit['kind'] | null;
}

export type StartCheck = { ok: true; plan: GamePlan } | { ok: false; reason: StartRejection; detail?: string };

const PUBLIC_HANDS = 4;

/** Decides whether `player` may start the requested game, and with which stakes and rules. */
export async function checkStart(s: Services, player: PlayerRow, options: GameOptions | undefined): Promise<StartCheck> {
  const providers = await s.accounts.providers(player.id);
  let limitEndsAt: number | null = null;
  let limitKind: PlayLimit['kind'] | null = null;
  if (s.region === 'china') {
    const isGuest = providers.every((p) => p === 'guest');
    if (!isGuest && !player.real_name_verified) return { ok: false, reason: 'realNameRequired' };
    const limit = await playLimit(s, player, providers);
    if (limit) {
      if (limit.until === null) return { ok: false, reason: limit.kind === 'minor' ? 'minorTimeLimit' : 'guestTrialOver' };
      limitEndsAt = limit.until;
      limitKind = limit.kind;
    }
  }

  const balance = await s.wallet.balance(player.id);
  if (options?.private) {
    const p = options.private;
    const hands = Number(p.handsPerGame);
    const base = Number(p.baseScore);
    if (!Number.isInteger(hands) || hands < 1 || hands > s.economy.privateRoom.maxHands) return { ok: false, reason: 'invalidOptions', detail: 'handsPerGame' };
    if (!Number.isInteger(base) || base < 0) return { ok: false, reason: 'invalidOptions', detail: 'baseScore' };
    const maxBase = privateRoomMaxBase(balance, s.economy);
    if (base > maxBase) return { ok: false, reason: 'baseTooHigh', detail: String(maxBase) };
    const rules = privateRuleSet(p.rules);
    if (!rules) return { ok: false, reason: 'invalidOptions', detail: 'rules' };
    return {
      ok: true,
      plan: {
        stake: { kind: 'private', name: '私人房', baseScore: base, multiplier: base === 0 ? 0 : 1, inviteCode: inviteCode() },
        ruleSet: { ...rules, handsPerGame: hands },
        baseScore: base,
        multiplier: base === 0 ? 0 : 1,
        limitEndsAt,
        limitKind,
      },
    };
  }

  const table = s.economy.tables.find((t) => t.id === (options?.tableId ?? 'practice'));
  if (!table) return { ok: false, reason: 'unknownTable' };
  if (balance < table.minCoins) return { ok: false, reason: 'insufficientCoins', detail: String(table.minCoins) };
  return {
    ok: true,
    plan: {
      stake: { kind: 'public', tableId: table.id, name: table.name, baseScore: table.baseScore, multiplier: table.multiplier },
      ruleSet: { ...DEFAULT_RULESET, handsPerGame: PUBLIC_HANDS },
      // A practice table still shows scores: play for points at base 1, settle no coins.
      baseScore: table.baseScore || 1,
      multiplier: table.baseScore === 0 ? 0 : table.multiplier,
      limitEndsAt,
      limitKind,
    },
  };
}

/** Applies only whitelisted private-room rule changes (PRD Appendix A.10). */
export function privateRuleSet(rules: Partial<PrivateRules> | undefined): RuleSet | null {
  const r = rules ?? {};
  const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : typeof v === 'boolean' ? v : null);
  const d = DEFAULT_RULESET;
  const maxFan = r.maxFan === undefined ? d.maxFan : r.maxFan;
  if (!Number.isInteger(maxFan) || maxFan < 2 || maxFan > 8) return null;
  if (r.selfDrawBonus !== undefined && r.selfDrawBonus !== 'fan' && r.selfDrawBonus !== 'base') return null;
  const flags = {
    huanSanZhang: bool(r.huanSanZhang, d.huanSanZhang.enabled),
    callTransfer: bool(r.callTransfer, d.callTransfer),
    jinGouDiao: bool(r.jinGouDiao, d.enabledPatterns.jinGouDiao),
    jiangDui: bool(r.jiangDui, d.enabledPatterns.jiangDui),
    tianDiHu: bool(r.tianDiHu, d.enabledPatterns.tianDiHu),
    haiDi: bool(r.haiDi, d.enabledPatterns.haiDi),
    gangShangPao: bool(r.gangShangPao, d.enabledPatterns.gangShangPao),
    qiangGang: bool(r.qiangGang, d.enabledPatterns.qiangGang),
  };
  if (Object.values(flags).some((v) => v === null)) return null;
  return {
    ...d,
    huanSanZhang: { ...d.huanSanZhang, enabled: flags.huanSanZhang! },
    maxFan,
    selfDrawBonus: r.selfDrawBonus ?? d.selfDrawBonus,
    callTransfer: flags.callTransfer!,
    enabledPatterns: {
      jinGouDiao: flags.jinGouDiao!,
      jiangDui: flags.jiangDui!,
      tianDiHu: flags.tianDiHu!,
      haiDi: flags.haiDi!,
      gangShangPao: flags.gangShangPao!,
      qiangGang: flags.qiangGang!,
    },
  };
}

function inviteCode(): string {
  return String(randomInt(100000, 1000000));
}

export function dateString(v: Date | string): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

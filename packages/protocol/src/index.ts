/**
 * WebSocket protocol between the mobile client and the game server.
 * The server is authoritative: clients send intents, the server sends
 * per-seat views (never the full state).
 */
import type { BanterLevel, QuickPhrase, StickerId } from '@mahjong/dialogue';
import type { Action, GameEvent, HandResult, HandView, RuleSet, Seat } from '@mahjong/engine';

export type { BanterLevel, QuickPhrase, StickerId };

export const PROTOCOL_VERSION = 3;

export interface SeatInfo {
  seat: Seat;
  name: string;
  /** Emoji avatar until the avatar art exists (Phase 6). */
  avatar: string;
  isHuman: boolean;
  /** AI character's personality name, e.g. 毒舌 (PRD §5). */
  personality?: string;
}

/** One line at the table: AI speech, player chat, quick phrase or sticker. */
export interface ChatEntry {
  id: number;
  seat: Seat;
  kind: 'ai' | 'player' | 'quickPhrase' | 'sticker';
  text: string | null;
  sticker: StickerId | null;
  target: Seat | 'table';
  /** Server epoch ms. */
  at: number;
}

export interface ChatCatalog {
  quickPhrases: QuickPhrase[];
  stickers: { id: StickerId; emoji: string; label: string }[];
}

export type ChatRejection = 'blocked' | 'rateLimited' | 'suspended' | 'tooLong' | 'notInGame';

// ---------------------------------------------------------------------------
// Accounts and economy (Phase 3)
// ---------------------------------------------------------------------------

export type LoginMethod = 'guest' | 'apple' | 'google' | 'phone' | 'wechat';

export interface RewardStatus {
  cycle: number[];
  /** 0-based cycle day the next claim pays. */
  dayIndex: number;
  claimable: boolean;
  nextAmount: number;
}

export interface TableInfo {
  id: string;
  name: string;
  baseScore: number;
  minCoins: number;
  /** Coins per point; 0 = practice table without coin settlement. */
  multiplier: number;
}

/** Why the player may or may not start a game right now (China build, Appendix D). */
export interface PlayLimit {
  kind: 'minor' | 'guestTrial';
  /** Epoch ms when the current allowance ends; null = not allowed now. */
  until: number | null;
}

export type RankTierId = 'novice' | 'adept' | 'expert' | 'master' | 'saint';

export interface RankInfo {
  tier: RankTierId;
  points: number;
  /** Points where this tier starts (you can't drop below it) and where the next one starts. */
  tierMin: number;
  nextAt: number | null;
}

/** Rank change after a ranked game (public coin tables only). */
export interface RankResult {
  gameId: string;
  /** 1 = first place. */
  place: number;
  change: number;
  before: RankInfo;
  after: RankInfo;
}

export interface AccountSummary {
  playerId: string;
  nickname: string;
  avatar: string;
  balance: number;
  providers: LoginMethod[];
  isGuest: boolean;
  banterLevel: BanterLevel;
  reward: RewardStatus;
  realName: { required: boolean; verified: boolean };
  playLimit: PlayLimit | null;
  rank: RankInfo;
  /** Finished games, for gentle prompts such as linking a guest account. */
  gamesPlayed: number;
}

/** Public, unauthenticated server info for the login and lobby screens. */
export interface ServerInfo {
  region: 'global' | 'china';
  protocol: number;
  loginMethods: LoginMethod[];
  tables: TableInfo[];
  privateRoom: { maxBaseRatio: number; maxBase: number; maxHands: number };
  avatars: string[];
}

/** Whitelisted RuleSet parameters a private room may change (PRD Appendix A.10). */
export interface PrivateRules {
  huanSanZhang: boolean;
  maxFan: number;
  selfDrawBonus: 'fan' | 'base';
  callTransfer: boolean;
  jinGouDiao: boolean;
  jiangDui: boolean;
  tianDiHu: boolean;
  haiDi: boolean;
  gangShangPao: boolean;
  qiangGang: boolean;
}

export interface StakeInfo {
  kind: 'public' | 'private';
  tableId?: string;
  name: string;
  baseScore: number;
  multiplier: number;
  inviteCode?: string;
}

/** Result of a finished game, also delivered on next login if the player was away (PRD §14.1). */
export interface GameSummary {
  gameId: string;
  stake: StakeInfo;
  handsPlayed: number;
  totals: [number, number, number, number];
  mySeat: Seat;
  seats: SeatInfo[];
  /** Net coins won or lost by the player over the game. */
  coinChange: number;
  endedAt: number;
}

/** One finished hand in the player's history list. */
export interface HandHistoryEntry {
  gameId: string;
  handIndex: number;
  endedAt: number;
  mySeat: Seat;
  seats: { seat: Seat; name: string; isHuman: boolean }[];
  /** Points this hand, per seat. */
  deltas: [number, number, number, number];
  reason: HandResult['reason'];
  /** I won this hand: fan and whether it was self-drawn. */
  myWin: { fan: number; selfDraw: boolean } | null;
}

/** Everything the client needs to replay a finished hand move by move (all hands face up). */
export interface HandReplay {
  gameId: string;
  handIndex: number;
  mySeat: Seat;
  seats: { seat: Seat; name: string; isHuman: boolean }[];
  seed: number;
  dealer: Seat;
  baseScore: number;
  ruleSet: RuleSet;
  actions: Action[];
  /** The deal's commitment and salt (older hands have none). */
  commitment: string | null;
  salt: string | null;
}

/** How the player and one AI character have fared against each other. */
/** sha256("seed:salt") published before the deal; `seed` and `salt` stay null until the hand is over. */
export interface DealProof {
  commitment: string;
  seed: number | null;
  salt: string | null;
}

export interface CharacterRelation {
  characterId: string;
  name: string;
  nameEn: string | null;
  avatar: string;
  handsTogether: number;
  gamesTogether: number;
  /** Hands the character won / the player won while at the same table. */
  theirWins: number;
  myWins: number;
  /** The player dealt in to them / they dealt in to the player. */
  iDealtIn: number;
  theyDealtIn: number;
  lastSeenAt: number | null;
}

export type AchievementId =
  | 'firstWin'
  | 'firstSelfDraw'
  | 'firstKong'
  | 'duiDuiHu'
  | 'qiDui'
  | 'qingYiSe'
  | 'gangShangHua'
  | 'bigWin'
  | 'wins10'
  | 'wins50'
  | 'games10';

export interface AchievementStatus {
  id: AchievementId;
  reward: number;
  /** Null until earned. */
  unlockedAt: number | null;
  claimed: boolean;
}

/** A reward that was just paid automatically: an achievement, or the daily login reward. */
export interface EarnedReward {
  kind: 'achievement' | 'login';
  /** Achievement id; 'login' for the login reward. */
  id: AchievementId | 'login';
  amount: number;
}

export interface AchievementsStatus {
  achievements: AchievementStatus[];
}

/** Lifetime numbers for the stats page. */
export interface PlayerStats {
  gamesPlayed: number;
  handsPlayed: number;
  wins: number;
  selfDraws: number;
  dealIns: number;
  bigWins: number;
  huaZhu: number;
  /** Most fan in a single win among the hands still on record. */
  bestFan: number | null;
}

export type StartRejection =
  | 'unknownTable'
  | 'insufficientCoins'
  | 'baseTooHigh'
  | 'invalidOptions'
  | 'realNameRequired'
  | 'minorTimeLimit'
  | 'guestTrialOver';

export type TimerKind = 'swap' | 'dingque' | 'discard' | 'claim' | 'nextHand';

export interface TimerInfo {
  kind: TimerKind;
  /** Server epoch ms. Clients should use `remainingMs` against their own clock. */
  deadline: number;
  remainingMs: number;
  durationMs: number;
}

export interface TableSnapshot {
  gameId: string;
  /** Index of the hand being played (0-based). */
  handIndex: number;
  handsPerGame: number;
  mySeat: Seat;
  seats: SeatInfo[];
  /** Game totals including every finished hand (the current hand too, once it has ended). */
  totals: [number, number, number, number];
  view: HandView;
  /** Timer for the human seat's pending decision, if any. */
  timer: TimerInfo | null;
  /** 托管: the server is playing for the human. */
  autoPlay: boolean;
  /** "Skip to results" is active for the rest of this hand. */
  fastForward: boolean;
  /** Quick pace is on: AI players barely pause. */
  fastPace: boolean;
  /** Verifiable deal: the commitment is published before play; seed and salt are revealed once the hand ends. */
  deal: DealProof;
  gameOver: boolean;
  /** Recent table chat, oldest first. */
  chat: ChatEntry[];
  stake: StakeInfo;
  /** Coins the player has won or lost so far in this game. */
  coinChange: number;
}

export interface GameOptions {
  /** Public table id (PRD §10–§11). */
  tableId?: string;
  /** Private room (PRD §12–§13); free to create, base score capped by balance. */
  private?: { baseScore: number; handsPerGame: number; rules?: Partial<PrivateRules> };
}

export type ClientMessage =
  /** `locale` is the UI language; AI players talk in it (the China build is always Chinese). */
  | { type: 'hello'; token: string; protocol: number; locale?: 'zh' | 'en' }
  | { type: 'startGame'; options?: GameOptions }
  /** `version` is the view version the action was chosen from; stale actions are ignored. */
  | { type: 'action'; action: DistributiveOmit<Action, 'seat'>; version: number }
  | { type: 'setAutoPlay'; on: boolean }
  /** Quick pace: AI players move with little thinking time (a player setting). */
  | { type: 'setFastPace'; on: boolean }
  | { type: 'skipToResults' }
  | { type: 'nextHand' }
  | { type: 'leaveGame' }
  | { type: 'chat'; text: string; target?: Seat | 'table' }
  | { type: 'quickPhrase'; id: string }
  | { type: 'sticker'; id: StickerId }
  | { type: 'setBanter'; level: BanterLevel }
  /** Report an AI line as inappropriate (Appendix C). */
  | { type: 'reportLine'; entryId: number };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; inGame: boolean; banterLevel: BanterLevel; catalog: ChatCatalog; account: AccountSummary }
  | { type: 'table'; table: TableSnapshot; events: GameEvent[] }
  | { type: 'left'; reason?: 'user' | 'minorTimeLimit' | 'guestTrialOver' }
  /** `gameTotal`: the player's net coins over the current game so far. */
  | { type: 'rank'; result: RankResult }
  /** Rewards paid automatically (achievements after a hand, the login reward on the first visit of the day). */
  | { type: 'rewards'; items: EarnedReward[]; balance: number }
  | { type: 'wallet'; balance: number; change: { amount: number; requested: number; handIndex: number; gameTotal: number } | null }
  | { type: 'startRejected'; reason: StartRejection; detail?: string }
  | { type: 'pendingResult'; summary: GameSummary }
  | { type: 'gameSummary'; summary: GameSummary }
  | { type: 'notice'; kind: 'minorTimeLimit' | 'guestTrialOver'; endsAt: number }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'chatRejected'; reason: ChatRejection }
  | { type: 'banter'; level: BanterLevel }
  | { type: 'lineReported'; entryId: number }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'badMessage' | 'notInGame' | 'illegalAction' | 'protocolMismatch' | 'helloRequired' | 'unauthorized';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

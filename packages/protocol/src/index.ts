/**
 * WebSocket protocol between the mobile client and the game server.
 * The server is authoritative: clients send intents, the server sends
 * per-seat views (never the full state).
 */
import type { BanterLevel, QuickPhrase, StickerId } from '@mahjong/dialogue';
import type { Action, GameEvent, HandView, Seat } from '@mahjong/engine';

export type { BanterLevel, QuickPhrase, StickerId };

export const PROTOCOL_VERSION = 2;

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
  /** Game totals before the current hand. */
  totals: [number, number, number, number];
  view: HandView;
  /** Timer for the human seat's pending decision, if any. */
  timer: TimerInfo | null;
  /** 托管: the server is playing for the human. */
  autoPlay: boolean;
  /** "Skip to results" is active for the rest of this hand. */
  fastForward: boolean;
  gameOver: boolean;
  /** Recent table chat, oldest first. */
  chat: ChatEntry[];
}

export interface GameOptions {
  baseScore?: number;
  handsPerGame?: number;
}

export type ClientMessage =
  | { type: 'hello'; deviceId: string; protocol: number }
  | { type: 'startGame'; options?: GameOptions }
  /** `version` is the view version the action was chosen from; stale actions are ignored. */
  | { type: 'action'; action: DistributiveOmit<Action, 'seat'>; version: number }
  | { type: 'setAutoPlay'; on: boolean }
  | { type: 'skipToResults' }
  | { type: 'nextHand' }
  | { type: 'leaveGame' }
  | { type: 'chat'; text: string; target?: Seat | 'table' }
  | { type: 'quickPhrase'; id: string }
  | { type: 'sticker'; id: StickerId }
  | { type: 'setBanter'; level: BanterLevel };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; inGame: boolean; banterLevel: BanterLevel; catalog: ChatCatalog }
  | { type: 'table'; table: TableSnapshot; events: GameEvent[] }
  | { type: 'left' }
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'chatRejected'; reason: ChatRejection }
  | { type: 'banter'; level: BanterLevel }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'badMessage' | 'notInGame' | 'illegalAction' | 'protocolMismatch' | 'helloRequired';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

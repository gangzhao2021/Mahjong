/**
 * WebSocket protocol between the mobile client and the game server.
 * The server is authoritative: clients send intents, the server sends
 * per-seat views (never the full state).
 */
import type { Action, GameEvent, HandView, Seat } from '@mahjong/engine';

export const PROTOCOL_VERSION = 1;

export interface SeatInfo {
  seat: Seat;
  name: string;
  /** Placeholder avatar (emoji) until the avatar library exists (Phase 2/5). */
  avatar: string;
  isHuman: boolean;
}

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
  | { type: 'leaveGame' };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; inGame: boolean }
  | { type: 'table'; table: TableSnapshot; events: GameEvent[] }
  | { type: 'left' }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'badMessage' | 'notInGame' | 'illegalAction' | 'protocolMismatch' | 'helloRequired';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

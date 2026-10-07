import type { RuleSet, SwapDirection } from './ruleset';
import type { Pattern } from './scoring';
import type { Suit, Tile } from './tiles';

/** Seats in turn order. Turn order runs counter-clockwise around the table. */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export type MeldType = 'pong' | 'directKong' | 'addedKong' | 'concealedKong';

export interface Meld {
  type: MeldType;
  tile: Tile;
  /** Seat whose discard was claimed (pong / direct kong; an added kong keeps its pong's source). */
  from?: Seat;
}

export interface DiscardRecord {
  tile: Tile;
  /** Taken by another player (pong / kong / win) — no longer in the pond. */
  claimed: boolean;
}

export interface WinRecord {
  seat: Seat;
  tile: Tile;
  /** Discarder, or the kong-maker for a robbed kong. Undefined for self-draw. */
  from?: Seat;
  selfDraw: boolean;
  fan: number;
  patterns: Pattern[];
  /** Score per paying player. */
  score: number;
  /** Order of this win within the hand (0 = first winner). */
  order: number;
  /** Final concealed hand including the winning tile. */
  hand: Tile[];
  melds: Meld[];
}

export interface PlayerState {
  hand: Tile[];
  melds: Meld[];
  discards: DiscardRecord[];
  voidSuit: Suit | null;
  swapSelection: Tile[] | null;
  /** Tiles received from Huan San Zhang (known only to this player). */
  swapReceived: Tile[] | null;
  won: WinRecord | null;
  /** 过手胡 flag: passed on a discard win since this player's last draw. */
  passedWin: boolean;
  drawCount: number;
  discardCount: number;
}

export type PaymentReason =
  | 'win'
  | 'directKong'
  | 'addedKong'
  | 'concealedKong'
  | 'callTransfer'
  | 'huaZhu'
  | 'daJiao'
  | 'kongRefund';

export interface Payment {
  from: Seat;
  to: Seat;
  amount: number;
  reason: PaymentReason;
}

export interface KongRecord {
  seat: Seat;
  type: 'directKong' | 'addedKong' | 'concealedKong';
  tile: Tile;
  payments: Payment[];
  /** Income already handed to a winner by 呼叫转移 (not refundable any more). */
  transferred: boolean;
}

export type ClaimOption = 'hu' | 'pong' | 'kong';
export type ClaimResponse = ClaimOption | 'pass';

export type Stage =
  | { kind: 'none' }
  | {
      kind: 'turn';
      seat: Seat;
      /** Tile just drawn, or null (dealer's opening turn, or after a pong). */
      drawn: Tile | null;
      /** Drawn tile was a kong replacement tile. */
      afterKong: boolean;
      /** Drawn tile was the last tile of the wall. */
      lastTile: boolean;
      /** False right after a pong: the player may only discard. */
      mayDeclare: boolean;
    }
  | {
      kind: 'claim';
      discarder: Seat;
      tile: Tile;
      /** The discard was made right after the discarder's kong (杠上炮 / 呼叫转移). */
      afterKong: boolean;
      options: Partial<Record<Seat, ClaimOption[]>>;
      responses: Partial<Record<Seat, ClaimResponse>>;
    }
  | {
      kind: 'robKong';
      konger: Seat;
      tile: Tile;
      options: Partial<Record<Seat, ClaimOption[]>>;
      responses: Partial<Record<Seat, ClaimResponse>>;
    };

export type Phase = 'swap' | 'dingque' | 'play' | 'ended';

export interface DrawSettlementInfo {
  huaZhu: Seat[];
  ready: Seat[];
  notReady: Seat[];
}

export interface HandResult {
  reason: 'threeWon' | 'wallExhausted';
  /** Net score change per seat; always sums to zero. */
  deltas: [number, number, number, number];
  wins: WinRecord[];
  payments: Payment[];
  drawSettlement?: DrawSettlementInfo;
}

export interface HandConfig {
  ruleSet: RuleSet;
  baseScore: number;
  seed: number;
  dealer: Seat;
}

export interface HandState extends HandConfig {
  phase: Phase;
  stage: Stage;
  /** Remaining wall. Normal draws come from the front, kong replacements from the back. */
  wall: Tile[];
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  swapDirection: SwapDirection | null;
  payments: Payment[];
  kongs: KongRecord[];
  wins: WinRecord[];
  /** Any pong / kong has happened (disqualifies 地胡). */
  anyClaim: boolean;
  /** Number of actions applied — doubles as a version number for clients. */
  actionCount: number;
  result: HandResult | null;
}

export type Action =
  | { type: 'swap'; seat: Seat; tiles: Tile[] }
  | { type: 'dingque'; seat: Seat; suit: Suit }
  | { type: 'discard'; seat: Seat; tile: Tile }
  | { type: 'selfKong'; seat: Seat; tile: Tile }
  | { type: 'zimo'; seat: Seat }
  | { type: 'hu'; seat: Seat }
  | { type: 'pong'; seat: Seat }
  | { type: 'kong'; seat: Seat }
  | { type: 'pass'; seat: Seat };

/** Events describe what happened for animation, sounds and AI dialogue triggers. */
export type GameEvent =
  | { type: 'swapSelected'; seat: Seat }
  | { type: 'swapDone'; direction: SwapDirection; received: Partial<Record<Seat, Tile[]>> }
  | { type: 'dingqueDeclared'; seat: Seat }
  | { type: 'dingqueRevealed'; voids: Suit[] }
  | { type: 'draw'; seat: Seat; tile: Tile | null; fromBack: boolean }
  | { type: 'discard'; seat: Seat; tile: Tile }
  | { type: 'pong'; seat: Seat; from: Seat; tile: Tile }
  | { type: 'kong'; seat: Seat; kongType: KongRecord['type']; tile: Tile | null; from?: Seat; payments: Payment[] }
  | { type: 'kongRobbed'; seat: Seat; tile: Tile }
  | { type: 'pass'; seat: Seat }
  | { type: 'win'; win: WinRecord; payments: Payment[] }
  | { type: 'handEnd'; result: HandResult };

/** What a seat may do right now. */
export interface LegalActions {
  /** Huan San Zhang: choose 3 tiles of one of these suits. */
  swapSuits?: Suit[];
  dingque?: boolean;
  discard?: Tile[];
  selfKong?: Tile[];
  zimo?: boolean;
  hu?: boolean;
  pong?: boolean;
  kong?: boolean;
  pass?: boolean;
}

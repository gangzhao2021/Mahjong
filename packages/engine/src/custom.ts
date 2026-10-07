/**
 * Builds a hand from explicit tiles instead of a shuffled deal — for the
 * beginner tutorial's scripted lessons (PRD §27) and for tests.
 */
import { DEFAULT_RULESET, type RuleSet } from './ruleset';
import { parseTiles, sortTiles, type Suit } from './tiles';
import type { HandState, Meld, Phase, PlayerState, Seat } from './types';

export interface CustomHandOptions {
  /** Concealed hands in compact notation ("123m456s..."). */
  hands: [string, string, string, string];
  melds?: Partial<Record<Seat, Meld[]>>;
  /** Void suits; omit (null) for hands that start before dingque. */
  voids?: [Suit | null, Suit | null, Suit | null, Suit | null];
  /** Remaining wall, front first (normal draws from the front, kong replacements from the back). */
  wall: string;
  phase?: Extract<Phase, 'swap' | 'dingque' | 'play'>;
  /** Play phase: whose turn it is, and the tile they just drew (already included in their hand). */
  turn?: Seat;
  drawn?: string;
  dealer?: Seat;
  baseScore?: number;
  rules?: Partial<RuleSet>;
  swapDirection?: HandState['swapDirection'];
}

export function customHand(o: CustomHandOptions): HandState {
  const phase = o.phase ?? 'play';
  const turn = o.turn ?? o.dealer ?? 0;
  const players = o.hands.map(
    (h, i): PlayerState => ({
      hand: sortTiles(parseTiles(h)),
      melds: o.melds?.[i as Seat] ?? [],
      discards: [],
      voidSuit: o.voids?.[i] ?? null,
      swapSelection: phase === 'swap' ? null : [],
      swapReceived: phase === 'swap' ? null : [],
      won: null,
      passedWin: false,
      // Counted as mid-hand so opening-hand bonuses (天胡 / 地胡) do not apply.
      drawCount: 1,
      discardCount: 1,
    }),
  ) as HandState['players'];
  const drawn = o.drawn ? parseTiles(o.drawn)[0] : null;
  return {
    ruleSet: { ...DEFAULT_RULESET, ...o.rules },
    baseScore: o.baseScore ?? 1,
    seed: 0,
    dealer: o.dealer ?? 0,
    phase,
    stage: phase === 'play' ? { kind: 'turn', seat: turn, drawn, afterKong: false, lastTile: false, mayDeclare: true } : { kind: 'none' },
    wall: parseTiles(o.wall),
    players,
    swapDirection: o.swapDirection ?? (phase === 'swap' ? 'counterClockwise' : null),
    payments: [],
    kongs: [],
    wins: [],
    anyClaim: true,
    actionCount: 0,
    result: null,
  };
}

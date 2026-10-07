import {
  apply,
  DEFAULT_RULESET,
  parseTiles,
  sortTiles,
  type Action,
  type GameEvent,
  type HandState,
  type Meld,
  type PlayerState,
  type RuleSet,
  type Seat,
  type Suit,
} from '../src';

export const M: Suit = 0;
export const S: Suit = 1;
export const P: Suit = 2;

export const t = (s: string) => {
  const tiles = parseTiles(s);
  if (tiles.length !== 1) throw new Error(`expected one tile: ${s}`);
  return tiles[0];
};

export interface ScenarioOptions {
  /** Concealed hands in compact notation. The seat on turn holds 14 - 3·melds tiles. */
  hands: [string, string, string, string];
  melds?: Partial<Record<Seat, Meld[]>>;
  /** Void suits; default: dots for everyone, so test hands use m and s only. */
  voids?: [Suit, Suit, Suit, Suit];
  /** Remaining wall, front first. */
  wall?: string;
  turn: Seat;
  drawn?: string;
  rules?: Partial<RuleSet>;
  base?: number;
  dealer?: Seat;
}

/** Builds a mid-hand play-phase state, as if swap/dingque and a few turns had already happened. */
export function scenario(o: ScenarioOptions): HandState {
  const players = o.hands.map(
    (h, i): PlayerState => ({
      hand: sortTiles(parseTiles(h)),
      melds: o.melds?.[i as Seat] ?? [],
      discards: [],
      voidSuit: o.voids?.[i] ?? P,
      swapSelection: [],
      swapReceived: [],
      won: null,
      passedWin: false,
      drawCount: 1,
      discardCount: 1,
    }),
  ) as HandState['players'];
  return {
    ruleSet: { ...DEFAULT_RULESET, ...o.rules },
    baseScore: o.base ?? 1,
    seed: 0,
    dealer: o.dealer ?? 0,
    phase: 'play',
    stage: {
      kind: 'turn',
      seat: o.turn,
      drawn: o.drawn ? t(o.drawn) : null,
      afterKong: false,
      lastTile: false,
      mayDeclare: true,
    },
    wall: parseTiles(o.wall ?? '123456789m123456789s'),
    players,
    swapDirection: null,
    payments: [],
    kongs: [],
    wins: [],
    anyClaim: true,
    actionCount: 0,
    result: null,
  };
}

/** Applies actions in order, returning the final state and all events. */
export function run(state: HandState, ...actions: Action[]): { state: HandState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = apply(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/**
 * Per-seat views (PRD §40). Clients, gameplay AI and the conversation engine
 * consume these — never the full HandState — so hidden information can only
 * leak through this one file.
 */
import { legalActions, runningScores } from './engine';
import type { RuleSet, SwapDirection } from './ruleset';
import type { Suit, Tile } from './tiles';
import type {
  ClaimOption,
  DiscardRecord,
  GameEvent,
  HandResult,
  HandState,
  LegalActions,
  Meld,
  Phase,
  Seat,
  WinRecord,
} from './types';

/** Tile value used in views for a tile the viewer may not see. */
export const HIDDEN_TILE = -1;

export interface PlayerView {
  seat: Seat;
  handCount: number;
  /** Own hand; other players' hands only once they have won or the hand has ended. */
  hand: Tile[] | null;
  /** Concealed kongs of other players show HIDDEN_TILE until the hand ends. */
  melds: Meld[];
  discards: DiscardRecord[];
  /** Other players' void suits become visible once everyone has declared. */
  voidSuit: Suit | null;
  swapDone: boolean;
  dingqueDone: boolean;
  /** The latest win (血流成河 players can win several times). */
  won: WinRecord | null;
  /** Wins this hand: 0 or 1 in 血战到底, any number in 血流成河. */
  winCount: number;
}

export type StageView =
  | { kind: 'none' }
  | { kind: 'turn'; seat: Seat; drawn: Tile | null }
  | { kind: 'claim'; discarder: Seat; tile: Tile; myOptions: ClaimOption[] | null; responded: boolean }
  | { kind: 'robKong'; konger: Seat; tile: Tile; myOptions: ClaimOption[] | null; responded: boolean };

export interface HandView {
  seat: Seat;
  phase: Phase;
  dealer: Seat;
  baseScore: number;
  ruleSet: RuleSet;
  wallCount: number;
  /** Revealed once the swap has happened. */
  swapDirection: SwapDirection | null;
  swapSelection: Tile[] | null;
  swapReceived: Tile[] | null;
  players: PlayerView[];
  stage: StageView;
  legal: LegalActions;
  scores: [number, number, number, number];
  result: HandResult | null;
  version: number;
}

export function viewFor(s: HandState, seat: Seat): HandView {
  const ended = s.phase === 'ended';
  const voidsRevealed = s.phase === 'play' || ended;
  const me = s.players[seat];

  const players = s.players.map((p, i): PlayerView => {
    const own = i === seat;
    return {
      seat: i as Seat,
      handCount: p.hand.length,
      hand: own || ended || p.won ? [...p.hand] : null,
      melds: p.melds.map((m) =>
        m.type === 'concealedKong' && !own && !ended ? { ...m, tile: HIDDEN_TILE } : { ...m },
      ),
      discards: p.discards.map((d) => ({ ...d })),
      voidSuit: own || voidsRevealed ? p.voidSuit : null,
      swapDone: p.swapSelection !== null,
      dingqueDone: p.voidSuit !== null,
      won: p.won,
      winCount: s.wins.filter((w) => w.seat === seat).length,
    };
  });

  let stage: StageView;
  const st = s.stage;
  switch (st.kind) {
    case 'none':
      stage = st;
      break;
    case 'turn':
      stage = { kind: 'turn', seat: st.seat, drawn: st.seat === seat ? st.drawn : null };
      break;
    case 'claim':
      stage = {
        kind: 'claim',
        discarder: st.discarder,
        tile: st.tile,
        myOptions: st.options[seat] ?? null,
        responded: st.responses[seat] !== undefined,
      };
      break;
    case 'robKong':
      stage = {
        kind: 'robKong',
        konger: st.konger,
        tile: st.tile,
        myOptions: st.options[seat] ?? null,
        responded: st.responses[seat] !== undefined,
      };
      break;
  }

  return {
    seat,
    phase: s.phase,
    dealer: s.dealer,
    baseScore: s.baseScore,
    ruleSet: s.ruleSet,
    wallCount: s.wall.length,
    swapDirection: s.phase === 'swap' ? null : s.swapDirection,
    swapSelection: me.swapSelection,
    swapReceived: me.swapReceived,
    players,
    stage,
    legal: legalActions(s, seat),
    scores: runningScores(s),
    result: s.result,
    version: s.actionCount,
  };
}

/** Removes information from an event that `seat` must not see. */
export function redactEvent(event: GameEvent, seat: Seat): GameEvent {
  switch (event.type) {
    case 'draw':
      return event.seat === seat ? event : { ...event, tile: null };
    case 'swapDone':
      return { ...event, received: event.received[seat] ? { [seat]: event.received[seat] } : {} };
    case 'kong':
      return event.kongType === 'concealedKong' && event.seat !== seat ? { ...event, tile: null } : event;
    default:
      return event;
  }
}

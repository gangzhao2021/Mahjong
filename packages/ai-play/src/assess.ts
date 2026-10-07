/**
 * Abstract hand assessment for the conversation layer (PRD §6.3).
 * Exposes only coarse facts derived from the seat's own legal view — never
 * concrete tiles — so dialogue can bluff or be honest without leaking a hand.
 */
import { suitOf, SUITS, toCounts, type HandView, type Suit } from '@mahjong/engine';
import { shanten } from './shanten';

export type HandStrength = 'weak' | 'medium' | 'strong' | 'ready' | 'won';

export interface HandAssessment {
  /** -1 complete, 0 ready, 1 one away, ... (Infinity for no hand) */
  shanten: number;
  strength: HandStrength;
  /** Suit the hand is concentrating on (possible 清一色), if any. */
  flushSuit: Suit | null;
  /** Still holding tiles of the declared void suit. */
  holdingVoid: boolean;
}

export function assessHand(view: HandView): HandAssessment {
  const me = view.players[view.seat];
  if (me.won) return { shanten: -1, strength: 'won', flushSuit: null, holdingVoid: false };
  const hand = me.hand ?? [];
  const holdingVoid = me.voidSuit !== null && hand.some((t) => suitOf(t) === me.voidSuit);
  const useful = hand.filter((t) => suitOf(t) !== me.voidSuit);
  // A 14-tile hand (own turn) is judged after its best discard: shanten handles 3n+2 counts directly.
  const sh = shanten(toCounts(useful), me.melds.length) + (holdingVoid ? 1 : 0);

  const perSuit = SUITS.map((s) => useful.filter((t) => suitOf(t) === s).length + me.melds.filter((m) => m.tile >= 0 && suitOf(m.tile) === s).length * 3);
  const total = perSuit.reduce((a, b) => a + b, 0);
  const main = perSuit.indexOf(Math.max(...perSuit)) as Suit;
  const flushSuit = total > 0 && perSuit[main] / total >= 0.8 ? main : null;

  let strength: HandStrength;
  if (sh <= 0) strength = 'ready';
  else if (sh === 1) strength = 'strong';
  else if (sh === 2) strength = 'medium';
  else strength = 'weak';
  return { shanten: sh, strength, flushSuit, holdingVoid };
}

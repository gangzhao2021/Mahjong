/**
 * Gameplay AI. Decides only from a seat's HandView (legal information),
 * never from the full HandState — so AI cannot cheat by construction.
 *
 * Skill levels differ in how much they look at:
 *   beginner     — shanten + tile acceptance, with noticeable mistakes
 *   intermediate — shanten + acceptance, light defence late in the hand
 *   expert       — + danger reading (void suits, threat level), hand value (flush / all triplets)
 */
import {
  rankOf,
  suitOf,
  SUITS,
  TILE_KINDS,
  toCounts,
  type Action,
  type HandView,
  type Seat,
  type Suit,
  type Tile,
} from '@mahjong/engine';
import { countsWithout, shanten } from './shanten';

export type SkillLevel = 'beginner' | 'intermediate' | 'expert';
export const SKILL_LEVELS: readonly SkillLevel[] = ['beginner', 'intermediate', 'expert'];

export type Rng = () => number;

interface Self {
  seat: Seat;
  hand: Tile[];
  meldCount: number;
  voidSuit: Suit | null;
}

function self(view: HandView): Self {
  const me = view.players[view.seat];
  return { seat: view.seat, hand: me.hand ?? [], meldCount: me.melds.length, voidSuit: me.voidSuit };
}

/** Counts of the hand without void-suit tiles (they will be discarded anyway). */
function usefulCounts(hand: readonly Tile[], voidSuit: Suit | null): number[] {
  return toCounts(hand.filter((t) => suitOf(t) !== voidSuit));
}

/** Copies of each tile kind the viewer can see: own hand, all melds, all ponds. */
function visibleCounts(view: HandView): number[] {
  const seen = new Array<number>(TILE_KINDS).fill(0);
  for (const p of view.players) {
    for (const t of p.hand ?? []) seen[t]++;
    for (const m of p.melds) {
      if (m.tile >= 0) seen[m.tile] += m.type === 'pong' ? 3 : 4;
    }
    for (const d of p.discards) if (!d.claimed) seen[d.tile]++;
  }
  return seen;
}

/** Number of unseen tiles that would lower the shanten of a 13-tile-equivalent hand. */
function acceptance(counts: number[], meldCount: number, voidSuit: Suit | null, seen: number[]): number {
  const base = shanten(counts, meldCount);
  let total = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (suitOf(t) === voidSuit || seen[t] >= 4) continue;
    counts[t]++;
    if (shanten(counts, meldCount) < base) total += 4 - seen[t];
    counts[t]--;
  }
  return total;
}

/** Rough probability-like threat that an opponent is ready, from public information only. */
function threatOf(view: HandView, seat: Seat): number {
  const p = view.players[seat];
  if (p.won) return 0;
  const turns = p.discards.length;
  // Still discarding the void suit recently → cannot be ready yet.
  const recent = p.discards.slice(-2);
  if (p.voidSuit !== null && recent.some((d) => suitOf(d.tile) === p.voidSuit)) return 0.05;
  return Math.min(1, 0.08 * turns + 0.22 * p.melds.length);
}

/** Danger of discarding `tile` into the table (0 = safe). */
function dangerOf(view: HandView, tile: Tile, seen: number[]): number {
  let danger = 0;
  for (const p of view.players) {
    if (p.seat === view.seat || p.won) continue;
    if (suitOf(tile) === p.voidSuit) continue; // nobody wins on their void suit
    const threat = threatOf(view, p.seat);
    if (threat === 0) continue;
    let d = 1;
    const r = rankOf(tile);
    if (r === 1 || r === 9) d *= 0.6;
    else if (r === 2 || r === 8) d *= 0.8;
    const remaining = 4 - seen[tile];
    if (remaining <= 1) d *= 0.3; // at most a single wait is possible
    if (p.discards.some((x) => x.tile === tile)) d *= 0.5; // they let it go before
    danger += threat * d;
  }
  return danger;
}

/** Bonus for keeping a hand on track for valuable patterns (expert only). */
function valueBonus(counts: number[], voidSuit: Suit | null, meldTiles: Tile[]): number {
  const perSuit = SUITS.map((s) => {
    let n = 0;
    for (let k = s * 9; k < s * 9 + 9; k++) n += counts[k];
    return n + meldTiles.filter((t) => suitOf(t) === s).length * 3;
  });
  const kept = SUITS.filter((s) => s !== voidSuit);
  const total = kept.reduce((a: number, s) => a + perSuit[s], 0);
  const main = Math.max(...kept.map((s) => perSuit[s]));
  let bonus = 0;
  if (total > 0 && main / total >= 0.75) bonus += (main / total - 0.7) * 30; // chasing 清一色
  const pairsOrBetter = counts.filter((n) => n >= 2).length + meldTiles.length;
  if (pairsOrBetter >= 4) bonus += pairsOrBetter * 1.5; // drifting to 对对胡 / 七对
  return bonus;
}

export interface DiscardScore {
  tile: Tile;
  shanten: number;
  acceptance: number;
  score: number;
}

/** Every candidate discard with the shanten and acceptance (进张) it leaves, best first for `skill`. */
export function rankDiscards(view: HandView, candidates: Tile[], skill: SkillLevel): DiscardScore[] {
  const me = self(view);
  const seen = visibleCounts(view);
  const counts = usefulCounts(me.hand, me.voidSuit);
  const meldTiles = view.players[view.seat].melds.map((m) => m.tile);
  const wallLeft = view.wallCount;

  const scored = candidates.map((tile): DiscardScore => {
    if (suitOf(tile) === me.voidSuit) {
      // Forced void-suit discard: among those, throw the safest (most seen) first.
      const d = dangerOf(view, tile, seen);
      return { tile, shanten: 0, acceptance: 0, score: seen[tile] * 2 - d * 10 };
    }
    const after = countsWithout(counts, tile);
    const sh = shanten(after, me.meldCount);
    const acc = acceptance(after, me.meldCount, me.voidSuit, seen);
    let score = -sh * 100 + acc;

    if (skill !== 'beginner') {
      const late = wallLeft < 30 ? 1 : 0.3;
      const defenceWeight = skill === 'expert' ? (sh >= 2 ? 60 : sh === 1 ? 30 : 12) : 15 * late;
      score -= dangerOf(view, tile, seen) * defenceWeight;
    }
    if (skill === 'expert') score += valueBonus(after, me.voidSuit, meldTiles);
    return { tile, shanten: sh, acceptance: acc, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export function chooseDiscard(view: HandView, skill: SkillLevel, rng: Rng): Tile {
  const candidates = view.legal.discard ?? [];
  if (candidates.length === 1) return candidates[0];
  const ranked = rankDiscards(view, candidates, skill);
  if (skill === 'beginner' && ranked.length > 1 && rng() < 0.35) {
    return ranked[1 + Math.floor(rng() * Math.min(2, ranked.length - 1))].tile;
  }
  return ranked[0].tile;
}

/** Best shanten reachable by discarding one tile (13-tile equivalent). */
function bestShantenAfterDiscard(counts: number[], meldCount: number): number {
  let best = Infinity;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] === 0) continue;
    counts[t]--;
    best = Math.min(best, shanten(counts, meldCount));
    counts[t]++;
  }
  return best;
}

function shouldPong(view: HandView, tile: Tile, skill: SkillLevel, rng: Rng): boolean {
  const me = self(view);
  const counts = usefulCounts(me.hand, me.voidSuit);
  const before = shanten(counts, me.meldCount);
  const after = bestShantenAfterDiscard(countsWithout(counts, tile, 2), me.meldCount + 1);
  if (skill === 'beginner') return after <= before && rng() < 0.85;
  if (after < before) return true;
  if (after > before) return false;
  // Same distance: experts pong when heading for all-triplets, intermediates half the time.
  if (skill === 'expert') return counts.filter((n) => n >= 2).length >= 3;
  return rng() < 0.5;
}

function shouldKong(view: HandView, tile: Tile, skill: SkillLevel): boolean {
  const me = self(view);
  const counts = usefulCounts(me.hand, me.voidSuit);
  if (skill === 'beginner') return true;
  return shanten(countsWithout(counts, tile, 3), me.meldCount + 1) <= shanten(counts, me.meldCount);
}

function shouldSelfKong(view: HandView, tile: Tile, skill: SkillLevel): boolean {
  const me = self(view);
  const counts = usefulCounts(me.hand, me.voidSuit);
  const now = bestShantenAfterDiscard([...counts], me.meldCount);
  const concealed = counts[tile] === 4;
  const after = concealed
    ? shanten(countsWithout(counts, tile, 4), me.meldCount + 1)
    : shanten(countsWithout(counts, tile, 1), me.meldCount);
  if (skill === 'beginner') return true;
  return after <= now;
}

/** "Connectedness" of a tile within its suit: higher = more useful to keep. */
function tileValue(hand: readonly Tile[], tile: Tile): number {
  let v = 0;
  for (const other of hand) {
    if (other === tile) v += 3;
    else if (suitOf(other) === suitOf(tile)) {
      const dist = Math.abs(rankOf(other) - rankOf(tile));
      if (dist === 1) v += 2;
      else if (dist === 2) v += 1;
    }
  }
  const r = rankOf(tile);
  return v + (r >= 3 && r <= 7 ? 0.5 : 0);
}

function suitWeakness(hand: readonly Tile[], suit: Suit): number {
  const tiles = hand.filter((t) => suitOf(t) === suit);
  return tiles.length * 10 + tiles.reduce((a, t) => a + tileValue(hand, t), 0) * 0.1;
}

export function chooseSwap(view: HandView, skill: SkillLevel, rng: Rng): Tile[] {
  const hand = self(view).hand;
  const suits = [...(view.legal.swapSuits ?? [])];
  suits.sort((a, b) => suitWeakness(hand, a) - suitWeakness(hand, b));
  const suit = skill === 'beginner' && suits.length > 1 && rng() < 0.3 ? suits[1] : suits[0];
  return hand
    .filter((t) => suitOf(t) === suit)
    .map((t, i) => ({ t, v: tileValue(hand, t) + i * 1e-6 }))
    .sort((a, b) => a.v - b.v)
    .slice(0, 3)
    .map((x) => x.t);
}

export function chooseVoidSuit(view: HandView): Suit {
  const hand = self(view).hand;
  return [...SUITS].sort((a, b) => suitWeakness(hand, a) - suitWeakness(hand, b))[0];
}

/** Full decision for whatever the seat may do right now; null if nothing to do. */
export function chooseAction(view: HandView, skill: SkillLevel, rng: Rng): Action | null {
  const seat = view.seat;
  const legal = view.legal;
  if (legal.swapSuits) return { type: 'swap', seat, tiles: chooseSwap(view, skill, rng) };
  if (legal.dingque) return { type: 'dingque', seat, suit: chooseVoidSuit(view) };
  if (legal.zimo) return { type: 'zimo', seat };
  if (legal.hu) return { type: 'hu', seat };

  const stage = view.stage;
  if (stage.kind === 'claim') {
    if (legal.kong && shouldKong(view, stage.tile, skill)) return { type: 'kong', seat };
    if (legal.pong && shouldPong(view, stage.tile, skill, rng)) return { type: 'pong', seat };
    if (legal.pass) return { type: 'pass', seat };
  }
  if (legal.pass) return { type: 'pass', seat };

  if (legal.selfKong) {
    const tile = legal.selfKong.find((t) => shouldSelfKong(view, t, skill));
    if (tile !== undefined) return { type: 'selfKong', seat, tile };
  }
  if (legal.discard) return { type: 'discard', seat, tile: chooseDiscard(view, skill, rng) };
  return null;
}

/**
 * Timeout fallback for a human seat (PRD §14): pass on claims, never declare a
 * win or kong, discard what an intermediate player would.
 */
export function timeoutAction(view: HandView, rng: Rng): Action | null {
  const seat = view.seat;
  const legal = view.legal;
  if (legal.swapSuits) return { type: 'swap', seat, tiles: chooseSwap(view, 'intermediate', rng) };
  if (legal.dingque) return { type: 'dingque', seat, suit: chooseVoidSuit(view) };
  if (legal.pass) return { type: 'pass', seat };
  if (legal.discard) return { type: 'discard', seat, tile: chooseDiscard(view, 'intermediate', rng) };
  return null;
}

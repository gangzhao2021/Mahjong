import { COPIES_PER_KIND, rankOf, suitOf, TILE_KINDS, toCounts, type Suit, type Tile } from './tiles';
import type { Meld } from './types';

/** Can `counts` (a multiple of 3 tiles) be split entirely into sets (triplets / sequences)? */
function decomposesIntoSets(counts: number[]): boolean {
  let i = 0;
  while (i < TILE_KINDS && counts[i] === 0) i++;
  if (i === TILE_KINDS) return true;

  // The lowest remaining tile must start a triplet or a sequence.
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = decomposesIntoSets(counts);
    counts[i] += 3;
    if (ok) return true;
  }
  if (rankOf(i) <= 7 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = decomposesIntoSets(counts);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** Standard shape: sets + one pair. `counts` must hold 3n+2 tiles. */
export function isStandardShape(counts: number[]): boolean {
  const c = [...counts];
  for (let p = 0; p < TILE_KINDS; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = decomposesIntoSets(c);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

/** Concealed tiles are exactly triplets plus one pair (no sequences possible). */
export function isAllTripletsShape(counts: number[]): boolean {
  let pairs = 0;
  for (const n of counts) {
    if (n === 0 || n === 3) continue;
    if (n === 2) pairs++;
    else return false;
  }
  return pairs === 1;
}

export function isSevenPairsShape(counts: number[], meldCount: number): boolean {
  if (meldCount !== 0) return false;
  let total = 0;
  for (const n of counts) {
    if (n % 2 !== 0) return false;
    total += n;
  }
  return total === 14;
}

/** All tiles of a player: concealed + melds (a kong contributes 4). */
export function allTilesOf(hand: readonly Tile[], melds: readonly Meld[]): Tile[] {
  const tiles = [...hand];
  for (const m of melds) {
    const n = m.type === 'pong' ? 3 : 4;
    for (let i = 0; i < n; i++) tiles.push(m.tile);
  }
  return tiles;
}

export function hasVoidTiles(hand: readonly Tile[], voidSuit: Suit | null): boolean {
  return voidSuit !== null && hand.some((t) => suitOf(t) === voidSuit);
}

/**
 * Is `hand` (concealed tiles including the winning tile) a legal winning hand?
 * The hand may not contain void-suit tiles, and all tiles must span at most two suits.
 */
export function isWinningHand(hand: readonly Tile[], melds: readonly Meld[], voidSuit: Suit | null): boolean {
  if (hand.length + melds.length * 3 !== 14) return false;
  if (hasVoidTiles(hand, voidSuit)) return false;
  const suits = new Set(allTilesOf(hand, melds).map(suitOf));
  if (suits.size > 2) return false;
  const counts = toCounts(hand);
  return isSevenPairsShape(counts, melds.length) || isStandardShape(counts);
}

/** Tiles that would complete `hand` (13 - 3·melds tiles). Empty if not ready (not tenpai). */
export function winningTiles(hand: readonly Tile[], melds: readonly Meld[], voidSuit: Suit | null): Tile[] {
  if (hasVoidTiles(hand, voidSuit)) return [];
  const own = toCounts(allTilesOf(hand, melds));
  const waits: Tile[] = [];
  for (let t = 0; t < TILE_KINDS; t++) {
    if (voidSuit !== null && suitOf(t) === voidSuit) continue;
    // A tile whose four copies are all in this player's own hand cannot be waited on.
    if (own[t] >= COPIES_PER_KIND) continue;
    if (isWinningHand([...hand, t], melds, voidSuit)) waits.push(t);
  }
  return waits;
}

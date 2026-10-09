/**
 * Hand insight for the player's own seat, computed only from what that seat
 * can legitimately see: waits when ready (听牌), what each discard would leave,
 * and how many copies of each tile are still unseen (记牌器).
 */
import { shanten } from '@mahjong/ai-play';
import { removeTiles, suitOf, TILE_KINDS, toCounts, winningTiles, HIDDEN_TILE, type HandView, type Tile } from '@mahjong/engine';

/** Copies of each tile kind not visible to this seat: 4 minus own hand, every meld, every pond and revealed hands. */
export function unseenCounts(view: HandView): number[] {
  const left = new Array<number>(TILE_KINDS).fill(4);
  const see = (t: Tile, n = 1) => {
    if (t >= 0 && t !== HIDDEN_TILE) left[t] = Math.max(0, left[t] - n);
  };
  for (const p of view.players) {
    // A claimed discard reappears in the claimer's meld, so only count it once.
    for (const d of p.discards) if (!d.claimed) see(d.tile);
    for (const m of p.melds) see(m.tile, m.type === 'pong' ? 3 : 4);
    if (p.hand) for (const t of p.hand) see(t);
    // A winner's winning tile came from another pond or the wall; it is already in their revealed hand.
  }
  return left;
}

export interface Wait {
  tile: Tile;
  /** Copies still unseen by this seat. */
  left: number;
}

/** Tiles that complete a 13-tile (3n+1) hand, with how many are still out there. */
export function waitsOf(hand: readonly Tile[], view: HandView, unseen = unseenCounts(view)): Wait[] {
  const me = view.players[view.seat];
  return winningTiles(hand, me.melds, me.voidSuit).map((tile) => ({ tile, left: unseen[tile] }));
}

export interface DiscardOutcome {
  /** Ready after this discard: the waits. */
  waits: Wait[];
  /** Tiles still needed to be ready (0 when ready). */
  shanten: number;
}

/** What discarding `tile` from the current 14-tile hand would leave. */
export function discardOutcome(tile: Tile, view: HandView, unseen = unseenCounts(view)): DiscardOutcome {
  const me = view.players[view.seat];
  const rest = removeTiles(me.hand ?? [], [tile]);
  const waits = waitsOf(rest, view, unseen);
  if (waits.length) return { waits, shanten: 0 };
  const voidCount = me.voidSuit === null ? 0 : rest.filter((t) => suitOf(t) === me.voidSuit).length;
  const useful = rest.filter((t) => suitOf(t) !== me.voidSuit);
  // Every void tile still held costs a discard before the hand can be ready.
  return { waits: [], shanten: Math.max(1, shanten(toCounts(useful), me.melds.length) + voidCount) };
}

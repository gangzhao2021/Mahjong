/**
 * Hand insight for the player's own seat, computed only from what that seat
 * can legitimately see: waits when ready (听牌), what each discard would leave,
 * and how many copies of each tile are still unseen (记牌器).
 */
import { shanten } from '@mahjong/ai-play';
import { hasVoidTiles, removeTiles, suitOf, TILE_KINDS, toCounts, winningTiles, HIDDEN_TILE, type HandView, type Tile } from '@mahjong/engine';

/** Copies of each tile kind not visible to this seat: 4 minus own hand, every meld, every pond and revealed hands. */
export function unseenCounts(view: HandView): number[] {
  // A two-suit wall (两房) has no tiles of the missing suit at all.
  const inWall = view.ruleSet.suits ?? [0, 1, 2];
  const left = Array.from({ length: TILE_KINDS }, (_, t): number => (inWall.includes(suitOf(t)) ? 4 : 0));
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

/** Draws left in the wall at which the end-of-hand checks are worth a warning. */
export const LATE_WALL = 8;

/**
 * What the player should be warned about right now, if anything: a winning discard won't be
 * offered (过手胡), or, late in the hand, what a draw would cost (查花猪 for void tiles still held,
 * 查大叫 for a hand that isn't ready).
 */
export function handWarning(view: HandView): 'passedWin' | 'huaZhu' | 'daJiao' | null {
  const me = view.players[view.seat];
  const hand = me.hand;
  if (!hand || me.won || view.phase !== 'play') return null;
  const between = (hand.length - 1) % 3 === 0; // 13-tile hand, not mid-turn
  const ready = between && waitsOf(hand, view).length > 0;
  if (me.passedWin && ready) return 'passedWin';
  if (view.wallCount > LATE_WALL) return null;
  const { checkHuaZhu, checkDaJiao } = view.ruleSet.drawSettlement;
  if (checkHuaZhu && hasVoidTiles(hand, me.voidSuit)) return 'huaZhu';
  if (checkDaJiao && between && !ready) return 'daJiao';
  return null;
}

/** On my discard: the tiles whose discard leaves the hand ready (听牌), for marking in the hand. */
export function readyDiscards(view: HandView): Tile[] {
  const me = view.players[view.seat];
  const legal = view.legal.discard;
  if (!me.hand || !legal || me.won || view.stage.kind !== 'turn' || view.stage.seat !== view.seat) return [];
  const unseen = unseenCounts(view);
  return legal.filter((tile) => waitsOf(removeTiles(me.hand!, [tile]), view, unseen).length > 0);
}

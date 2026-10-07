/**
 * Tiles are represented by their kind only (0..26); the four physical copies
 * of a kind are interchangeable for every rule in Sichuan Mahjong.
 *
 *   0..8   Characters 1..9 (万, suffix "m")
 *   9..17  Bamboo     1..9 (条, suffix "s")
 *   18..26 Dots       1..9 (筒, suffix "p")
 */
export type Tile = number;
export type Suit = 0 | 1 | 2;

export const SUITS: readonly Suit[] = [0, 1, 2];
export const TILE_KINDS = 27;
export const COPIES_PER_KIND = 4;
export const SUIT_LETTERS = ['m', 's', 'p'] as const;

export const suitOf = (t: Tile): Suit => Math.floor(t / 9) as Suit;
export const rankOf = (t: Tile): number => (t % 9) + 1;
export const makeTile = (suit: Suit, rank: number): Tile => suit * 9 + rank - 1;

export function isValidTile(t: unknown): t is Tile {
  return Number.isInteger(t) && (t as number) >= 0 && (t as number) < TILE_KINDS;
}

/** All 108 tiles in canonical order. */
export function fullTileSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let k = 0; k < TILE_KINDS; k++) {
    for (let c = 0; c < COPIES_PER_KIND; c++) tiles.push(k);
  }
  return tiles;
}

export function toCounts(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const t of tiles) counts[t]++;
  return counts;
}

export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a - b);
}

/** Removes one copy of each given tile; throws if a tile is missing. */
export function removeTiles(hand: readonly Tile[], toRemove: readonly Tile[]): Tile[] {
  const result = [...hand];
  for (const t of toRemove) {
    const i = result.indexOf(t);
    if (i < 0) throw new Error(`Tile ${tileName(t)} not in hand`);
    result.splice(i, 1);
  }
  return result;
}

export function countOf(tiles: readonly Tile[], t: Tile): number {
  let n = 0;
  for (const x of tiles) if (x === t) n++;
  return n;
}

export function tileName(t: Tile): string {
  return `${rankOf(t)}${SUIT_LETTERS[suitOf(t)]}`;
}

/** Parses compact notation like "123m456s99p" into tiles (handy for tests and debugging). */
export function parseTiles(text: string): Tile[] {
  const tiles: Tile[] = [];
  let pending: number[] = [];
  for (const ch of text.replace(/\s+/g, '')) {
    if (ch >= '1' && ch <= '9') {
      pending.push(Number(ch));
      continue;
    }
    const suit = SUIT_LETTERS.indexOf(ch as (typeof SUIT_LETTERS)[number]);
    if (suit < 0) throw new Error(`Bad tile notation: ${text}`);
    for (const r of pending) tiles.push(makeTile(suit as Suit, r));
    pending = [];
  }
  if (pending.length) throw new Error(`Missing suit letter in: ${text}`);
  return tiles;
}

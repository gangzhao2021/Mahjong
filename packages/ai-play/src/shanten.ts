/**
 * Shanten (向听数): how many tile changes a hand is from ready.
 * -1 = complete, 0 = ready (tenpai), 1 = one away, ...
 *
 * `counts` holds concealed tiles only; `meldCount` is the number of pongs/kongs.
 * Void-suit tiles should be removed by the caller — they can never be part of a win.
 */
import { TILE_KINDS } from '@mahjong/engine';

interface Block {
  sets: number;
  partials: number;
  pair: 0 | 1;
}

const suitCache = new Map<string, Block[]>();

/** All useful (sets, partials, pair) decompositions of one suit's 9 counts. */
function suitBlocks(c: number[]): Block[] {
  const key = c.join('');
  const cached = suitCache.get(key);
  if (cached) return cached;

  // Only the most partials for each (sets, pair) combination can matter.
  const found = new Map<string, Block>();
  const search = (i: number, sets: number, partials: number, pair: 0 | 1) => {
    while (i < 9 && c[i] === 0) i++;
    if (i === 9) {
      const key = `${sets},${pair}`;
      const prev = found.get(key);
      if (!prev || prev.partials < partials) found.set(key, { sets, partials, pair });
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      search(i, sets + 1, partials, pair);
      c[i] += 3;
    }
    if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--, c[i + 1]--, c[i + 2]--;
      search(i, sets + 1, partials, pair);
      c[i]++, c[i + 1]++, c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) search(i, sets, partials, 1);
      search(i, sets, partials + 1, pair);
      c[i] += 2;
    }
    if (i <= 7 && c[i + 1] > 0) {
      c[i]--, c[i + 1]--;
      search(i, sets, partials + 1, pair);
      c[i]++, c[i + 1]++;
    }
    if (i <= 6 && c[i + 2] > 0) {
      c[i]--, c[i + 2]--;
      search(i, sets, partials + 1, pair);
      c[i]++, c[i + 2]++;
    }
    c[i]--;
    search(i, sets, partials, pair);
    c[i]++;
  };
  search(0, 0, 0, 0);

  const blocks = [...found.values()];
  suitCache.set(key, blocks);
  return blocks;
}

export function regularShanten(counts: readonly number[], meldCount: number): number {
  const perSuit = [0, 1, 2].map((s) => suitBlocks(counts.slice(s * 9, s * 9 + 9)));
  let best = 8;
  for (const a of perSuit[0]) {
    for (const b of perSuit[1]) {
      for (const c of perSuit[2]) {
        const pairs = a.pair + b.pair + c.pair;
        if (pairs > 1) continue;
        const sets = meldCount + a.sets + b.sets + c.sets;
        const partials = Math.min(a.partials + b.partials + c.partials, 4 - sets);
        best = Math.min(best, 8 - 2 * sets - Math.max(partials, 0) - pairs);
      }
    }
  }
  return best;
}

/** Seven pairs; in Sichuan rules four of a kind counts as two pairs. */
export function sevenPairsShanten(counts: readonly number[], meldCount: number): number {
  if (meldCount > 0) return Infinity;
  let pairs = 0;
  for (const n of counts) pairs += Math.floor(n / 2);
  return 6 - Math.min(pairs, 7);
}

export function shanten(counts: readonly number[], meldCount: number): number {
  return Math.min(regularShanten(counts, meldCount), sevenPairsShanten(counts, meldCount));
}

export function countsWithout(counts: readonly number[], tile: number, n = 1): number[] {
  const c = [...counts];
  c[tile] -= n;
  return c;
}

export function emptyCounts(): number[] {
  return new Array<number>(TILE_KINDS).fill(0);
}

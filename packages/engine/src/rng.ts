/**
 * Seeded PRNG. The engine never uses Math.random(): the same seed always
 * produces the same deal, so a hand can be reproduced exactly from
 * {seed, ruleSet, actions}.
 *
 * A seed is either a 32-bit number (mulberry32; tests, benchmarks and hands
 * logged before 128-bit seeds) or a 32-hex-digit string (xoshiro128**, 128
 * bits of state). Live hands use the string form: 2^32 possible walls can be
 * searched from a player's own 13 tiles, 2^128 cannot.
 */
export type Seed = number | string;

export function createRng(seed: Seed): () => number {
  if (typeof seed === 'string') return xoshiro128(seed);
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xoshiro128(hex: string): () => number {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Bad seed: ${hex}`);
  const s = [0, 8, 16, 24].map((i) => parseInt(hex.slice(i, i + 8), 16) >>> 0);
  // An all-zero state never leaves zero.
  if (!s.some(Boolean)) s[0] = 1;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result / 4294967296;
  };
}

/** Derives a child seed, e.g. one seed per hand from a game seed. */
export function deriveSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomInt(rng: () => number, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

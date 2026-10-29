import { describe, expect, it } from 'vitest';
import { createHand, createRng, dealCommitment, DEFAULT_RULESET, verifyDeal } from '../src';

const SEED = '0123456789abcdef0123456789abcdef';

describe('128-bit seeds', () => {
  it('are deterministic and deal the same wall every time', () => {
    const a = createRng(SEED);
    const b = createRng(SEED);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    const deal = () => createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed: SEED, dealer: 0 });
    expect(deal().wall).toEqual(deal().wall);
  });

  it('give different walls for seeds that differ in one bit', () => {
    const other = SEED.slice(0, 31) + 'e';
    const wall = (seed: string) => createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed, dealer: 0 }).wall;
    expect(wall(other)).not.toEqual(wall(SEED));
  });

  it('use the whole state: the low 32 bits alone do not decide the deal', () => {
    const wall = (seed: string) => createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed, dealer: 0 }).wall;
    expect(wall('ffffffff' + SEED.slice(8))).not.toEqual(wall(SEED));
    expect(wall(SEED.slice(0, 24) + '00000000')).not.toEqual(wall(SEED));
  });

  it('produce values in [0, 1) spread evenly', () => {
    const rng = createRng(SEED);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      buckets[Math.floor(x * 10)]++;
    }
    for (const n of buckets) expect(Math.abs(n - 10_000)).toBeLessThan(500);
  });

  it('reject malformed seeds', () => {
    expect(() => createRng('xyz')).toThrow();
    expect(() => createRng(SEED + '0')).toThrow();
  });

  it('work with the deal commitment', () => {
    const c = dealCommitment(SEED, 'salt');
    expect(verifyDeal(c, SEED, 'salt')).toBe(true);
    expect(verifyDeal(c, SEED.replace('0', '1'), 'salt')).toBe(false);
  });

  it('leave number seeds on the old generator, so logged hands still replay', () => {
    const rng = createRng(1);
    expect(rng()).toBeCloseTo(0.6270739405881613, 15);
  });
});

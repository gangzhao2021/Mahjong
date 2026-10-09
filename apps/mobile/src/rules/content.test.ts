import { DEFAULT_RULESET, NO_SITUATION, scoreWin } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { parseExample, PATTERNS } from './content';

describe('rules page examples', () => {
  it.each(PATTERNS.filter((p) => p.example).map((p) => [p.pattern, p.example!] as const))('%s example scores as that pattern', (pattern, example) => {
    const { hand, melds } = parseExample(example);
    expect(scoreWin(hand, melds, NO_SITUATION, DEFAULT_RULESET, 1).patterns[0]).toBe(pattern);
  });
});

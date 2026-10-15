import { DEFAULT_RULESET, NO_SITUATION, scoreWin, withRules } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { parseExample, PATTERNS } from './content';

// With the optional private-room patterns on, so their examples are checked too.
const ALL_PATTERNS = withRules({ enabledPatterns: { ...DEFAULT_RULESET.enabledPatterns, yaoJiu: true, menQing: true, zhongZhang: true, jiaXinWu: true } });

describe('rules page examples', () => {
  it.each(PATTERNS.filter((p) => p.example).map((p) => [p.pattern, p.example!] as const))('%s example scores as that pattern', (pattern, example) => {
    const { hand, melds } = parseExample(example);
    expect(scoreWin(hand, melds, NO_SITUATION, ALL_PATTERNS, 1).patterns[0]).toBe(pattern);
  });
});

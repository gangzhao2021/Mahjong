import { describe, expect, it } from 'vitest';
import { nextGameOptions } from './nextGame';

describe('nextGameOptions', () => {
  const practiceDefault = { tableId: 'practice' };

  it('goes back to the public table the game was at', () => {
    expect(nextGameOptions({ kind: 'public', tableId: 'low', name: '初级场', baseScore: 10, multiplier: 1 }, practiceDefault, 'expert')).toEqual({ tableId: 'low' });
  });

  it('keeps the chosen AI level at the practice table', () => {
    const practice = { kind: 'public' as const, tableId: 'practice', name: '练习场', baseScore: 0, multiplier: 0 };
    expect(nextGameOptions(practice, practiceDefault, 'expert')).toEqual({ tableId: 'practice', aiLevel: 'expert' });
    expect(nextGameOptions(practice, practiceDefault, null)).toEqual({ tableId: 'practice' });
  });

  it('reuses the last options for private rooms', () => {
    const last = { private: { baseScore: 0, handsPerGame: 4 } };
    expect(nextGameOptions({ kind: 'private', name: '私人房', baseScore: 0, multiplier: 0 }, last, 'expert')).toBe(last);
  });
});

import { describe, expect, it } from 'vitest';
import { winSound } from './winSound';

describe('winSound', () => {
  it('my own wins', () => {
    expect(winSound({ seat: 0, selfDraw: true }, 0)).toBe('zimo');
    expect(winSound({ seat: 0, selfDraw: false, from: 2 }, 0)).toBe('hu');
  });

  it('someone wins on my discard or robs my kong', () => {
    expect(winSound({ seat: 1, selfDraw: false, from: 0 }, 0)).toBe('dealIn');
  });

  it("other players' wins", () => {
    expect(winSound({ seat: 1, selfDraw: true }, 0)).toBe('otherZimo');
    expect(winSound({ seat: 1, selfDraw: false, from: 3 }, 0)).toBe('otherHu');
  });
});

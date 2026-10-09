import { apply, customHand, parseTiles, type Action, type HandState } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { reviewHand } from './review';

const t = (s: string) => parseTiles(s)[0];
const start = customHand({
  hands: ['123m456m789m11s23s9s', '1112223334445s', '5556667778889s', '1111p2223334m'],
  voids: [2, 0, 0, 1],
  wall: '5s6s7s8s',
  turn: 0,
  drawn: '9s',
});

function stepsAfter(discard: string): { state: HandState; action: Action | null }[] {
  const action: Action = { type: 'discard', seat: 0, tile: t(discard) };
  return [
    { state: start, action: null },
    { state: apply(start, action).state, action },
  ];
}

describe('hand review', () => {
  it('flags a discard that leaves the hand further from ready', () => {
    const notes = reviewHand(stepsAfter('1m'), 0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ step: 1, played: t('1m'), better: t('9s'), kind: 'shanten' });
  });

  it('says nothing about the best discard', () => {
    expect(reviewHand(stepsAfter('9s'), 0)).toEqual([]);
  });

  it('only reviews my own discards', () => {
    expect(reviewHand(stepsAfter('1m'), 1)).toEqual([]);
  });
});

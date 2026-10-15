import { customHand, parseTiles, viewFor } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { discardOutcome, handWarning, unseenCounts, waitsOf } from './insight';

// Seat 0 holds 123m 456m 789m 11s 23s + drawn 9p (void dots): discarding 9p leaves 1s-4s waits.
const state = customHand({
  hands: ['123m456m789m11s23s9p', '1112223334445s', '5556667778889s', '1111p2223334m'],
  voids: [2, 0, 0, 1],
  wall: '5s6s7s8s',
  turn: 0,
  drawn: '9p',
});
const view = viewFor(state, 0);
const t = (s: string) => parseTiles(s)[0];

describe('hand insight', () => {
  it('counts unseen copies from what this seat can see', () => {
    const unseen = unseenCounts(view);
    expect(unseen[t('1m')]).toBe(3);
    expect(unseen[t('1s')]).toBe(2);
    // Other players' concealed hands are not visible.
    expect(unseen[t('5s')]).toBe(4);
  });

  it('shows the waits a discard would leave', () => {
    const out = discardOutcome(t('9p'), view);
    expect(out.shanten).toBe(0);
    expect(out.waits.map((w) => w.tile)).toEqual([t('1s'), t('4s')]);
    expect(out.waits.find((w) => w.tile === t('1s'))?.left).toBe(2);
  });

  it('reports how far from ready a worse discard leaves the hand', () => {
    const out = discardOutcome(t('1m'), view);
    expect(out.waits).toEqual([]);
    // Breaking a run and keeping a void tile: at least two steps away.
    expect(out.shanten).toBeGreaterThanOrEqual(2);
  });

  it('lists waits for a 13-tile ready hand', () => {
    const waits = waitsOf(parseTiles('123m456m789m11s23s'), view);
    expect(waits.map((w) => w.tile)).toEqual([t('1s'), t('4s')]);
  });
});

describe('hand warnings', () => {
  // Seat 0 waits between turns (seat 1 to play); `wall` sets how late in the hand it is.
  const at = (hand: string, wall: string) =>
    customHand({ hands: [hand, '1112223334445s', '5556667778889s', '1111p2223334m'], voids: [2, 0, 0, 1], wall, turn: 1, drawn: '5s' });
  const LATE = '1s2s3s';
  const EARLY = '1s2s3s4s5s6s7s8s9s1m';

  it('says why a winning discard is not offered after passing a win (过手胡)', () => {
    const s = at('123m456m789m11s23s', EARLY);
    expect(handWarning(viewFor(s, 0))).toBeNull();
    s.players[0].passedWin = true;
    expect(handWarning(viewFor(s, 0))).toBe('passedWin');
  });

  it('warns late in the hand about void tiles still held (查花猪) and about not being ready (查大叫)', () => {
    expect(handWarning(viewFor(at('123m456m789m11s2s9p', LATE), 0))).toBe('huaZhu');
    expect(handWarning(viewFor(at('123m456m789m11s29s', LATE), 0))).toBe('daJiao');
    expect(handWarning(viewFor(at('123m456m789m11s23s', LATE), 0))).toBeNull(); // ready
    expect(handWarning(viewFor(at('123m456m789m11s2s9p', EARLY), 0))).toBeNull(); // still early
  });
});

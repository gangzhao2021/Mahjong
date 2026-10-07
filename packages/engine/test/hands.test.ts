import { describe, expect, it } from 'vitest';
import { isWinningHand, parseTiles, tileName, winningTiles } from '../src';
import { M, P, S } from './helpers';

const win = (hand: string, voidSuit = P) => isWinningHand(parseTiles(hand), [], voidSuit);
const waits = (hand: string, voidSuit = P) => winningTiles(parseTiles(hand), [], voidSuit).map(tileName);

describe('winning hands', () => {
  it('accepts a standard hand', () => {
    expect(win('123m456m789m234s55s')).toBe(true);
  });

  it('accepts seven pairs, including four of a kind as two pairs', () => {
    expect(win('11m22m33m44m55s66s77s')).toBe(true);
    expect(win('1111m33m44m55s66s77s')).toBe(true);
  });

  it('rejects hands holding the void suit', () => {
    expect(win('123m456m789m234s55s', S)).toBe(false);
  });

  it('rejects hands spanning three suits', () => {
    expect(isWinningHand(parseTiles('123m456s789p234m55s'), [], null)).toBe(false);
  });

  it('rejects incomplete shapes', () => {
    expect(win('123m456m789m235s55s')).toBe(false);
  });
});

describe('ready hands (waits)', () => {
  it('finds two-sided waits', () => {
    expect(waits('123m456m789m23s55s')).toEqual(['1s', '4s']);
  });

  it('finds all nine waits of the nine gates', () => {
    expect(waits('1112345678999m', S)).toHaveLength(9);
  });

  it('never waits on the void suit', () => {
    expect(waits('123m456m789m55s5m', M)).toEqual([]);
  });

  it('cannot wait on a tile whose four copies are all held', () => {
    // 1111m + 23m: the 1m wait is impossible, only 4m remains.
    expect(waits('1111m23m456m789m5s')).toEqual(['5s']);
  });
});

import { customHand, parseTiles, viewFor } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { autoMove } from './autoActions';

const OFF = { win: false, noClaims: false, tsumogiri: false };
const t = (s: string) => parseTiles(s)[0];

function myTurn(hand: string, drawn: string) {
  const state = customHand({
    hands: [hand, '1112223334445s', '5556667778889s', '1111p2223334m'],
    voids: [2, 0, 0, 1],
    wall: '5s6s7s8s',
    turn: 0,
    drawn,
  });
  return viewFor(state, 0);
}

describe('auto actions', () => {
  it('does nothing while every shortcut is off', () => {
    expect(autoMove(myTurn('123m456m789m11s23s9s', '9s'), OFF)).toBeNull();
  });

  it('discards a drawn tile that does not win once the hand is ready', () => {
    expect(autoMove(myTurn('123m456m789m11s23s9s', '9s'), { ...OFF, tsumogiri: true })).toEqual({ type: 'discard', tile: t('9s') });
  });

  it('leaves the choice to the player while the hand is not ready yet', () => {
    expect(autoMove(myTurn('123m456m789m19s23s9s', '9s'), { ...OFF, tsumogiri: true })).toBeNull();
  });

  it('declares a self-drawn win', () => {
    expect(autoMove(myTurn('123m456m789m11s23s4s', '4s'), { ...OFF, win: true, tsumogiri: true })).toEqual({ type: 'zimo' });
  });
});

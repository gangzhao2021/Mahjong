/**
 * Cue sounds that come from the state of the table rather than from a single event: the tiles
 * being washed when a hand starts, "you can 碰 / 杠 / 胡 now", the last seconds of your timer,
 * and becoming ready (听牌). Nothing plays for what was already true when the screen mounted.
 */
import type { HandView } from '@mahjong/engine';
import { useEffect, useMemo, useRef } from 'react';
import { waitsOf } from '../game/insight';
import { playSfx } from './sound';

export function useCueSounds({ view, handKey, countdown, timeRunningOut, autoPlay }: { view: HandView; handKey: string; countdown: number | null; timeRunningOut: boolean; autoPlay: boolean }): void {
  const me = view.players[view.seat];
  const legal = view.legal;
  // A claim on a discard or a self-draw win is a one-off chance; a kong in hand can be declined
  // turn after turn, so it only chimes the first time each tile becomes kongable this hand.
  const canClaim = !autoPlay && !!(legal.hu || legal.pong || legal.kong || legal.zimo);
  const kongs = autoPlay ? '' : (legal.selfKong ?? []).join(',');
  // Ready = a waiting hand (13 tiles' worth) that some tile would complete; null while holding the
  // extra tile on my turn, when it can't be told yet. Recomputed per view only.
  const ready = useMemo(() => {
    const hand = me.hand;
    if (!hand || view.phase !== 'play' || me.won !== null) return false;
    return hand.length % 3 === 1 ? waitsOf(hand, view).length > 0 : null;
  }, [view, me.hand, me.won]);
  // Nothing has been played yet: the tiles are fresh from the wall.
  const fresh = view.phase !== 'ended' && view.players.every((p) => p.discards.length === 0 && p.melds.length === 0);

  const last = useRef<{ handKey: string; canClaim: boolean; ready: boolean; tick: number | null } | null>(null);
  const kongsSeen = useRef(new Set<string>());
  useEffect(() => {
    const prev = last.current;
    // While undetermined, remember the last known answer so "still ready" doesn't count as new.
    last.current = { handKey, canClaim, ready: ready ?? prev?.ready ?? false, tick: timeRunningOut ? countdown : null };
    if (handKey !== prev?.handKey) {
      kongsSeen.current = new Set(kongs ? kongs.split(',') : []);
      if (fresh) playSfx('shuffle', 0.7);
      return;
    }
    const newKong = kongs ? kongs.split(',').some((t) => !kongsSeen.current.has(t)) : false;
    if (kongs) kongs.split(',').forEach((t) => kongsSeen.current.add(t));
    if ((canClaim && !prev.canClaim) || newKong) playSfx('alert', 0.8);
    if (ready === true && !prev.ready) playSfx('ting', 0.7);
    if (timeRunningOut && countdown !== null && countdown > 0 && countdown !== prev.tick) playSfx('tick', countdown <= 2 ? 1 : 0.7);
  }, [handKey, canClaim, kongs, ready, fresh, timeRunningOut, countdown]);
}

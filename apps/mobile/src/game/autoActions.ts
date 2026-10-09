/**
 * Optional table shortcuts, as in Tenhou / Mahjong Soul: declare wins at once,
 * skip pong and kong offers, and once ready discard each drawn tile that doesn't win.
 * Kept on this device; the server sees ordinary player actions.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Action, HandView } from '@mahjong/engine';
import type { DistributiveOmit } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { waitsOf } from './insight';

export interface AutoSettings {
  /** 自动胡: declare 胡 / 自摸 as soon as it is offered. */
  win: boolean;
  /** 不碰不杠: pass on pong and kong offers (a 胡 offer still waits for you). */
  noClaims: boolean;
  /** 听牌后自动摸切: when ready, discard each drawn tile that doesn't complete the hand. */
  tsumogiri: boolean;
}

const KEY = 'mahjong.autoActions';
let settings: AutoSettings = { win: false, noClaims: false, tsumogiri: false };
const listeners = new Set<(s: AutoSettings) => void>();
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      if (stored) settings = { ...settings, ...(JSON.parse(stored) as Partial<AutoSettings>) };
    } catch {
      // Defaults.
    }
    listeners.forEach((l) => l(settings));
  })();
  return loading;
}

export function updateAutoSettings(patch: Partial<AutoSettings>): void {
  settings = { ...settings, ...patch };
  listeners.forEach((l) => l(settings));
  void AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => undefined);
}

export function useAutoSettings(): AutoSettings {
  const [s, setS] = useState(settings);
  useEffect(() => {
    listeners.add(setS);
    void load();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** The move the shortcuts make for this view, if any. */
export function autoMove(view: HandView, auto: AutoSettings): DistributiveOmit<Action, 'seat'> | null {
  const legal = view.legal;
  const stage = view.stage;
  if (auto.win && legal.zimo) return { type: 'zimo' };
  if (auto.win && legal.hu) return { type: 'hu' };
  if (auto.noClaims && (legal.pong || legal.kong) && !legal.hu && legal.pass) return { type: 'pass' };

  if (auto.tsumogiri && stage.kind === 'turn' && stage.seat === view.seat && stage.drawn !== null && legal.discard && !legal.zimo && !legal.selfKong?.length) {
    const me = view.players[view.seat];
    const drawn = stage.drawn;
    if (!legal.discard.includes(drawn)) return null;
    const rest = [...(me.hand ?? [])];
    rest.splice(rest.lastIndexOf(drawn), 1);
    // Only once the hand without the drawn tile is already ready.
    if (waitsOf(rest, view).length) return { type: 'discard', tile: drawn };
  }
  return null;
}

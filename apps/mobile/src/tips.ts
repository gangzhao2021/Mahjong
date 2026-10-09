/**
 * One-time coaching tips shown at the table the first time a situation comes
 * up (first swap, first void pick, first discard, first claim, first win).
 * A tip counts as seen once it is dismissed or its moment passes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type TipId = 'swap' | 'dingque' | 'discard' | 'claim' | 'voidFirst' | 'win';

const KEY = 'mahjong.tipsSeen';
let seen: Set<TipId> | null = null;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      seen = new Set(stored ? (JSON.parse(stored) as TipId[]) : []);
    } catch {
      seen = new Set();
    }
    listeners.forEach((l) => l());
  })();
  return loading;
}

export function markTipSeen(id: TipId): void {
  if (!seen || seen.has(id)) return;
  seen.add(id);
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(KEY, JSON.stringify([...seen])).catch(() => undefined);
}

/** Whether a tip still needs showing; false until storage has loaded, so nothing flashes. */
export function useTipPending(id: TipId | null): boolean {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return id !== null && seen !== null && !seen.has(id);
}

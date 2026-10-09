/** Player preferences kept on this device: pace, voice callouts, animations and tile size. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export interface Settings {
  /** Quick pace: AI players barely pause before moving. */
  fastPace: boolean;
  /** Speak "碰 / 杠 / 胡" aloud with the system voice. */
  voice: boolean;
  /** Pop-in and spring animations (off also follows the system's reduce-motion setting). */
  animations: boolean;
  /** Tile size multiplier at the table. */
  tileScale: number;
}

export const TILE_SCALES = [0.85, 1, 1.15] as const;

const KEY = 'mahjong.settings';
let settings: Settings = { fastPace: false, voice: false, animations: true, tileScale: 1 };
const listeners = new Set<(s: Settings) => void>();
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      if (stored) settings = { ...settings, ...(JSON.parse(stored) as Partial<Settings>) };
    } catch {
      // Defaults.
    }
    listeners.forEach((l) => l(settings));
  })();
  return loading;
}
void load();

/** Current settings, for code outside React (e.g. animations). */
export function getSettings(): Settings {
  return settings;
}

export function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  listeners.forEach((l) => l(settings));
  void AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => undefined);
}

export function useSettings(): Settings {
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

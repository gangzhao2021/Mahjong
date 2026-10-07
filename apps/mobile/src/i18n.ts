/**
 * Picks the UI language: the player's saved choice, else the device
 * language (Chinese for any zh-* locale, English otherwise). The China
 * build is always Chinese (enforced in App once the server region is known).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';
import { getLocale, setLocale, type Locale } from './strings';

const KEY = 'mahjong.locale';
const listeners = new Set<(l: Locale) => void>();

function deviceLocale(): Locale {
  try {
    return getLocales()[0]?.languageCode === 'zh' ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

export async function initLocale(): Promise<Locale> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(KEY);
  } catch {
    // Device default.
  }
  const locale: Locale = saved === 'zh' || saved === 'en' ? saved : deviceLocale();
  setLocale(locale);
  return locale;
}

/** Switches language; `persist` = the player chose it (not a region override). */
export function changeLocale(locale: Locale, persist = true): void {
  if (persist) void AsyncStorage.setItem(KEY, locale).catch(() => undefined);
  if (locale === getLocale()) return;
  setLocale(locale);
  listeners.forEach((l) => l(locale));
}

/** The current locale; components using it re-render when it changes. */
export function useLocale(): Locale | null {
  const [locale, set] = useState<Locale | null>(null);
  useEffect(() => {
    let live = true;
    void initLocale().then((l) => live && set(l));
    listeners.add(set);
    return () => {
      live = false;
      listeners.delete(set);
    };
  }, []);
  return locale;
}

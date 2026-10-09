/** Spoken "碰 / 杠 / 胡 / 自摸" with the system voice (setting: voice callouts). No recordings needed. */
import type { GameEvent } from '@mahjong/engine';
import * as Speech from 'expo-speech';
import { useEffect, useRef } from 'react';
import type { TimedEvent } from '../net/useGame';
import { getLocale, T } from '../strings';

function spoken(e: GameEvent): string | null {
  switch (e.type) {
    case 'pong':
      return T.pong;
    case 'kong':
      return T.kong;
    case 'win':
      return e.win.selfDraw ? T.zimo : T.hu;
    default:
      return null;
  }
}

/** Speaks each new pong / kong / win as it arrives; events already on screen when mounted stay silent. */
export function useVoiceCallouts(events: TimedEvent[], enabled: boolean): void {
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    const newest = events.at(-1)?.id ?? -1;
    const from = lastId.current;
    lastId.current = newest;
    if (from === null || !enabled) return;
    for (const e of events) {
      if (e.id <= from) continue;
      const text = spoken(e.event);
      if (text) {
        try {
          Speech.speak(text, { language: getLocale() === 'zh' ? 'zh-CN' : 'en-US', rate: 1.1 });
        } catch {
          // No speech engine on this device.
        }
      }
    }
  }, [events, enabled]);
}

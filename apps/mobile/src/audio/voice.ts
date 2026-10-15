/**
 * Speech with the system voice: "碰 / 杠 / 胡 / 自摸" callouts, each discard's name ("三万", "幺鸡")
 * and the AI characters' table talk (settings: voice callouts, call out discards, AI voice). No
 * recordings needed; every AI speaks in its own voice and the master mute silences all of it.
 */
import { suitOf, type GameEvent, type Seat } from '@mahjong/engine';
import type { SeatInfo } from '@mahjong/protocol';
import * as Speech from 'expo-speech';
import { useEffect, useRef } from 'react';
import type { LocalChatEntry, TimedEvent } from '../net/useGame';
import { getLocale, T } from '../strings';
import { isMuted, onMute } from './sound';

// Utterances queued or being spoken. Tile names are the least important speech: when anything
// is still waiting they are dropped instead of piling up behind it and arriving late.
let pending = 0;

// Muting cuts off whatever is being said.
onMute(() => {
  pending = 0;
  void Speech.stop().catch(() => undefined);
});

function say(text: string, { pitch = 1, rate = 1.1, skippable = false }: { pitch?: number; rate?: number; skippable?: boolean } = {}): void {
  if (isMuted() || (skippable && pending > 0)) return;
  pending++;
  const done = () => {
    pending = Math.max(0, pending - 1);
  };
  try {
    Speech.speak(text, { language: getLocale() === 'zh' ? 'zh-CN' : 'en-US', pitch, rate, onDone: done, onStopped: done, onError: done });
  } catch {
    // No speech engine on this device.
    done();
  }
}

// Names that read as women's get a higher voice; the system has one voice per language,
// so pitch and pace are what tell the characters apart.
const FEMININE = /[姐妹美婆姨凤甜娘妞]/;

/** A steady pitch and pace per character, so the same AI always sounds the same. */
export function characterVoice(name: string): { pitch: number; rate: number } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const spread = (h % 1000) / 1000;
  const pitch = FEMININE.test(name) ? 1.2 + spread * 0.2 : 0.75 + spread * 0.3;
  const rate = 0.95 + (((h >>> 10) % 1000) / 1000) * 0.25;
  return { pitch, rate };
}

function spoken(e: GameEvent): { seat: Seat; text: string; skippable: boolean } | null {
  switch (e.type) {
    case 'discard':
      return { seat: e.seat, text: T.tileSpoken((e.tile % 9) + 1, suitOf(e.tile)), skippable: true };
    case 'pong':
      return { seat: e.seat, text: T.pong, skippable: false };
    case 'kong':
      return { seat: e.seat, text: T.kong, skippable: false };
    case 'win':
      return { seat: e.win.seat, text: e.win.selfDraw ? T.zimo : T.hu, skippable: false };
    default:
      return null;
  }
}

/**
 * Speaks each new pong / kong / win (`callouts`) and discard (`tiles`) as it arrives, in the voice
 * of whoever made it; events already on screen when mounted stay silent.
 */
export function useVoiceCallouts(events: TimedEvent[], seats: SeatInfo[], mySeat: Seat, { callouts, tiles }: { callouts: boolean; tiles: boolean }): void {
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    const newest = events.at(-1)?.id ?? -1;
    const from = lastId.current;
    lastId.current = newest;
    if (from === null || (!callouts && !tiles)) return;
    for (const e of events) {
      if (e.id <= from) continue;
      const line = spoken(e.event);
      if (!line || !(line.skippable ? tiles : callouts)) continue;
      const voice = line.seat === mySeat ? { pitch: 1, rate: 1.1 } : characterVoice(seats[line.seat]?.name ?? '');
      // Tile names are said a little quicker, as players do.
      say(line.text, { pitch: voice.pitch, rate: voice.rate * (line.skippable ? 1.1 : 1), skippable: line.skippable });
    }
  }, [events, seats, mySeat, callouts, tiles]);
}

// Emoji are read out by name ("笑脸"), so they are dropped.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
// Lines that waited longer than this (e.g. behind a long queue) are skipped rather than read late.
const STALE_MS = 5000;

/** Reads each new AI chat line aloud in that character's voice. */
export function useAiVoice(chat: LocalChatEntry[], seats: SeatInfo[], enabled: boolean): void {
  // Anything present at mount is history and stays silent.
  const lastId = useRef(chat.at(-1)?.id ?? -1);
  useEffect(() => {
    const from = lastId.current;
    lastId.current = chat.at(-1)?.id ?? from;
    if (!enabled) return;
    for (const e of chat) {
      if (e.id <= from || e.kind !== 'ai' || !e.text || Date.now() - e.localAt > STALE_MS) continue;
      const text = e.text.replace(EMOJI, '').trim();
      if (!text) continue;
      say(text, characterVoice(seats[e.seat]?.name ?? ''));
    }
  }, [chat, seats, enabled]);
}

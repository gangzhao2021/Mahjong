/**
 * Sound effects and background music (PRD §17). Players are created once
 * and reused; failures (e.g. browser autoplay rules) are ignored — sound is
 * never allowed to break the game.
 */
import type { GameEvent } from '@mahjong/engine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { winSound } from './winSound';

// Frequent sounds come in variants, picked at random so repeated hits do not sound machine-made.
const SOURCES = {
  draw: [require('../../assets/sounds/draw1.wav'), require('../../assets/sounds/draw2.wav'), require('../../assets/sounds/draw3.wav')],
  discard: [require('../../assets/sounds/discard1.wav'), require('../../assets/sounds/discard2.wav'), require('../../assets/sounds/discard3.wav')],
  pong: [require('../../assets/sounds/pong.wav')],
  // 刮风 (exposed kong) and 下雨 (concealed kong).
  kongWind: [require('../../assets/sounds/kong_wind.wav')],
  kongRain: [require('../../assets/sounds/kong_rain.wav')],
  zimo: [require('../../assets/sounds/zimo.wav')],
  hu: [require('../../assets/sounds/hu.wav')],
  // Someone else wins: you dealt in, they self-drew (you pay too), or it's between other players.
  dealIn: [require('../../assets/sounds/deal_in.wav')],
  otherZimo: [require('../../assets/sounds/other_zimo.wav')],
  otherHu: [require('../../assets/sounds/other_hu.wav')],
  tap: [require('../../assets/sounds/tap.wav')],
  chat: [require('../../assets/sounds/chat.wav')],
  // Cues (see cues.ts) and the moments between hands.
  alert: [require('../../assets/sounds/alert.wav')],
  tick: [require('../../assets/sounds/tick.wav')],
  ting: [require('../../assets/sounds/ting.wav')],
  shuffle: [require('../../assets/sounds/shuffle.wav')],
  swap: [require('../../assets/sounds/swap.wav')],
  dingque: [require('../../assets/sounds/dingque.wav')],
  settleWin: [require('../../assets/sounds/settle_win.wav')],
  settleLose: [require('../../assets/sounds/settle_lose.wav')],
} as const;
const MUSIC = require('../../assets/sounds/music.wav');

export type Sfx = keyof typeof SOURCES;

export interface SoundSettings {
  effects: boolean;
  music: boolean;
  /** Master mute: silences effects, music and speech but keeps their own settings for unmuting. */
  muted: boolean;
}

const KEY = 'mahjong.sound';
let settings: SoundSettings = { effects: true, music: true, muted: false };
const muteListeners = new Set<() => void>();
const listeners = new Set<(s: SoundSettings) => void>();
const players = new Map<string, AudioPlayer>();
let music: AudioPlayer | null = null;
let musicWanted = false;
let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      if (stored) settings = { ...settings, ...(JSON.parse(stored) as Partial<SoundSettings>) };
    } catch {
      // Defaults.
    }
    // Respect the silent switch and mix with the player's own music.
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    listeners.forEach((l) => l(settings));
  })();
  return ready;
}

/** True while the master mute is on; speech checks this too. */
export function isMuted(): boolean {
  return settings.muted;
}

/** Called whenever the master mute turns on, so speech can stop mid-sentence. */
export function onMute(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export function playSfx(name: Sfx, volume = 1): void {
  if (!settings.effects || settings.muted) return;
  try {
    const variants = SOURCES[name];
    const i = Math.floor(Math.random() * variants.length);
    let p = players.get(`${name}${i}`);
    if (!p) {
      p = createAudioPlayer(variants[i]);
      players.set(`${name}${i}`, p);
    }
    p.volume = volume;
    void p.seekTo(0);
    p.play();
    // Browsers only allow audio after a user gesture: retry the music then.
    if (musicWanted && settings.music && !music?.playing) applyMusic();
  } catch {
    // Ignore.
  }
}

/** Length of the longest win sound (自摸). */
const WIN_SOUND_MS = 1500;

/** Plays the sounds for game events and AI speech that arrived since the last call. */
export function useTableSounds(events: { id: number; event: GameEvent }[], chat: { id: number; kind: string; localAt: number }[], mySeat: number): void {
  // Ids already handled; anything present at mount is history and stays silent.
  const seen = useRef({ event: events.length ? events[events.length - 1].id : 0, chat: chat.length ? chat[chat.length - 1].id : 0 });
  const lastWinAt = useRef(0);
  useEffect(() => {
    for (const { id, event } of events) {
      if (id <= seen.current.event) continue;
      seen.current.event = id;
      if (event.type === 'draw' && event.seat === mySeat) playSfx('draw', 0.7);
      else if (event.type === 'discard') playSfx('discard', event.seat === mySeat ? 1 : 0.6);
      else if (event.type === 'pong') playSfx('pong');
      else if (event.type === 'kong') playSfx(event.kongType === 'concealedKong' ? 'kongRain' : 'kongWind');
      else if (event.type === 'win') {
        playSfx(winSound(event.win, mySeat));
        lastWinAt.current = Date.now();
      }
      else if (event.type === 'swapDone') playSfx('swap', 0.8);
      else if (event.type === 'dingqueRevealed') playSfx('dingque', 0.7);
      else if (event.type === 'handEnd') {
        const delta = event.result.deltas[mySeat];
        // Let a win's own sound finish first.
        const wait = Math.max(0, lastWinAt.current + WIN_SOUND_MS - Date.now());
        if (delta !== 0) setTimeout(() => playSfx(delta > 0 ? 'settleWin' : 'settleLose', 0.8), wait);
      }
    }
  }, [events, mySeat]);
  useEffect(() => {
    for (const e of chat) {
      if (e.id <= seen.current.chat) continue;
      seen.current.chat = e.id;
      if (e.kind === 'ai' && e.localAt > 0) playSfx('chat', 0.5);
    }
  }, [chat]);
}

/** Background music plays while `wanted` and the music setting is on. */
export function setMusicWanted(wanted: boolean): void {
  musicWanted = wanted;
  void init().then(applyMusic);
}

function applyMusic(): void {
  try {
    if (musicWanted && settings.music && !settings.muted) {
      if (!music) {
        music = createAudioPlayer(MUSIC);
        music.loop = true;
        music.volume = 0.35;
      }
      music.play();
    } else {
      music?.pause();
    }
  } catch {
    // Ignore.
  }
}

export async function updateSoundSettings(patch: Partial<SoundSettings>): Promise<void> {
  await init();
  settings = { ...settings, ...patch };
  listeners.forEach((l) => l(settings));
  if (settings.muted) muteListeners.forEach((l) => l());
  applyMusic();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisted.
  }
}

export function useSoundSettings(): SoundSettings {
  const [s, setS] = useState(settings);
  useEffect(() => {
    listeners.add(setS);
    void init();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

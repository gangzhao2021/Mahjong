/**
 * Sound effects and background music (PRD §17). Players are created once
 * and reused; failures (e.g. browser autoplay rules) are ignored — sound is
 * never allowed to break the game.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';

const SOURCES = {
  draw: require('../../assets/sounds/draw.wav'),
  discard: require('../../assets/sounds/discard.wav'),
  pong: require('../../assets/sounds/pong.wav'),
  kong: require('../../assets/sounds/kong.wav'),
  win: require('../../assets/sounds/win.wav'),
  tap: require('../../assets/sounds/tap.wav'),
  chat: require('../../assets/sounds/chat.wav'),
} as const;
const MUSIC = require('../../assets/sounds/music.wav');

export type Sfx = keyof typeof SOURCES;

export interface SoundSettings {
  effects: boolean;
  music: boolean;
}

const KEY = 'mahjong.sound';
let settings: SoundSettings = { effects: true, music: true };
const listeners = new Set<(s: SoundSettings) => void>();
const players = new Map<Sfx, AudioPlayer>();
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

export function playSfx(name: Sfx, volume = 1): void {
  if (!settings.effects) return;
  try {
    let p = players.get(name);
    if (!p) {
      p = createAudioPlayer(SOURCES[name]);
      players.set(name, p);
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

/** Plays the sounds for game events and AI speech that arrived since the last call. */
export function useTableSounds(events: { id: number; event: { type: string; seat?: number } }[], chat: { id: number; kind: string; localAt: number }[], mySeat: number): void {
  // Ids already handled; anything present at mount is history and stays silent.
  const seen = useRef({ event: events.length ? events[events.length - 1].id : 0, chat: chat.length ? chat[chat.length - 1].id : 0 });
  useEffect(() => {
    for (const { id, event } of events) {
      if (id <= seen.current.event) continue;
      seen.current.event = id;
      if (event.type === 'draw' && event.seat === mySeat) playSfx('draw', 0.7);
      else if (event.type === 'discard') playSfx('discard', event.seat === mySeat ? 1 : 0.6);
      else if (event.type === 'pong') playSfx('pong');
      else if (event.type === 'kong') playSfx('kong');
      else if (event.type === 'win') playSfx('win');
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
    if (musicWanted && settings.music) {
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

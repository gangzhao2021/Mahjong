import type { HandAssessment } from '@mahjong/ai-play';
import type { Pattern, Seat, Suit, Tile } from '@mahjong/engine';

/** Language a table talks in (follows the player's UI language). */
export type Language = 'zh' | 'en';

/**
 * Display length of a line: CJK characters count 1, other characters 0.4,
 * so Chinese and English lines of similar spoken length get the same limits.
 */
export function textLength(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1 : 0.4;
  return Math.ceil(n);
}

/** Player-chosen banter strength (PRD §7). */
export type BanterLevel = 'mild' | 'spicy' | 'quiet';
export const BANTER_LEVELS: readonly BanterLevel[] = ['mild', 'spicy', 'quiet'];

export type StickerId = 'laugh' | 'angry' | 'cry' | 'cool' | 'think' | 'clap' | 'shock' | 'smug' | 'tea' | 'pray';

/** Personality template (PRD §36). Intensities are 0..1. */
export interface Personality {
  id: string;
  name: string;
  /** English display name (English tables). */
  nameEn?: string;
  description: string;
  /** Behaviour instructions injected into the LLM character card. */
  systemPrompt: string;
  conversationStyle: string;
  trashTalk: number;
  talkFrequency: number;
  bluffTendency: number;
  stickerTendency: number;
  stickers: StickerId[];
  weight: number;
  enabled: boolean;
  /** Personality-specific template lines, overriding the defaults per trigger. */
  templates?: Partial<Record<TriggerKind, TemplateSet>>;
}

/** Persistent AI character (PRD §9, Appendix B). */
export interface Character {
  id: string;
  name: string;
  avatar: string;
  personalityId: string;
  weight: number;
  enabled: boolean;
  catchphrases?: string[];
  /** English name and catchphrases for English tables. */
  nameEn?: string;
  catchphrasesEn?: string[];
}

export interface TemplateSet {
  mild: string[];
  spicy?: string[];
}

/** Global AI conversation settings (PRD §35); admin-configurable in Phase 5. */
export interface DialogueSettings {
  /** Scales how often characters react to events. */
  conversationFrequency: number;
  /** Scales unprompted banter during quiet stretches. */
  proactiveFrequency: number;
  stickerFrequency: number;
  bluffIntensity: number;
  trashTalkIntensity: number;
  sarcasmIntensity: number;
  maxSpeakersPerTrigger: number;
  /** Minimum gap between two lines from the same seat. */
  seatCooldownMs: number;
  /** Minimum gap between any two AI lines at the table. */
  tableCooldownMs: number;
  /** A generated line is dropped if more than this many actions happened since its trigger. */
  relevanceWindowActions: number;
  /** Probability that another AI answers an AI line (AI-to-AI chatter). */
  aiReplyChance: number;
  /** Maximum LLM requests per hand per table. */
  llmPerHand: number;
}

export type TriggerKind =
  | 'handStart'
  | 'dingque'
  | 'pong'
  | 'kong'
  | 'win'
  | 'dealtIn'
  | 'bigWin'
  | 'robbedKong'
  | 'dangerousDiscard'
  | 'huaZhu'
  | 'handEnd'
  | 'idle'
  | 'playerChat'
  | 'playerQuickPhrase'
  | 'playerSticker'
  | 'aiSpoke'
  /** Game start: a character who remembers the player greets them (PRD §8). */
  | 'reunion';

export interface Trigger {
  kind: TriggerKind;
  /** High-importance triggers may use the larger model (PRD §44). */
  importance: 'low' | 'high';
  /** Seat that did the thing (winner, ponger, speaker...). */
  subject?: Seat;
  /** Seat on the receiving end (discarder who dealt in, target of a message...). */
  object?: Seat;
  /** Publicly visible tile involved, if any. */
  tile?: Tile;
  fan?: number;
  patterns?: Pattern[];
  /** Untrusted player text, or the quick phrase / AI line being answered. */
  text?: string;
  /** Engine action count when the trigger happened (relevance window). */
  version: number;
  handIndex: number;
}

/** What the gameplay AI wants the line to convey (PRD §6.3). Never contains concealed tiles. */
export type SpeechIntent =
  | { kind: 'react' }
  | { kind: 'bluffCloseToWin'; truth: HandAssessment }
  | { kind: 'complainBadHand'; truth: HandAssessment }
  | { kind: 'feignIndifference'; suit: Suit; truth: HandAssessment }
  | { kind: 'honest'; truth: HandAssessment };

export interface Utterance {
  seat: Seat;
  text: string;
  sticker: StickerId | null;
  target: Seat | 'table';
  source: 'template' | 'llm';
}

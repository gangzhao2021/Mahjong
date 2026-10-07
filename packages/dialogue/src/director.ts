/**
 * Decides who speaks, and how, for each trigger (PRD §6.2, §46): talk
 * frequency by personality, admin frequency, cooldowns, a cap on speakers
 * per event, and when an LLM call is worth it versus a template or sticker.
 */
import type { Seat } from '@mahjong/engine';
import type { Rng } from './roster';
import { roleOf } from './templates';
import type { BanterLevel, Character, DialogueSettings, Personality, Trigger, TriggerKind } from './types';

export interface Speaker {
  seat: Seat;
  character: Character;
  personality: Personality;
}

export interface DirectorState {
  lastSeatLineAt: Partial<Record<Seat, number>>;
  lastTableLineAt: number;
  llmRequestsThisHand: number;
}

export function newDirectorState(): DirectorState {
  return { lastSeatLineAt: {}, lastTableLineAt: 0, llmRequestsThisHand: 0 };
}

export type SpeechMode = 'llm' | 'template' | 'sticker';

export interface SpeechPlan {
  seat: Seat;
  mode: SpeechMode;
}

/** How likely each trigger is to draw comments at all (before personality). */
const KIND_WEIGHT: Record<TriggerKind, number> = {
  handStart: 0.35,
  dingque: 0.15,
  pong: 0.25,
  kong: 0.45,
  win: 0.7,
  dealtIn: 0.75,
  bigWin: 1,
  robbedKong: 0.9,
  dangerousDiscard: 0.5,
  huaZhu: 0.8,
  handEnd: 0.3,
  idle: 0.6,
  playerChat: 1,
  playerQuickPhrase: 0.7,
  playerSticker: 0.4,
  aiSpoke: 1,
};

const ROLE_WEIGHT = { subject: 1, object: 1, other: 0.45 } as const;

/** Triggers worth spending an LLM call on even at low importance (some of the time). */
const LLM_FRIENDLY: ReadonlySet<TriggerKind> = new Set(['idle', 'aiSpoke', 'playerQuickPhrase', 'dangerousDiscard', 'handStart']);

export interface PlanContext {
  now: number;
  level: BanterLevel;
  settings: DialogueSettings;
  state: DirectorState;
  llmAvailable: boolean;
  rng: Rng;
}

export function planSpeech(trigger: Trigger, speakers: Speaker[], ctx: PlanContext): SpeechPlan[] {
  const { settings: s, state, now, rng } = ctx;
  const addressed = trigger.kind === 'playerChat' || trigger.kind === 'playerQuickPhrase' || trigger.kind === 'playerSticker';
  const tableBusy = now - state.lastTableLineAt < s.tableCooldownMs;
  if (tableBusy && trigger.importance === 'low' && !addressed) return [];

  const frequency = trigger.kind === 'idle' ? s.proactiveFrequency : s.conversationFrequency;
  const quietFactor = ctx.level === 'quiet' ? 0.4 : 1;

  const candidates = speakers
    .filter((sp) => sp.seat !== trigger.subject || trigger.kind !== 'aiSpoke') // don't answer yourself
    .map((sp) => {
      const role = roleOf(trigger, sp.seat);
      let p = sp.personality.talkFrequency * frequency * KIND_WEIGHT[trigger.kind] * ROLE_WEIGHT[role] * quietFactor;
      // A message aimed at this character almost always gets an answer.
      if (addressed && trigger.object === sp.seat) p = Math.max(p, 0.95);
      const last = state.lastSeatLineAt[sp.seat] ?? -Infinity;
      const coolingDown = now - last < s.seatCooldownMs && !(addressed && trigger.object === sp.seat);
      return { sp, p: coolingDown ? 0 : Math.min(1, p), roll: rng() };
    })
    .filter((c) => c.roll < c.p)
    .sort((a, b) => b.p - a.p);

  const limit = trigger.kind === 'aiSpoke' ? 1 : Math.max(1, s.maxSpeakersPerTrigger);
  return candidates.slice(0, limit).map(({ sp }) => ({ seat: sp.seat, mode: chooseMode(trigger, sp, ctx) }));
}

function chooseMode(trigger: Trigger, sp: Speaker, ctx: PlanContext): SpeechMode {
  const { settings: s, state, rng } = ctx;
  if (rng() < sp.personality.stickerTendency * s.stickerFrequency * 0.35) return 'sticker';
  // Quiet: stickers and short template reactions only — no LLM dialogue (PRD §7).
  if (ctx.level === 'quiet' || !ctx.llmAvailable) return 'template';
  if (state.llmRequestsThisHand >= s.llmPerHand) return 'template';
  const wantsLlm =
    trigger.kind === 'playerChat' ||
    trigger.importance === 'high' ||
    (LLM_FRIENDLY.has(trigger.kind) && rng() < 0.5) ||
    rng() < 0.15;
  return wantsLlm ? 'llm' : 'template';
}

/** Records that `seat` spoke at `now`. */
export function noteSpoken(state: DirectorState, seat: Seat, now: number): void {
  state.lastSeatLineAt[seat] = now;
  state.lastTableLineAt = now;
}

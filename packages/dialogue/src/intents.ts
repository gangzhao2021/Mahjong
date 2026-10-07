import type { HandAssessment } from '@mahjong/ai-play';
import type { Suit } from '@mahjong/engine';
import type { Rng } from './roster';
import type { DialogueSettings, Personality, SpeechIntent, Trigger } from './types';

/** Triggers where talking about one's own hand makes sense (bluff or honest status). */
const SELF_TALK: ReadonlySet<Trigger['kind']> = new Set(['idle', 'playerChat', 'playerQuickPhrase', 'dingque', 'aiSpoke', 'pong']);

/**
 * Chooses what a line should convey (PRD §6.3). Bluffing is decided here from
 * the real assessment and the personality, so the LLM only ever sees an
 * abstract intent and never the concealed tiles.
 */
export function chooseIntent(
  truth: HandAssessment,
  personality: Personality,
  settings: DialogueSettings,
  trigger: Trigger,
  rng: Rng,
): SpeechIntent {
  if (!SELF_TALK.has(trigger.kind) || truth.strength === 'won') return { kind: 'react' };

  const bluffChance = personality.bluffTendency * settings.bluffIntensity;
  if (rng() < bluffChance) {
    if (truth.strength === 'weak' || truth.strength === 'medium') return { kind: 'bluffCloseToWin', truth };
    if (truth.flushSuit !== null && rng() < 0.5) return { kind: 'feignIndifference', suit: truth.flushSuit, truth };
    return { kind: 'complainBadHand', truth };
  }
  return rng() < 0.5 ? { kind: 'honest', truth } : { kind: 'react' };
}

/** Plain description of an intent for prompts and logs. Mentions no tiles. */
export function describeIntent(intent: SpeechIntent, suitName: (s: Suit) => string): string {
  switch (intent.kind) {
    case 'react':
      return '对刚发生的事情做出符合性格的反应。';
    case 'bluffCloseToWin':
      return '虚张声势：假装自己快要听牌、牌很好（实际上牌并不好，但不要说出实情）。';
    case 'complainBadHand':
      return '故意抱怨自己的牌很烂（实际上牌不错，但不要说出实情）。';
    case 'feignIndifference':
      return `假装对${suitName(intent.suit)}毫无兴趣（实际上正在做这门，但不要说出实情）。`;
    case 'honest': {
      const s = intent.truth.strength;
      const feel = s === 'ready' ? '牌已经很顺了' : s === 'strong' ? '牌还不错' : s === 'medium' ? '牌一般' : '牌很差';
      return `可以如实流露情绪：自己感觉${feel}。不要透露具体是什么牌。`;
    }
  }
}

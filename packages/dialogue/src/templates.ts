/**
 * Template lines (PRD §46): instant, free, and the fallback whenever the LLM
 * is skipped, over budget, slow or unavailable. Keyed by trigger and the
 * speaker's role in it. {subject} / {object} / {tile} are filled in at render time.
 */
import { rankOf, suitOf, type Seat, type Tile } from '@mahjong/engine';
import type { Rng } from './roster';
import type { BanterLevel, Personality, SpeechIntent, TemplateSet, Trigger, TriggerKind } from './types';

export type Role = 'subject' | 'object' | 'other';

type TemplateKey = `${TriggerKind}.${Role}` | `intent.${string}`;

export const DEFAULT_TEMPLATES: Partial<Record<TemplateKey, TemplateSet>> = {
  'handStart.other': {
    mild: ['来来来，开始了。', '这把好好打。', '新的一局，手气来！'],
    spicy: ['准备好输钱了吗？', '今天谁当散财童子？'],
  },
  'dingque.other': {
    mild: ['定好了，开打。', '嗯，这门不要了。'],
  },
  'pong.subject': { mild: ['碰！谢了。', '这张我要了。'], spicy: ['送得好，再来一张。', '谢谢老板！'] },
  'pong.object': { mild: ['哎，被碰了。', '算了算了。'], spicy: ['碰碰碰，就知道碰。'] },
  'pong.other': { mild: ['哟，碰了。'] },
  'kong.subject': { mild: ['杠！刮风下雨，交钱交钱。', '杠一个，舒服。'], spicy: ['杠！掏钱吧各位。'] },
  'kong.object': { mild: ['又杠我的……', '唉，点了个杠。'] },
  'kong.other': { mild: ['又杠了？手气真好。'], spicy: ['杠这么多，小心杠上炮哦。'] },
  'win.subject': { mild: ['自摸！不好意思啦。', '胡了，承让承让。'], spicy: ['自摸！你们慢慢打。', '一家胡了，你们继续血战吧。'] },
  'win.other': { mild: ['自摸了？厉害。', '唉，又要给钱。'], spicy: ['运气好而已。'] },
  'dealtIn.subject': { mild: ['胡了！谢谢{object}。', '就等这张！'], spicy: ['谢谢{object}的大礼！', '{object}，你真是好人。'] },
  'dealtIn.object': { mild: ['哎呀，点炮了……', '这都能胡？'], spicy: ['我这是扶贫。', '算你运气好。'] },
  'dealtIn.other': { mild: ['{object}点炮咯。'], spicy: ['{object}，这张也敢打？', '{object}又在送分了。'] },
  'bigWin.subject': { mild: ['大牌！{fan}番！', '这把值了！'], spicy: ['{fan}番，服不服？'] },
  'bigWin.object': { mild: ['这么大的牌……我哭了。'], spicy: ['你是不是开挂了？'] },
  'bigWin.other': { mild: ['哇，{fan}番，厉害了。'], spicy: ['这牌也太大了吧……'] },
  'robbedKong.object': { mild: ['杠都被抢了？！', '我的杠啊……'] },
  'robbedKong.other': { mild: ['抢杠胡！精彩。'] },
  'dangerousDiscard.other': {
    mild: ['{subject}，这张有点危险哦。', '胆子挺大嘛。'],
    spicy: ['{subject}，这张你也敢打？', '这牌你都敢扔，佩服。'],
  },
  'huaZhu.subject': { mild: ['唉，花猪了……'] },
  'huaZhu.other': { mild: ['有人当花猪咯。'], spicy: ['{subject}花猪，哈哈哈！'] },
  'handEnd.other': { mild: ['下一局再来。', '好，再来一把。'], spicy: ['下一把我要翻本。'] },
  'idle.other': {
    mild: ['今天天气不错。', '打牌打牌，别想太多。', '这牌越来越难打了。'],
    spicy: ['你们打得也太慢了吧。', '谁在憋大牌？我闻到了。'],
  },
  'playerChat.other': { mild: ['哈哈，好好打牌。', '有道理。', '嗯嗯。'], spicy: ['少说话，多出牌。'] },
  'playerQuickPhrase.other': { mild: ['好嘞。', '知道啦。'], spicy: ['催什么催。'] },
  'playerSticker.other': { mild: ['哈哈。'] },
  'aiSpoke.other': { mild: ['你说得对。', '那可不一定。'], spicy: ['你就吹吧。'] },
  'intent.bluffCloseToWin': { mild: ['我快听了，你们小心点。', '这把稳了。'], spicy: ['我马上就胡，你们准备掏钱。'] },
  'intent.complainBadHand': { mild: ['这牌烂得没法看……', '今天手气太差了。'] },
  'intent.feignIndifference': { mild: ['{suit}？我才不要。', '{suit}随便打，我不要。'] },
  'intent.honestGood': { mild: ['这把有点意思。', '牌还行。'] },
  'intent.honestBad': { mild: ['今天手气一般般。', '这把估计没戏了。'] },
};

const SUIT_NAMES = ['万', '条', '筒'];
export const suitName = (s: number) => `${SUIT_NAMES[s]}子`;
export const publicTileName = (t: Tile) => `${rankOf(t)}${SUIT_NAMES[suitOf(t)]}`;

export function roleOf(trigger: Trigger, seat: Seat): Role {
  if (trigger.subject === seat) return 'subject';
  if (trigger.object === seat) return 'object';
  return 'other';
}

function intentKey(intent: SpeechIntent): TemplateKey | null {
  switch (intent.kind) {
    case 'react':
      return null;
    case 'honest':
      return intent.truth.strength === 'ready' || intent.truth.strength === 'strong' ? 'intent.honestGood' : 'intent.honestBad';
    default:
      return `intent.${intent.kind}`;
  }
}

function linesFor(set: TemplateSet | undefined, level: BanterLevel): string[] {
  if (!set) return [];
  return level === 'spicy' && set.spicy ? [...set.mild, ...set.spicy, ...set.spicy] : set.mild;
}

export interface TemplateContext {
  trigger: Trigger;
  seat: Seat;
  intent: SpeechIntent;
  personality: Personality;
  level: BanterLevel;
  nameOf(seat: Seat): string;
  catchphrases?: string[];
}

/** Renders a template line, or null if nothing suitable exists. */
export function templateLine(ctx: TemplateContext, rng: Rng): string | null {
  const { trigger, seat, intent, personality, level } = ctx;
  const role = roleOf(trigger, seat);
  const key = intentKey(intent);
  const own = personality.templates ?? {};

  let pool: string[] = [];
  if (key) pool = linesFor(DEFAULT_TEMPLATES[key], level);
  if (!pool.length) pool = linesFor(own[trigger.kind], level);
  if (!pool.length) pool = linesFor(DEFAULT_TEMPLATES[`${trigger.kind}.${role}`], level);
  if (!pool.length && role !== 'other') pool = linesFor(DEFAULT_TEMPLATES[`${trigger.kind}.other`], level);
  if (ctx.catchphrases?.length && rng() < 0.15) pool = ctx.catchphrases;
  if (!pool.length) return null;

  const line = pool[Math.floor(rng() * pool.length)];
  return line
    .replaceAll('{subject}', trigger.subject !== undefined ? ctx.nameOf(trigger.subject) : '')
    .replaceAll('{object}', trigger.object !== undefined ? ctx.nameOf(trigger.object) : '')
    .replaceAll('{tile}', trigger.tile !== undefined ? publicTileName(trigger.tile) : '')
    .replaceAll('{fan}', String(trigger.fan ?? ''))
    .replaceAll('{suit}', intent.kind === 'feignIndifference' ? suitName(intent.suit) : '');
}

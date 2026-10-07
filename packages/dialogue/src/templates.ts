/**
 * Template lines (PRD §46): instant, free, and the fallback whenever the LLM
 * is skipped, over budget, slow or unavailable. Keyed by trigger and the
 * speaker's role in it. {subject} / {object} / {tile} are filled in at render time.
 */
import { rankOf, suitOf, type Seat, type Tile } from '@mahjong/engine';
import type { Rng } from './roster';
import { reunionFlavor, type CharacterMemory } from './memory';
import { EN_TEMPLATES } from './templatesEn';
import type { BanterLevel, Language, Personality, SpeechIntent, TemplateSet, Trigger, TriggerKind } from './types';

export type Role = 'subject' | 'object' | 'other';

type TemplateKey = `${TriggerKind}.${string}` | `intent.${string}` | `memory.${string}`;

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
  // Memory callbacks (PRD §8). {player} is the human player.
  'reunion.grudge': {
    mild: ['又是你？上次那把我可还记着呢。', '{player}，咱们的账还没算完。'],
    spicy: ['又是你？上次你害我输惨了，今天我要报仇。', '{player}，冤家路窄啊，这次看我怎么收拾你。'],
  },
  'reunion.rival': { mild: ['老对手又见面了。', '{player}，又是我们俩较劲。'], spicy: ['又碰上你了，今天看谁笑到最后。'] },
  'reunion.beaten': { mild: ['{player}，上次输给你了，这次可不会。', '你手气别太好啊。'], spicy: ['今天我要把上次输的都赢回来。'] },
  'reunion.beatThem': { mild: ['{player}，又来给我送分啦？', '老朋友，今天手下留情哈。'], spicy: ['又是你？上次被我胡得挺惨吧。'] },
  'reunion.friendly': { mild: ['{player}，好久不见！', '哟，又一起打牌了。'] },
  'memory.dealtInAgain': { mild: ['又是你点的炮，跟上次一样。', '{player}，你怎么老喂我？'], spicy: ['{player}，你是专门来给我送分的吧？'] },
  'memory.lostAgain': { mild: ['又被你胡了……上次也是这样。', '{player}，你是不是专盯着我？'], spicy: ['又是你！这仇我记下了。'] },
  'intent.bluffCloseToWin': { mild: ['我快听了，你们小心点。', '这把稳了。'], spicy: ['我马上就胡，你们准备掏钱。'] },
  'intent.complainBadHand': { mild: ['这牌烂得没法看……', '今天手气太差了。'] },
  'intent.feignIndifference': { mild: ['{suit}？我才不要。', '{suit}随便打，我不要。'] },
  'intent.honestGood': { mild: ['这把有点意思。', '牌还行。'] },
  'intent.honestBad': { mild: ['今天手气一般般。', '这把估计没戏了。'] },
};

const SUIT_NAMES = ['万', '条', '筒'];
const SUIT_NAMES_EN = ['Characters', 'Bamboo', 'Dots'];
export const suitName = (s: number, language: Language = 'zh') => (language === 'en' ? SUIT_NAMES_EN[s] : `${SUIT_NAMES[s]}子`);
export const publicTileName = (t: Tile, language: Language = 'zh') =>
  language === 'en' ? `${rankOf(t)} ${SUIT_NAMES_EN[suitOf(t)]}` : `${rankOf(t)}${SUIT_NAMES[suitOf(t)]}`;

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
  /** What this character remembers about the human (Phase 4). */
  memory?: CharacterMemory | null;
  humanSeat?: Seat;
  language?: Language;
}

/** A memory-specific template key for this moment, if the character has history with the player. */
function memoryKey(ctx: TemplateContext): TemplateKey | null {
  const { trigger, seat, memory: m, humanSeat } = ctx;
  if (!m || humanSeat === undefined) return null;
  if (trigger.kind === 'reunion') return `reunion.${reunionFlavor(m)}`;
  if (trigger.kind !== 'dealtIn') return null;
  if (trigger.subject === seat && trigger.object === humanSeat && m.dealtInByPlayer > 0) return 'memory.dealtInAgain';
  if (trigger.subject === humanSeat && trigger.object === seat && m.dealtInToPlayer > 0) return 'memory.lostAgain';
  return null;
}

/** Renders a template line, or null if nothing suitable exists. */
export function templateLine(ctx: TemplateContext, rng: Rng): string | null {
  const { trigger, seat, intent, personality, level } = ctx;
  const role = roleOf(trigger, seat);
  const key = intentKey(intent);
  const language = ctx.language ?? 'zh';
  // Personality templates are written in Chinese only.
  const own = language === 'zh' ? (personality.templates ?? {}) : {};
  const lib: Partial<Record<string, TemplateSet>> = language === 'en' ? EN_TEMPLATES : DEFAULT_TEMPLATES;

  let pool: string[] = [];
  const remembered = memoryKey(ctx);
  if (remembered) pool = linesFor(lib[remembered], level);
  if (!pool.length && key) pool = linesFor(lib[key], level);
  if (!pool.length) pool = linesFor(own[trigger.kind], level);
  if (!pool.length) pool = linesFor(lib[`${trigger.kind}.${role}`], level);
  if (!pool.length && role !== 'other') pool = linesFor(lib[`${trigger.kind}.other`], level);
  // A catchphrase now and then — but a memory callback always wins.
  if (!remembered && ctx.catchphrases?.length && rng() < 0.15) pool = ctx.catchphrases;
  if (!pool.length) return null;

  const line = pool[Math.floor(rng() * pool.length)];
  return line
    .replaceAll('{player}', ctx.humanSeat !== undefined ? ctx.nameOf(ctx.humanSeat) : '')
    .replaceAll('{subject}', trigger.subject !== undefined ? ctx.nameOf(trigger.subject) : '')
    .replaceAll('{object}', trigger.object !== undefined ? ctx.nameOf(trigger.object) : '')
    .replaceAll('{tile}', trigger.tile !== undefined ? publicTileName(trigger.tile, language) : '')
    .replaceAll('{fan}', String(trigger.fan ?? ''))
    .replaceAll('{suit}', intent.kind === 'feignIndifference' ? suitName(intent.suit, language) : '');
}

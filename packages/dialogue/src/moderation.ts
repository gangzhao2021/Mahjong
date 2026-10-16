/**
 * Content moderation (PRD §7, §7.1). `Moderator` is the provider interface;
 * regional vendor services (Appendix D.5) plug in behind it. The local
 * blocklist always runs first and also catches personal contact info.
 */
import { textLength } from './types';

export type ModerationKind = 'playerChat' | 'aiLine' | 'nickname';

export interface ModerationResult {
  allowed: boolean;
  reason?: 'blocklist' | 'contactInfo' | 'link' | 'empty' | 'tooLong' | 'vendor';
}

export interface Moderator {
  check(text: string, kind: ModerationKind): Promise<ModerationResult>;
}

/** Severe content that is never allowed, from players or AI. Extend via admin config. */
export const DEFAULT_BLOCKLIST = [
  '去死',
  '杀了你',
  '弄死你',
  '砍死你',
  '自杀',
  '傻逼',
  '操你',
  '草泥马',
  '你妈的',
  // Common homophones and spellings that get around the words above.
  '傻b',
  '傻比',
  '煞笔',
  '沙比',
  '脑残',
  '智障',
  '去屎',
  'sb',
  'killyourself',
  'kys',
  'iwillkillyou',
  'fuckyou',
  'motherfucker',
  'nigger',
  'faggot',
  'retard',
  'cunt',
];

/** Full-width letters and digits (ＳＢ, １３８…) fold to plain ones before any check. */
const fold = (text: string) => text.normalize('NFKC').toLowerCase();
const normalize = (text: string) => fold(text).replace(/[\s\p{P}\p{S}_]+/gu, '');
/** Short Latin entries (sb, kys) match whole words only, so "the skys are blue" or "usb" pass. */
const isShortLatin = (word: string) => /^[a-z]{1,3}$/.test(word);

const CHINESE_DIGITS: Record<string, string> = { 零: '0', 〇: '0', 一: '1', 幺: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 壹: '1', 贰: '2', 叁: '3', 肆: '4', 伍: '5', 陆: '6', 柒: '7', 捌: '8', 玖: '9' };
/** WeChat / QQ asked for under another name: v信, 薇信, q扣, wx… */
const CONTACT_APP = /(微信|微x|v信|薇信|威信|维信|卫星号|vx|wx|q扣|扣扣|qq|企鹅号)/i;

export class LocalModerator implements Moderator {
  private readonly blocked: string[];
  private readonly blockedWords: Set<string>;

  constructor(blocklist: readonly string[] = DEFAULT_BLOCKLIST, private readonly maxLength = 60) {
    const all = blocklist.map(normalize).filter(Boolean);
    this.blocked = all.filter((w) => !isShortLatin(w));
    this.blockedWords = new Set(all.filter(isShortLatin));
  }

  async check(text: string, kind: ModerationKind): Promise<ModerationResult> {
    const trimmed = text.trim();
    if (!trimmed) return { allowed: false, reason: 'empty' };
    if (textLength(trimmed) > this.maxLength) return { allowed: false, reason: 'tooLong' };
    const folded = fold(trimmed);
    const flat = normalize(trimmed);
    if (this.blocked.some((w) => flat.includes(w))) return { allowed: false, reason: 'blocklist' };
    // Words are split on spaces only, so "K.Y.S" and "s.b" still read as one word.
    const words = folded.replace(/[\p{P}\p{S}_]+/gu, '').match(/[a-z]+/g) ?? [];
    if (words.some((w) => this.blockedWords.has(w))) return { allowed: false, reason: 'blocklist' };
    if (kind !== 'aiLine') {
      // Phone numbers, QQ / WeChat ids and links: players must not share contact details.
      const digits = folded.replace(/[\s\-.·]/g, '');
      if (/\d{7,}/.test(digits)) return { allowed: false, reason: 'contactInfo' };
      // Spelled out in Chinese numerals; ten or more so a straight ("一二三四五六七八九", 一条龙) still passes.
      const spelled = digits.replace(/[零〇一幺二两三四五六七八九壹贰叁肆伍陆柒捌玖]/g, (c) => CHINESE_DIGITS[c]);
      if (/\d{10,}/.test(spelled)) return { allowed: false, reason: 'contactInfo' };
      if (/(https?:\/\/|www\.|\.com\b|\.cn\b|qq号)/i.test(folded) || CONTACT_APP.test(folded.replace(/\s+/g, ''))) return { allowed: false, reason: 'link' };
    }
    return { allowed: true };
  }
}

/** Runs moderators in order; the first rejection wins. */
export class ModerationChain implements Moderator {
  constructor(private readonly moderators: Moderator[]) {}

  async check(text: string, kind: ModerationKind): Promise<ModerationResult> {
    for (const m of this.moderators) {
      const r = await m.check(text, kind);
      if (!r.allowed) return r;
    }
    return { allowed: true };
  }
}

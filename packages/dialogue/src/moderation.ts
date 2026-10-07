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

const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');

export class LocalModerator implements Moderator {
  private readonly blocked: string[];

  constructor(blocklist: readonly string[] = DEFAULT_BLOCKLIST, private readonly maxLength = 60) {
    this.blocked = blocklist.map(normalize).filter(Boolean);
  }

  async check(text: string, kind: ModerationKind): Promise<ModerationResult> {
    const trimmed = text.trim();
    if (!trimmed) return { allowed: false, reason: 'empty' };
    if (textLength(trimmed) > this.maxLength) return { allowed: false, reason: 'tooLong' };
    const flat = normalize(trimmed);
    if (this.blocked.some((w) => flat.includes(w))) return { allowed: false, reason: 'blocklist' };
    if (kind !== 'aiLine') {
      // Phone numbers, QQ / WeChat ids and links: players must not share contact details.
      if (/\d{7,}/.test(trimmed.replace(/[\s-]/g, ''))) return { allowed: false, reason: 'contactInfo' };
      if (/(https?:\/\/|www\.|\.com\b|\.cn\b|微信|vx|qq号)/i.test(trimmed)) return { allowed: false, reason: 'link' };
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

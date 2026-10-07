import type { StickerId } from './types';

/** Sticker catalog. Emoji placeholders until the art exists (Phase 6). */
export const STICKERS: Record<StickerId, { emoji: string; label: string; labelEn: string }> = {
  laugh: { emoji: '😂', label: '大笑', labelEn: 'LOL' },
  angry: { emoji: '😠', label: '生气', labelEn: 'Angry' },
  cry: { emoji: '😭', label: '哭', labelEn: 'Crying' },
  cool: { emoji: '😎', label: '得意', labelEn: 'Cool' },
  think: { emoji: '🤔', label: '思考', labelEn: 'Hmm' },
  clap: { emoji: '👏', label: '鼓掌', labelEn: 'Bravo' },
  shock: { emoji: '😱', label: '震惊', labelEn: 'Shocked' },
  smug: { emoji: '😏', label: '坏笑', labelEn: 'Smug' },
  tea: { emoji: '🍵', label: '喝茶', labelEn: 'Sipping tea' },
  pray: { emoji: '🙏', label: '求求了', labelEn: 'Please' },
};

export interface QuickPhrase {
  id: string;
  text: string;
  /** English text for English tables (falls back to `text`). */
  textEn?: string;
}

/** Player quick phrases (PRD §18); admin-configurable list. */
export const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
  { id: 'hurry', text: '快点吧，等得花儿都谢了！', textEn: 'Hurry up, the flowers are wilting!' },
  { id: 'nice', text: '打得漂亮！', textEn: 'Nicely played!' },
  { id: 'dontEven', text: '想都别想！', textEn: "Don't even think about it!" },
  { id: 'luck', text: '今天手气太差了……', textEn: 'Terrible luck today…' },
  { id: 'again', text: '再来一局！', textEn: 'One more game!' },
  { id: 'sorry', text: '不好意思，又是我。', textEn: 'Sorry, me again.' },
  { id: 'scary', text: '这牌太吓人了。', textEn: 'These tiles are scary.' },
  { id: 'watch', text: '都小心点，我要胡了。', textEn: "Careful, everyone — I'm about to win." },
];

import type { StickerId } from './types';

/** Sticker catalog. Emoji placeholders until the art exists (Phase 6). */
export const STICKERS: Record<StickerId, { emoji: string; label: string }> = {
  laugh: { emoji: '😂', label: '大笑' },
  angry: { emoji: '😠', label: '生气' },
  cry: { emoji: '😭', label: '哭' },
  cool: { emoji: '😎', label: '得意' },
  think: { emoji: '🤔', label: '思考' },
  clap: { emoji: '👏', label: '鼓掌' },
  shock: { emoji: '😱', label: '震惊' },
  smug: { emoji: '😏', label: '坏笑' },
  tea: { emoji: '🍵', label: '喝茶' },
  pray: { emoji: '🙏', label: '求求了' },
};

export interface QuickPhrase {
  id: string;
  text: string;
}

/** Player quick phrases (PRD §18); admin-configurable list. */
export const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
  { id: 'hurry', text: '快点吧，等得花儿都谢了！' },
  { id: 'nice', text: '打得漂亮！' },
  { id: 'dontEven', text: '想都别想！' },
  { id: 'luck', text: '今天手气太差了……' },
  { id: 'again', text: '再来一局！' },
  { id: 'sorry', text: '不好意思，又是我。' },
  { id: 'scary', text: '这牌太吓人了。' },
  { id: 'watch', text: '都小心点，我要胡了。' },
];

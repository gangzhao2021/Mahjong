/**
 * Table conversation for one room (PRD §6–§7, §18, §46). Turns game events
 * and player messages into AI lines: templates and stickers immediately,
 * LLM lines asynchronously. Nothing here ever blocks or alters gameplay.
 */
import { assessHand } from '@mahjong/ai-play';
import {
  buildDialogueRequest,
  reunionWeight,
  chooseIntent,
  detectTriggers,
  newDirectorState,
  normalizeReply,
  noteSpoken,
  planSpeech,
  templateLine,
  type BanterLevel,
  type ChatLine,
  type DialogueSettings,
  type Language,
  type Moderator,
  type Rng,
  type Speaker,
  type SpeechPlan,
  type StickerId,
  type Trigger,
} from '@mahjong/dialogue';
import type { GameEvent, HandView, Seat } from '@mahjong/engine';
import type { ChatEntry } from '@mahjong/protocol';
import type { LlmProvider } from './llm/provider';

export interface TalkDeps {
  speakers: Speaker[];
  humanSeat: Seat;
  settings: DialogueSettings;
  idleEveryDiscards: number;
  llm: LlmProvider;
  moderator: Moderator;
  rng: Rng;
  level(): BanterLevel;
  nameOf(seat: Seat): string;
  /** Language the table talks in. */
  language?: Language;
  viewFor(seat: Seat): HandView;
  /** Current engine action count and hand index (relevance window). */
  version(): number;
  handIndex(): number;
  emit(entry: ChatEntry): void;
  now?(): number;
  /** Memory events that went into an LLM prompt (so they are not repeated too often). */
  onMemoryUsed?(eventIds: number[]): void;
  /** A moderated player line, offered to long-term memory. */
  onPlayerQuote?(text: string, target: Seat | 'table'): void;
}

const CHAT_LOG_SIZE = 30;

const weight = (s: Speaker) => (s.memory ? reunionWeight(s.memory) : 0);
/** Minimum spacing between two displayed AI lines. */
const LINE_GAP_MS = 1200;

export class TableTalk {
  private state = newDirectorState();
  private log: ChatEntry[] = [];
  private nextId = 1;
  private discardsSinceLine = 0;
  private nextFreeAt = 0;
  private timers = new Set<NodeJS.Timeout>();
  private disposed = false;
  /** LLM requests still in flight (tests can await them). */
  readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: TalkDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  get chatLog(): ChatEntry[] {
    return [...this.log];
  }

  /** Continues a table conversation saved before a server restart. */
  restoreLog(entries: ChatEntry[]): void {
    this.log = entries.slice(-CHAT_LOG_SIZE);
    this.nextId = Math.max(0, ...entries.map((e) => e.id)) + 1;
  }

  onHandStart(): void {
    this.state.llmRequestsThisHand = 0;
    this.discardsSinceLine = 0;
    // First hand of a game: the character with the most history greets the player (PRD §8).
    if (this.deps.handIndex() === 0) {
      const best = [...this.deps.speakers].sort((a, b) => weight(b) - weight(a))[0];
      if (best && weight(best) > 0) {
        this.handle({ ...this.trigger('reunion', 'high'), subject: best.seat, object: this.deps.humanSeat });
        return;
      }
    }
    this.handle(this.trigger('handStart', 'low'));
  }

  /** Events must already be redacted for the human seat (public information only). */
  onEvents(events: GameEvent[]): void {
    const view = this.deps.viewFor(this.deps.humanSeat);
    const triggers = detectTriggers(events, {
      handIndex: this.deps.handIndex(),
      version: this.deps.version(),
      humanSeat: this.deps.humanSeat,
      view,
    });
    for (const t of triggers) this.handle(t);

    this.discardsSinceLine += events.filter((e) => e.type === 'discard').length;
    if (view.phase === 'play' && this.discardsSinceLine >= this.deps.idleEveryDiscards) {
      this.discardsSinceLine = 0;
      this.handle(this.trigger('idle', 'low'));
    }
  }

  /** A moderated player message (PRD §7.1). */
  /** A real player's line; `seat` is the speaker (the host unless a friend at the same table spoke). */
  onPlayerChat(text: string, target: Seat | 'table', seat: Seat = this.deps.humanSeat): void {
    this.record({ seat, kind: 'player', text, sticker: null, target });
    if (seat === this.deps.humanSeat) this.deps.onPlayerQuote?.(text, target);
    this.handle({ ...this.trigger('playerChat', 'high'), subject: seat, object: target === 'table' ? undefined : target, text });
  }

  onQuickPhrase(text: string, seat: Seat = this.deps.humanSeat): void {
    this.record({ seat, kind: 'quickPhrase', text, sticker: null, target: 'table' });
    this.handle({ ...this.trigger('playerQuickPhrase', 'low'), subject: seat, text });
  }

  onSticker(sticker: StickerId, seat: Seat = this.deps.humanSeat): void {
    this.record({ seat, kind: 'sticker', text: null, sticker, target: 'table' });
    this.handle({ ...this.trigger('playerSticker', 'low'), subject: seat, text: sticker });
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private trigger(kind: Trigger['kind'], importance: Trigger['importance']): Trigger {
    return { kind, importance, version: this.deps.version(), handIndex: this.deps.handIndex() };
  }

  private handle(trigger: Trigger): void {
    if (this.disposed) return;
    const plans = planSpeech(trigger, this.deps.speakers, {
      now: this.now(),
      level: this.deps.level(),
      settings: this.deps.settings,
      state: this.state,
      llmAvailable: this.deps.llm.name !== 'none',
      rng: this.deps.rng,
    });
    for (const plan of plans) this.speak(plan, trigger);
  }

  private speak(plan: SpeechPlan, trigger: Trigger): void {
    const speaker = this.deps.speakers.find((s) => s.seat === plan.seat)!;
    const view = this.deps.viewFor(plan.seat);
    const intent = chooseIntent(assessHand(view), speaker.personality, this.deps.settings, trigger, this.deps.rng);
    // Reserve the slot now so the same seat isn't picked again while a line is being prepared.
    noteSpoken(this.state, plan.seat, this.now());
    const level = this.deps.level();
    const target: Seat | 'table' = trigger.subject !== undefined && trigger.subject !== plan.seat ? trigger.subject : 'table';

    const template = () =>
      templateLine(
        {
          trigger,
          seat: plan.seat,
          intent,
          personality: speaker.personality,
          level,
          nameOf: this.deps.nameOf,
          catchphrases: this.deps.language === 'en' ? speaker.character.catchphrasesEn : speaker.character.catchphrases,
          memory: speaker.memory,
          humanSeat: this.deps.humanSeat,
          language: this.deps.language,
        },
        this.deps.rng,
      );
    const sticker = (): StickerId | null => {
      const own = speaker.personality.stickers;
      const chance = speaker.personality.stickerTendency * this.deps.settings.stickerFrequency * 0.4;
      return own.length && this.deps.rng() < chance ? own[Math.floor(this.deps.rng() * own.length)] : null;
    };

    if (plan.mode === 'sticker') {
      const s = speaker.personality.stickers[Math.floor(this.deps.rng() * speaker.personality.stickers.length)];
      if (s) this.schedule(trigger, plan.seat, null, s, target, 'sticker');
      return;
    }
    if (plan.mode === 'template') {
      const text = template();
      if (text) this.schedule(trigger, plan.seat, text, sticker(), target, 'template');
      return;
    }

    this.state.llmRequestsThisHand++;
    const request = buildDialogueRequest({
      character: speaker.character,
      personality: speaker.personality,
      view,
      trigger,
      intent,
      level,
      settings: this.deps.settings,
      humanSeat: this.deps.humanSeat,
      nameOf: this.deps.nameOf,
      recentChat: this.recentChat(),
      handIndex: this.deps.handIndex(),
      memory: speaker.memory,
      language: this.deps.language,
    });
    if (speaker.memory?.events.length) this.deps.onMemoryUsed?.(speaker.memory.events.map((e) => e.id));
    const job = this.deps.llm
      .generate(request)
      .then(async (reply) => {
        if (this.disposed || !this.stillRelevant(trigger)) return;
        const line = reply ? normalizeReply(reply, plan.seat) : null;
        if (line?.text) {
          const verdict = await this.deps.moderator.check(line.text, 'aiLine');
          if (verdict.allowed) {
            this.schedule(trigger, plan.seat, line.text, line.sticker, line.target, 'llm');
            return;
          }
        } else if (line?.sticker) {
          this.schedule(trigger, plan.seat, null, line.sticker, line.target, 'llm');
          return;
        }
        if (reply && line === null) return; // the model chose silence
        const text = template();
        if (text) this.schedule(trigger, plan.seat, text, sticker(), target, 'template');
      })
      .catch((error) => console.warn('Dialogue line failed:', error))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Drop lines whose moment has passed (PRD §6.4). */
  private stillRelevant(trigger: Trigger): boolean {
    if (trigger.handIndex !== this.deps.handIndex()) return trigger.kind === 'handEnd' || trigger.kind === 'huaZhu';
    return this.deps.version() - trigger.version <= this.deps.settings.relevanceWindowActions;
  }

  private schedule(
    trigger: Trigger,
    seat: Seat,
    text: string | null,
    sticker: StickerId | null,
    target: Seat | 'table',
    source: 'template' | 'llm' | 'sticker',
  ): void {
    const now = this.now();
    const natural = source === 'llm' ? 0 : 400 + Math.floor(this.deps.rng() * 700);
    const at = Math.max(now + natural, this.nextFreeAt);
    this.nextFreeAt = at + LINE_GAP_MS;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.disposed || !this.stillRelevant(trigger)) return;
      noteSpoken(this.state, seat, this.now());
      this.discardsSinceLine = 0;
      this.record({ seat, kind: 'ai', text, sticker, target });
      // AI-to-AI chatter: occasionally another character answers (one level deep).
      if (text && trigger.kind !== 'aiSpoke' && this.deps.rng() < this.deps.settings.aiReplyChance) {
        this.handle({ ...this.trigger('aiSpoke', 'low'), subject: seat, object: target === 'table' ? undefined : target, text });
      }
    }, at - now);
    this.timers.add(timer);
  }

  private record(entry: Omit<ChatEntry, 'id' | 'at'>): void {
    const full: ChatEntry = { ...entry, id: this.nextId++, at: this.now() };
    this.log.push(full);
    if (this.log.length > CHAT_LOG_SIZE) this.log.shift();
    this.deps.emit(full);
  }

  private recentChat(): ChatLine[] {
    return this.log
      .filter((e) => e.text)
      .slice(-6)
      .map((e) => ({ seat: e.seat, name: this.deps.nameOf(e.seat), text: e.text!, fromPlayer: e.kind !== 'ai' }));
  }
}

/**
 * One table: 1 human + 3 AI seats playing a multi-hand game.
 * Owns the authoritative engine state, the human decision timer, auto-play
 * (托管), fast-forward and hand-log persistence (PRD §14, §14.1, §40, §41).
 */
import { chooseAction, timeoutAction, type Rng, type SkillLevel } from '@mahjong/ai-play';
import {
  apply,
  createGame,
  isGameOver,
  legalActions,
  recordHand,
  redactEvent,
  SEATS,
  startHand,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type HandResult,
  type HandState,
  type LegalActions,
  type RuleSet,
  type Seat,
} from '@mahjong/engine';
import type { BanterLevel, Character, DialogueSettings, Moderator, Personality, Speaker, StickerId } from '@mahjong/dialogue';
import type { GameSummary, SeatInfo, StakeInfo, TableSnapshot, TimerInfo, TimerKind } from '@mahjong/protocol';
import type { WebSocket } from 'ws';
import type { ServerConfig } from './config';
import type { LlmProvider } from './llm/provider';
import { AiSeat, HumanSeat, type SeatController } from './seats';
import type { HandLog, HandLogStore } from './store';
import { TableTalk } from './talk';

export interface AiSeatSpec {
  character: Character;
  personality: Personality;
  skill: SkillLevel;
}

/** Conversation setup for the room (PRD §6–§7). */
export interface RoomTalkOptions {
  settings: DialogueSettings;
  idleEveryDiscards: number;
  llm: LlmProvider;
  moderator: Moderator;
  /** The player's current banter setting (can change mid-game). */
  banterLevel(): BanterLevel;
}

export interface RoomOptions {
  gameId: string;
  config: ServerConfig;
  ruleSet: RuleSet;
  baseScore: number;
  seed: number;
  humanSeat: Seat;
  human: { playerId: string; name: string; avatar: string };
  /** Three AI opponents, filling the non-human seats in seat order. */
  ai: AiSeatSpec[];
  store: HandLogStore;
  rng: Rng;
  talk: RoomTalkOptions;
  stake: StakeInfo;
  /** Called after every finished hand (coin settlement happens here). */
  onHandEnd?: (room: Room, handIndex: number, result: HandResult) => void;
  /** Called once the whole game is over and nobody needs the room any more. */
  onClosed?: (room: Room) => void;
}

type Source = HandLog['sources'][number];

interface Timer {
  handle: NodeJS.Timeout;
  info: TimerInfo | null;
}

export class Room {
  readonly id: string;
  readonly humanSeat: Seat;
  readonly human: HumanSeat;
  private readonly seats: SeatController[];
  private game: GameState;
  private hand!: HandState;
  private handIndex = 0;
  private log!: HandLog;
  private autoPlay = false;
  private consecutiveTimeouts = 0;
  private fastForward = false;
  private timer: Timer | null = null;
  private closed = false;
  private readonly talk: TableTalk;
  private coinChange = 0;

  constructor(private readonly opts: RoomOptions) {
    this.id = opts.gameId;
    this.humanSeat = opts.humanSeat;
    this.game = createGame({ ruleSet: opts.ruleSet, baseScore: opts.baseScore, seed: opts.seed });

    const ai = [...opts.ai];
    const speakers: Speaker[] = [];
    this.human = new HumanSeat(
      { seat: opts.humanSeat, name: opts.human.name, avatar: opts.human.avatar, isHuman: true },
      opts.human.playerId,
    );
    this.seats = SEATS.map((seat) => {
      if (seat === opts.humanSeat) return this.human;
      const spec = ai.shift()!;
      const { character, personality } = spec;
      speakers.push({ seat, character, personality });
      const info: SeatInfo = { seat, name: character.name, avatar: character.avatar, isHuman: false, personality: personality.name };
      return new AiSeat(info, spec.skill, opts.rng, (skill) => this.aiThinkMs(skill), (action, version) =>
        this.submit({ ...action, seat }, version, 'ai'),
      );
    });

    this.talk = new TableTalk({
      speakers,
      humanSeat: opts.humanSeat,
      settings: opts.talk.settings,
      idleEveryDiscards: opts.talk.idleEveryDiscards,
      llm: opts.talk.llm,
      moderator: opts.talk.moderator,
      rng: opts.rng,
      level: opts.talk.banterLevel,
      nameOf: (seat) => this.seats[seat].info.name,
      viewFor: (seat) => viewFor(this.hand, seat),
      version: () => this.hand.actionCount,
      handIndex: () => this.handIndex,
      emit: (entry) => this.human.send({ type: 'chat', entry }),
    });
  }

  /** In-flight LLM dialogue requests (for tests). */
  get pendingDialogue(): Promise<unknown> {
    return Promise.all([...this.talk.pending]);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get gameOver(): boolean {
    return isGameOver(this.game) && this.hand?.phase === 'ended';
  }

  /** Attach the player's socket first, so the opening turns are not treated as unattended. */
  start(socket?: WebSocket): void {
    if (socket) this.human.attach(socket);
    this.beginHand();
  }

  // -------------------------------------------------------------------------
  // Human intents
  // -------------------------------------------------------------------------

  attach(socket: WebSocket): void {
    this.human.attach(socket);
    this.publish([]);
  }

  detach(socket: WebSocket): void {
    this.human.detach(socket);
    // PRD §14.1: a disconnected player's seat is auto-played until they return.
    if (!this.closed) this.setAutoPlay(true);
  }

  /** Returns an error message, or null when accepted (stale actions are silently ignored). */
  humanAction(action: Action, version: number): string | null {
    const result = this.submit({ ...action, seat: this.humanSeat }, version, 'human');
    if (result === null) this.consecutiveTimeouts = 0;
    return result === 'stale' ? null : result;
  }

  setAutoPlay(on: boolean): void {
    if (this.autoPlay === on) return;
    this.autoPlay = on;
    this.consecutiveTimeouts = 0;
    this.publish([]);
  }

  /** "Skip to results" once the human has won (PRD §14). */
  skipToResults(): void {
    if (this.hand.phase !== 'play' || !this.hand.players[this.humanSeat].won) return;
    this.fastForward = true;
    for (const s of this.seats) if (s instanceof AiSeat) s.reset();
    this.publish([]);
  }

  nextHand(): void {
    if (this.hand.phase !== 'ended' || isGameOver(this.game)) return;
    this.beginHand();
  }

  /** Leaving never voids settlement: the seat is auto-played to the end (PRD §14.1). */
  leave(): void {
    this.human.detach();
    if (this.gameOver) this.close();
    else this.setAutoPlay(true);
  }

  /** A moderated player chat message. */
  playerChat(text: string, target: Seat | 'table'): void {
    if (!this.closed) this.talk.onPlayerChat(text, target);
  }

  quickPhrase(text: string): void {
    if (!this.closed) this.talk.onQuickPhrase(text);
  }

  sticker(id: StickerId): void {
    if (!this.closed) this.talk.onSticker(id);
  }

  snapshot(): TableSnapshot {
    return this.snapshotFor(this.humanSeat);
  }

  /** Records settled coins (for display); called by the lobby after the wallet update. Returns the game total. */
  addCoinChange(amount: number): number {
    this.coinChange += amount;
    return this.coinChange;
  }

  get coinTotal(): number {
    return this.coinChange;
  }

  summary(): GameSummary {
    return {
      gameId: this.id,
      stake: this.opts.stake,
      handsPlayed: this.game.handIndex,
      totals: this.game.totals,
      mySeat: this.humanSeat,
      seats: this.seats.map((s) => s.info),
      coinChange: this.coinChange,
      endedAt: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Core loop
  // -------------------------------------------------------------------------

  private beginHand(): void {
    this.hand = startHand(this.game);
    this.handIndex = this.game.handIndex;
    this.fastForward = false;
    this.log = {
      gameId: this.id,
      handIndex: this.handIndex,
      playerId: this.human.playerId,
      seed: this.hand.seed,
      dealer: this.hand.dealer,
      baseScore: this.hand.baseScore,
      ruleSet: this.hand.ruleSet,
      seats: this.seats.map((s) => ({
        seat: s.info.seat,
        name: s.info.name,
        isHuman: s.info.isHuman,
        skill: s instanceof AiSeat ? s.skill : undefined,
      })),
      actions: [],
      sources: [],
      result: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.publish([]);
    this.talk.onHandStart();
  }

  /** Applies an action from any seat. Returns null, 'stale', or an error message. */
  private submit(action: Action, version: number, source: Source): string | null {
    if (this.closed) return 'room closed';
    if (version !== this.hand.actionCount) return 'stale';
    let events: GameEvent[];
    try {
      const result = apply(this.hand, action);
      this.hand = result.state;
      events = result.events;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    this.log.actions.push(action);
    this.log.sources.push(source);

    if (this.hand.phase === 'ended') {
      this.game = recordHand(this.game, this.hand.result!);
      this.log.result = this.hand.result;
      this.log.endedAt = new Date().toISOString();
      void this.opts.store.save(this.log).catch((err) => console.error('Failed to save hand log', err));
      this.opts.onHandEnd?.(this, this.handIndex, this.hand.result!);
    }
    this.publish(events);
    // Conversation sees only public information (events redacted for the human seat).
    this.talk.onEvents(events.map((e) => redactEvent(e, this.humanSeat)));
    return null;
  }

  private publish(events: GameEvent[]): void {
    if (this.closed) return;
    this.scheduleHuman();
    for (const seat of SEATS) {
      const view = viewFor(this.hand, seat);
      this.seats[seat].update({
        view,
        events: events.map((e) => redactEvent(e, seat)),
        snapshot: this.snapshotFor(seat),
        mustAct: hasDecision(view.legal),
      });
    }
  }

  /** Sets the human seat's timer: a countdown, an auto-play move, or the next-hand timer. */
  private scheduleHuman(): void {
    this.clearTimer();
    const { timers } = this.opts.config;
    const seat = this.humanSeat;
    const unattended = this.autoPlay || !this.human.connected;

    if (this.hand.phase === 'ended') {
      if (isGameOver(this.game)) {
        if (!this.human.connected) this.close();
        return;
      }
      const ms = unattended ? timers.nextHandAutoPlayMs : timers.nextHandMs;
      this.setTimer(ms, 'nextHand', () => this.nextHand());
      return;
    }

    const legal = legalActions(this.hand, seat);
    if (!hasDecision(legal)) return;
    const version = this.hand.actionCount;

    if (unattended) {
      // 托管 plays like an intermediate player and does declare wins.
      const delay = this.fastForward || !this.human.connected ? 0 : this.opts.config.autoPlayDelayMs;
      this.setTimer(delay, null, () => {
        const action = chooseAction(viewFor(this.hand, seat), 'intermediate', this.opts.rng);
        if (action) this.submit(action, version, 'autoPlay');
      });
      return;
    }

    const kind = timerKind(legal);
    this.setTimer(timerDuration(kind, this.opts.config), kind, () => {
      this.consecutiveTimeouts++;
      if (this.consecutiveTimeouts >= this.opts.config.autoPlayAfterTimeouts) this.autoPlay = true;
      const action = timeoutAction(viewFor(this.hand, seat), this.opts.rng);
      if (action) this.submit(action, version, 'timeout');
    });
  }

  private setTimer(ms: number, kind: TimerKind | null, fn: () => void): void {
    const deadline = Date.now() + ms;
    const handle = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
    this.timer = { handle, info: kind ? { kind, deadline, remainingMs: ms, durationMs: ms } : null };
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private aiThinkMs(skill: SkillLevel): number {
    const humanWon = this.hand.players[this.humanSeat].won !== null;
    // Nobody is watching: finish quickly.
    if ((this.fastForward && humanWon) || !this.human.connected) return 0;
    const { minDelayMs, maxDelayMs, beginnerExtraMs } = this.opts.config.ai;
    const extra = skill === 'beginner' ? beginnerExtraMs : 0;
    return minDelayMs + Math.floor(this.opts.rng() * (maxDelayMs - minDelayMs)) + extra;
  }

  private snapshotFor(seat: Seat): TableSnapshot {
    const timer = seat === this.humanSeat && this.timer?.info ? { ...this.timer.info } : null;
    if (timer) timer.remainingMs = Math.max(0, timer.deadline - Date.now());
    return {
      gameId: this.id,
      handIndex: this.handIndex,
      handsPerGame: this.game.config.ruleSet.handsPerGame,
      mySeat: seat,
      seats: this.seats.map((s) => s.info),
      totals: this.game.totals,
      view: viewFor(this.hand, seat),
      timer,
      autoPlay: this.autoPlay,
      fastForward: this.fastForward,
      gameOver: this.gameOver,
      chat: this.talk.chatLog,
      stake: this.opts.stake,
      coinChange: this.coinChange,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.talk.dispose();
    for (const s of this.seats) s.dispose();
    this.opts.onClosed?.(this);
  }
}

function hasDecision(legal: LegalActions): boolean {
  return Object.keys(legal).length > 0;
}

function timerKind(legal: LegalActions): TimerKind {
  if (legal.swapSuits) return 'swap';
  if (legal.dingque) return 'dingque';
  if (legal.discard) return 'discard';
  return 'claim';
}

function timerDuration(kind: TimerKind, config: ServerConfig): number {
  const t = config.timers;
  switch (kind) {
    case 'swap':
      return t.swapMs;
    case 'dingque':
      return t.dingqueMs;
    case 'discard':
      return t.discardMs;
    case 'claim':
      return t.claimMs;
    case 'nextHand':
      return t.nextHandMs;
  }
}

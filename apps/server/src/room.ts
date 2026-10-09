/**
 * One table: 1 human + 3 AI seats playing a multi-hand game.
 * Owns the authoritative engine state, the human decision timer, auto-play
 * (托管), fast-forward and hand-log persistence (PRD §14, §14.1, §40, §41).
 */
import { chooseAction, timeoutAction, type Rng, type SkillLevel } from '@mahjong/ai-play';
import { randomBytes } from 'node:crypto';
import {
  apply,
  createGame,
  dealCommitment,
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
import type { BanterLevel, Character, CharacterMemory, DialogueSettings, Language, Moderator, Personality, Speaker, StickerId } from '@mahjong/dialogue';
import type { ChatEntry, DealProof, GameSummary, SeatInfo, ServerMessage, StakeInfo, TableSnapshot, TimerInfo, TimerKind } from '@mahjong/protocol';
import type { WebSocket } from 'ws';
import type { ServerConfig } from './config';
import type { LlmProvider } from './llm/provider';
import { after, type Cancel, type Pacer } from './pacer';
import { AiSeat, EmptySeat, HumanSeat, type SeatController } from './seats';
import type { HandLog, HandLogStore } from './store';
import { TableTalk } from './talk';

export interface AiSeatSpec {
  character: Character;
  personality: Personality;
  skill: SkillLevel;
  /** What this character remembers about the player (Phase 4). */
  memory?: CharacterMemory | null;
}

/** Conversation setup for the room (PRD §6–§7). */
export interface RoomTalkOptions {
  settings: DialogueSettings;
  idleEveryDiscards: number;
  llm: LlmProvider;
  moderator: Moderator;
  /** The player's current banter setting (can change mid-game). */
  banterLevel(): BanterLevel;
  /** Language the AI players talk in. */
  language?: Language;
  onMemoryUsed?(eventIds: number[]): void;
  onPlayerQuote?(text: string, target: Seat | 'table'): void;
  /** Every line said at the table (chat log, Appendix D.6). */
  onLine?(entry: ChatEntry, speaker: string): void;
}

export interface RoomOptions {
  gameId: string;
  config: ServerConfig;
  ruleSet: RuleSet;
  baseScore: number;
  seed: number;
  humanSeat: Seat;
  human: { playerId: string; name: string; avatar: string };
  /** Friend room: the other real players and their seats (the host is `human`). */
  guests?: { seat: Seat; playerId: string; name: string; avatar: string }[];
  /** AI opponents, filling the remaining seats in play, in seat order. */
  ai: AiSeatSpec[];
  store: HandLogStore;
  rng: Rng;
  talk: RoomTalkOptions;
  stake: StakeInfo;
  /** Called after every finished hand (coin settlement happens here). */
  onHandEnd?: (room: Room, handIndex: number, result: HandResult) => void;
  /** Called once the whole game is over and nobody needs the room any more. */
  onClosed?: (room: Room) => void;
  /** Shared pace for unattended games; without it they run on plain timers. */
  pacer?: Pacer;
  /** Called whenever the game state changed (for checkpointing). */
  onChange?: (room: Room) => void;
  /** Rebuild from a checkpoint instead of starting a new game; call `resume` instead of `start`. */
  restore?: RoomCheckpoint;
  /** Settled coins so far in a restored game. */
  coinChange?: number;
}

type Source = HandLog['sources'][number];

/** Everything needed to rebuild a room after a server restart (engine state is plain data). */
export interface RoomCheckpoint {
  gameId: string;
  humanSeat: Seat;
  ai: { characterId: string; skill: SkillLevel }[];
  game: GameState;
  hand: HandState;
  log: HandLog;
  autoPlay: boolean;
  chat: ChatEntry[];
}

interface Timer {
  cancel: Cancel;
  info: TimerInfo | null;
}

/** Per real player at the table: their own countdown, 托管 and readiness for the next hand. */
interface HumanState {
  seat: Seat;
  ctrl: HumanSeat;
  autoPlay: boolean;
  consecutiveTimeouts: number;
  timer: Timer | null;
  /** Pressed "next hand" (friend rooms wait for everyone, or the timer). */
  ready: boolean;
}

export class Room {
  readonly id: string;
  /** The host (the only player outside friend rooms). */
  readonly humanSeat: Seat;
  readonly human: HumanSeat;
  private readonly seats: SeatController[];
  private readonly humans: HumanState[];
  private game: GameState;
  private hand!: HandState;
  private handIndex = 0;
  private log!: HandLog;
  /** Quick pace (player setting): AI think time and auto-play delay cut to a fraction. Single-player only. */
  private fastPace = false;
  private fastForward = false;
  /** The table-wide timer between hands. */
  private nextHandTimer: Timer | null = null;
  private closed = false;
  private readonly talk: TableTalk;
  private coinChange = 0;
  /** A restored room waits for its player (or the grace period) before play continues. */
  private paused = false;
  private graceTimer: NodeJS.Timeout | null = null;
  /** AI seats and the characters sitting in them. */
  readonly aiSeats: { seat: Seat; characterId: string; name: string }[];

  constructor(private readonly opts: RoomOptions) {
    this.id = opts.gameId;
    this.humanSeat = opts.humanSeat;
    this.game = opts.restore?.game ?? createGame({ ruleSet: opts.ruleSet, baseScore: opts.baseScore, seed: opts.seed });

    const ai = [...opts.ai];
    const speakers: Speaker[] = [];
    this.human = new HumanSeat(
      { seat: opts.humanSeat, name: opts.human.name, avatar: opts.human.avatar, isHuman: true },
      opts.human.playerId,
    );
    const guests = new Map((opts.guests ?? []).map((g) => [g.seat, new HumanSeat({ seat: g.seat, name: g.name, avatar: g.avatar, isHuman: true }, g.playerId)]));
    this.seats = SEATS.map((seat) => {
      if (seat === opts.humanSeat) return this.human;
      const guest = guests.get(seat);
      if (guest) return guest;
      if (!this.game.config.ruleSet.seats.includes(seat)) return new EmptySeat(seat);
      const spec = ai.shift()!;
      const { character, personality } = spec;
      speakers.push({ seat, character, personality, memory: spec.memory ?? null });
      const en = opts.talk.language === 'en';
      const info: SeatInfo = {
        seat,
        name: (en && character.nameEn) || character.name,
        avatar: character.avatar,
        isHuman: false,
        personality: (en && personality.nameEn) || personality.name,
      };
      return new AiSeat(
        info,
        spec.skill,
        opts.rng,
        (skill) => this.aiThinkMs(skill),
        (action, version) => this.submit({ ...action, seat }, version, 'ai'),
        (ms, fn) => this.delay(ms, fn),
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
      language: opts.talk.language,
      viewFor: (seat) => viewFor(this.hand, seat),
      version: () => this.hand.actionCount,
      handIndex: () => this.handIndex,
      emit: (entry) => {
        for (const h of this.humans) h.ctrl.send({ type: 'chat', entry });
        opts.talk.onLine?.(entry, this.seats[entry.seat].info.name);
      },
      onMemoryUsed: opts.talk.onMemoryUsed,
      onPlayerQuote: opts.talk.onPlayerQuote,
    });
    this.aiSeats = speakers.map((s) => ({ seat: s.seat, characterId: s.character.id, name: s.character.name }));
    this.humans = this.seats
      .filter((s): s is HumanSeat => s instanceof HumanSeat)
      .map((ctrl) => ({ seat: ctrl.info.seat, ctrl, autoPlay: false, consecutiveTimeouts: 0, timer: null, ready: false }));

    const r = opts.restore;
    if (r) {
      this.hand = r.hand;
      this.handIndex = r.hand.phase === 'ended' ? r.game.handIndex - 1 : r.game.handIndex;
      this.log = r.log;
      this.stateOf(this.humanSeat).autoPlay = r.autoPlay;
      this.coinChange = opts.coinChange ?? 0;
      this.talk.restoreLog(r.chat);
    }
  }

  checkpoint(): RoomCheckpoint {
    return {
      gameId: this.id,
      humanSeat: this.humanSeat,
      ai: this.seats.filter((s): s is AiSeat => s instanceof AiSeat).map((s, i) => ({ characterId: this.aiSeats[i].characterId, skill: s.skill })),
      game: this.game,
      hand: this.hand,
      log: this.log,
      autoPlay: this.stateOf(this.humanSeat).autoPlay,
      chat: this.talk.chatLog,
    };
  }

  /** More than one real player (a friend room). */
  get multiplayer(): boolean {
    return this.humans.length > 1;
  }

  /** The seat of a real player at this table, or null. */
  seatOf(playerId: string): Seat | null {
    return this.humans.find((h) => h.ctrl.playerId === playerId)?.seat ?? null;
  }

  /** Sends a message to the real player in `seat` (if connected). */
  sendTo(seat: Seat, message: ServerMessage): void {
    this.humans.find((h) => h.seat === seat)?.ctrl.send(message);
  }

  /** Every real player at the table. */
  get players(): { seat: Seat; playerId: string; name: string; connected: boolean }[] {
    return this.humans.map((h) => ({ seat: h.seat, playerId: h.ctrl.playerId, name: h.ctrl.info.name, connected: h.ctrl.connected }));
  }

  private stateOf(seat: Seat): HumanState {
    return this.humans.find((h) => h.seat === seat)!;
  }

  private get anyoneWatching(): boolean {
    return this.humans.some((h) => h.ctrl.connected);
  }

  /** Continues a restored game once the player reconnects, or after `graceMs` without them. */
  resume(graceMs: number): void {
    this.paused = true;
    this.graceTimer = setTimeout(() => this.unpause(), graceMs);
  }

  private unpause(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    for (const h of this.humans) if (!h.ctrl.connected) h.autoPlay = true;
    this.publish([]);
  }

  /** The hand on the table has finished (a restored room may need its settlement re-run). */
  get handEnded(): boolean {
    return this.hand.phase === 'ended';
  }

  get currentHandIndex(): number {
    return this.handIndex;
  }

  get lastResult(): HandResult | null {
    return this.hand.result;
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

  /** Attach the players' sockets first, so the opening turns are not treated as unattended. */
  start(socket?: WebSocket, guestSockets: Map<Seat, WebSocket> = new Map()): void {
    if (socket) this.human.attach(socket);
    for (const [seat, s] of guestSockets) this.stateOf(seat).ctrl.attach(s);
    this.beginHand();
  }

  // -------------------------------------------------------------------------
  // Human intents
  // -------------------------------------------------------------------------

  attach(socket: WebSocket, seat: Seat = this.humanSeat): void {
    this.stateOf(seat).ctrl.attach(socket);
    if (this.paused) this.unpause();
    else this.publish([]);
  }

  detach(socket: WebSocket): void {
    for (const h of this.humans) {
      // The socket is already closed when this runs, so match it rather than its state.
      if (!h.ctrl.holds(socket)) continue;
      h.ctrl.detach(socket);
      // PRD §14.1: a disconnected player's seat is auto-played until they return.
      if (!this.closed && !this.paused) this.setAutoPlay(true, h.seat);
    }
  }

  /** Returns an error message, or null when accepted (stale actions are silently ignored). */
  humanAction(action: Action, version: number, seat: Seat = this.humanSeat): string | null {
    const result = this.submit({ ...action, seat }, version, 'human');
    if (result === null) this.stateOf(seat).consecutiveTimeouts = 0;
    return result === 'stale' ? null : result;
  }

  setAutoPlay(on: boolean, seat: Seat = this.humanSeat): void {
    const h = this.stateOf(seat);
    if (h.autoPlay === on) return;
    h.autoPlay = on;
    h.consecutiveTimeouts = 0;
    this.publish([]);
  }

  setFastPace(on: boolean): void {
    // One player's pace setting would speed up everyone else's game.
    if (this.multiplayer || this.fastPace === on) return;
    this.fastPace = on;
    this.publish([]);
  }

  /** "Skip to results" once the human has won (PRD §14); not in friend rooms, where others are still playing. */
  skipToResults(): void {
    // In 血流成河 the winner is still playing, so there is nothing to skip to.
    if (this.multiplayer || this.hand.ruleSet.xueliu || this.hand.phase !== 'play' || !this.hand.players[this.humanSeat].won) return;
    this.fastForward = true;
    for (const s of this.seats) if (s instanceof AiSeat) s.reset();
    this.publish([]);
  }

  /** In a friend room the next hand starts once every attending player is ready (or the timer runs out). */
  nextHand(seat: Seat = this.humanSeat): void {
    if (this.hand.phase !== 'ended' || isGameOver(this.game)) return;
    this.stateOf(seat).ready = true;
    const waiting = this.humans.some((h) => !h.ready && h.ctrl.connected && !h.autoPlay);
    if (waiting) return void this.publish([]);
    this.beginHand();
  }

  /** Leaving never voids settlement: the seat is auto-played to the end (PRD §14.1). */
  leave(seat: Seat = this.humanSeat): void {
    this.stateOf(seat).ctrl.detach();
    if (this.gameOver && !this.anyoneWatching) this.close();
    else this.setAutoPlay(true, seat);
  }

  /** A moderated player chat message. */
  playerChat(text: string, target: Seat | 'table', seat: Seat = this.humanSeat): void {
    if (!this.closed) this.talk.onPlayerChat(text, target, seat);
  }

  quickPhrase(text: string, seat: Seat = this.humanSeat): void {
    if (!this.closed) this.talk.onQuickPhrase(text, seat);
  }

  sticker(id: StickerId, seat: Seat = this.humanSeat): void {
    if (!this.closed) this.talk.onSticker(id, seat);
  }

  snapshot(seat: Seat = this.humanSeat): TableSnapshot {
    return this.snapshotFor(seat);
  }

  /** Records settled coins (for display); called by the lobby after the wallet update. Returns the game total. */
  addCoinChange(amount: number): number {
    this.coinChange += amount;
    return this.coinChange;
  }

  /** A recent table line by id (for reports). */
  chatEntry(id: number) {
    return this.talk.chatLog.find((e) => e.id === id) ?? null;
  }

  /** Final game totals per seat. */
  get totals(): readonly number[] {
    return this.game.totals;
  }

  get coinTotal(): number {
    return this.coinChange;
  }

  summary(seat: Seat = this.humanSeat): GameSummary {
    return {
      gameId: this.id,
      stake: this.opts.stake,
      handsPlayed: this.game.handIndex,
      totals: this.game.totals,
      mySeat: seat,
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
    for (const h of this.humans) h.ready = false;
    this.log = {
      gameId: this.id,
      handIndex: this.handIndex,
      playerId: this.human.playerId,
      seed: this.hand.seed,
      salt: randomBytes(16).toString('hex'),
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
      // Every real player gets the hand in their own history.
      for (const h of this.humans) {
        const log = h.seat === this.humanSeat ? this.log : { ...this.log, playerId: h.ctrl.playerId };
        void this.opts.store.save(log).catch((err) => console.error('Failed to save hand log', err));
      }
      this.opts.onHandEnd?.(this, this.handIndex, this.hand.result!);
    }
    this.publish(events);
    // Conversation sees only public information: redacted for the player, or for nobody when several share the table.
    const viewer = this.multiplayer ? NOBODY : this.humanSeat;
    this.talk.onEvents(events.map((e) => redactEvent(e, viewer)));
    return null;
  }

  private publish(events: GameEvent[]): void {
    if (this.closed || this.paused) return;
    this.opts.onChange?.(this);
    this.scheduleHumans();
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

  /** Sets every real player's timer (a countdown or an auto-play move), and the table's next-hand timer. */
  private scheduleHumans(): void {
    this.clearTimers();
    const { timers } = this.opts.config;

    if (this.hand.phase === 'ended') {
      if (isGameOver(this.game)) {
        if (!this.anyoneWatching) this.close();
        return;
      }
      const attended = this.humans.some((h) => h.ctrl.connected && !h.autoPlay);
      const ms = attended ? timers.nextHandMs : timers.nextHandAutoPlayMs;
      const deadline = Date.now() + ms;
      const cancel = this.delay(ms, () => {
        this.nextHandTimer = null;
        if (this.hand.phase === 'ended' && !isGameOver(this.game)) this.beginHand();
      });
      this.nextHandTimer = { cancel, info: { kind: 'nextHand', deadline, remainingMs: ms, durationMs: ms } };
      return;
    }

    for (const h of this.humans) this.scheduleSeat(h);
  }

  private scheduleSeat(h: HumanState): void {
    const seat = h.seat;
    const legal = legalActions(this.hand, seat);
    if (!hasDecision(legal)) return;
    const version = this.hand.actionCount;

    // 血流成河: a winner's locked hand throws what it draws by itself; the player is only asked when it could win again.
    const lockedThrow = this.hand.ruleSet.xueliu && this.hand.players[seat].won !== null && !legal.zimo && !legal.hu;
    if (h.autoPlay || !h.ctrl.connected || lockedThrow) {
      // 托管 plays like an intermediate player and does declare wins.
      const delay = this.fastForward || !h.ctrl.connected ? 0 : this.opts.config.autoPlayDelayMs * (this.fastPace ? FAST_PACE : 1);
      this.setSeatTimer(h, delay, null, () => {
        const action = chooseAction(viewFor(this.hand, seat), 'intermediate', this.opts.rng);
        if (action) this.submit(action, version, 'autoPlay');
      });
      return;
    }

    const kind = timerKind(legal);
    const { config } = this.opts;
    const practice = this.opts.stake.multiplier === 0;
    const ms = timerDuration(kind, config) * (practice ? config.practice.timerScale : 1);
    const autoPlayAfter = practice ? config.practice.autoPlayAfterTimeouts : config.autoPlayAfterTimeouts;
    this.setSeatTimer(h, ms, kind, () => {
      h.consecutiveTimeouts++;
      if (h.consecutiveTimeouts >= autoPlayAfter) h.autoPlay = true;
      const action = timeoutAction(viewFor(this.hand, seat), this.opts.rng);
      if (action) this.submit(action, version, 'timeout');
    });
  }

  private setSeatTimer(h: HumanState, ms: number, kind: TimerKind | null, fn: () => void): void {
    const deadline = Date.now() + ms;
    const cancel = this.delay(ms, () => {
      h.timer = null;
      fn();
    });
    h.timer = { cancel, info: kind ? { kind, deadline, remainingMs: ms, durationMs: ms } : null };
  }

  /** Immediate steps of a game nobody is watching go through the shared pacer. */
  private delay(ms: number, fn: () => void): Cancel {
    if (ms === 0 && !this.anyoneWatching && this.opts.pacer) return this.opts.pacer.schedule(fn);
    return after(ms, fn);
  }

  private clearTimers(): void {
    for (const h of this.humans) {
      h.timer?.cancel();
      h.timer = null;
    }
    this.nextHandTimer?.cancel();
    this.nextHandTimer = null;
  }

  private aiThinkMs(skill: SkillLevel): number {
    const humanWon = this.hand.players[this.humanSeat].won !== null;
    // Nobody is watching: finish quickly.
    if ((this.fastForward && humanWon) || !this.anyoneWatching) return 0;
    const { minDelayMs, maxDelayMs, beginnerExtraMs } = this.opts.config.ai;
    const extra = skill === 'beginner' ? beginnerExtraMs : 0;
    const ms = minDelayMs + Math.floor(this.opts.rng() * (maxDelayMs - minDelayMs)) + extra;
    return this.fastPace ? Math.round(ms * FAST_PACE) : ms;
  }

  private snapshotFor(seat: Seat): TableSnapshot {
    const h = this.humans.find((x) => x.seat === seat);
    const info = this.hand.phase === 'ended' ? this.nextHandTimer?.info : h?.timer?.info;
    const timer = h && info ? { ...info } : null;
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
      autoPlay: h?.autoPlay ?? false,
      fastForward: this.fastForward,
      fastPace: this.fastPace,
      deal: this.dealProof(),
      gameOver: this.gameOver,
      chat: this.talk.chatLog,
      stake: this.opts.stake,
      coinChange: this.coinChange,
    };
  }

  /** The commitment for this hand's deal; seed and salt only once the hand is over. */
  private dealProof(): DealProof {
    const salt = this.log.salt ?? '';
    const over = this.hand.phase === 'ended';
    return { commitment: dealCommitment(this.log.seed, salt), seed: over ? this.log.seed : null, salt: over ? salt : null };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.talk.dispose();
    for (const s of this.seats) s.dispose();
    this.opts.onClosed?.(this);
  }
}

/** A viewer who owns no seat: redacting for it leaves only public information. */
const NOBODY = -1 as Seat;

/** Share of the normal AI think time and auto-play delay used at quick pace. */
const FAST_PACE = 0.3;

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

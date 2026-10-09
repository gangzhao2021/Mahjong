/** Authenticated connections, game start checks, coin settlement and room lifecycle. */
import type { Rng } from '@mahjong/ai-play';
import { BANTER_LEVELS, extractHandMemory, gameEndRivalry, selectCharacters, STICKERS, textLength, type Language, type Moderator, type StickerId } from '@mahjong/dialogue';
import { createRng, isValidTile, type Action, type HandResult, type Seat } from '@mahjong/engine';
import {
  PROTOCOL_VERSION,
  type ChatCatalog,
  type ClientMessage,
  type ErrorCode,
  type GameSummary,
  type ServerMessage,
} from '@mahjong/protocol';
import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { PlayerRow } from './accounts/accounts';
import { ChatGuard } from './chatGuard';
import type { ServerConfig } from './config';
import type { DialogueConfig } from './dialogueConfig';
import type { LlmProvider } from './llm/provider';
import { summarizeGame } from './memory/summarizer';
import { Pacer } from './pacer';
import { Room, type AiSeatSpec, type RoomCheckpoint } from './room';
import { accountSummary, checkStart, type GamePlan, type Services } from './services';
import { AlreadyClaimedError } from './economy/rewards';
import { FriendTables, type FriendTable } from './friends';
import type { HandLogStore } from './store';

export interface LobbyDeps {
  config: ServerConfig;
  dialogue: DialogueConfig;
  llm: LlmProvider;
  moderator: Moderator;
  hands: HandLogStore;
  services: Services;
  /** Seed source; injectable for deterministic tests. */
  seed?: () => number;
}

/** Warning before a play-time limit ends a game (Appendix D.3). */
const LIMIT_WARNING_MS = 5 * 60_000;
/** Checkpoint writes are batched: at most one per table this often. */
const CHECKPOINT_DEBOUNCE_MS = 250;

interface SavedGame {
  room: RoomCheckpoint;
  plan: GamePlan;
  language?: Language;
}

export class Lobby {
  /** Active room per player. */
  private rooms = new Map<string, Room>();
  /** Play-time limit timers per player (China minors / guest trial). */
  private limitTimers = new Map<string, NodeJS.Timeout[]>();
  /** Open sockets per player, so an admin action can disconnect them. */
  private sockets = new Map<string, Set<WebSocket>>();
  /** Settlement work in flight (tests can await it). */
  readonly settling = new Set<Promise<void>>();
  /** Pending checkpoint writes per player. */
  private saveTimers = new Map<string, { timer: NodeJS.Timeout; write: () => Promise<void> }>();
  /** Checkpoint writes in flight per player; a change during a write is saved right after it. */
  private writing = new Map<string, Promise<void>>();
  /** Shutting down: rooms close but their checkpoints are kept for the next start. */
  private stopping = false;
  private rng: Rng;
  private chatGuard: ChatGuard;
  /** Shared pace for games nobody is watching. */
  private readonly pacer: Pacer;
  /** UI language per player, from their latest hello. */
  private languages = new Map<string, Language>();
  /** Friend rooms waiting for their host to start. */
  private readonly friends: FriendTables;

  constructor(private readonly deps: LobbyDeps) {
    this.rng = createRng(this.nextSeed());
    this.chatGuard = new ChatGuard(deps.dialogue.chat);
    this.pacer = new Pacer(deps.config.unattendedActionsPerSecond);
    this.friends = new FriendTables(
      (playerId, room) => this.sendToPlayer(playerId, { type: 'friendRoom', room }),
      (playerId) => (this.sockets.get(playerId)?.size ?? 0) > 0,
      () => this.rng(),
    );
  }

  /** Sends to every open socket of a player. */
  private sendToPlayer(playerId: string, message: ServerMessage): void {
    for (const socket of this.sockets.get(playerId) ?? []) if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  /** The seat a player holds in their room (the host seat outside friend rooms). */
  private seatIn(room: Room, playerId: string): Seat {
    return room.seatOf(playerId) ?? room.humanSeat;
  }

  /** Chat catalog in the player's language (quick phrases are admin-configurable, so built per request). */
  private catalogFor(language: Language): ChatCatalog {
    const en = language === 'en';
    return {
      quickPhrases: this.deps.dialogue.quickPhrases.map((q) => ({ id: q.id, text: (en && q.textEn) || q.text })),
      stickers: (Object.keys(STICKERS) as StickerId[]).map((id) => ({ id, emoji: STICKERS[id].emoji, label: en ? STICKERS[id].labelEn : STICKERS[id].label })),
    };
  }

  private languageOf(playerId: string): Language {
    return this.languages.get(playerId) ?? 'zh';
  }

  private get s(): Services {
    return this.deps.services;
  }

  roomOf(playerId: string): Room | undefined {
    return this.rooms.get(playerId);
  }

  private banterOf(player: PlayerRow) {
    return player.banter_level ?? this.deps.dialogue.defaultBanter;
  }

  handleConnection(socket: WebSocket): void {
    let player: PlayerRow | null = null;
    let sessionId: Promise<number | null> | null = null;
    const send = (m: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    const fail = (code: ErrorCode, message: string) => send({ type: 'error', code, message });

    socket.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
        if (!msg || typeof msg.type !== 'string') throw new Error('missing type');
      } catch {
        fail('badMessage', 'Malformed message');
        return;
      }

      try {
        if (msg.type === 'hello') {
          if (msg.protocol !== PROTOCOL_VERSION) return fail('protocolMismatch', `Server speaks protocol ${PROTOCOL_VERSION}`);
          player = await this.s.accounts.authenticate(msg.token);
          if (!player) return fail('unauthorized', 'Invalid or expired session');
          // The China build talks Chinese only (Appendix D); older clients send no locale.
          const language: Language = this.s.region !== 'china' && msg.locale === 'en' ? 'en' : 'zh';
          this.languages.set(player.id, language);
          if (!this.sockets.has(player.id)) this.sockets.set(player.id, new Set());
          this.sockets.get(player.id)!.add(socket);
          // Play session for analytics (DAU, session length — PRD §33).
          sessionId ??= this.s.db
            .query<{ id: string }>('INSERT INTO play_sessions (player_id, started_at) VALUES ($1, $2) RETURNING id', [player.id, this.s.now()])
            .then((r) => Number(r[0].id))
            .catch(() => null);
          // The login reward arrives by itself: no button to remember to press.
          const login = this.deps.config.autoLoginReward ? await this.payLoginReward(player.id) : null;
          const room = this.rooms.get(player.id);
          send({
            type: 'welcome',
            playerId: player.id,
            inGame: !!room && !room.isClosed,
            banterLevel: this.banterOf(player),
            catalog: this.catalogFor(language),
            // Re-read after paying the login reward so the summary shows it as taken.
            account: await accountSummary(this.s, (login && (await this.s.accounts.get(player.id))) || player),
          });
          if (login) send({ type: 'rewards', items: [{ kind: 'login', id: 'login', amount: login.amount }], balance: login.balance });
          if (room && !room.isClosed) room.attach(socket, this.seatIn(room, player.id));
          else await this.deliverPendingResult(player.id, send);
          const waiting = this.friends.tableOf(player.id);
          if (waiting) this.friends.broadcast(waiting);
          return;
        }
        if (!player) return fail('helloRequired', 'Send hello first');
        await this.handle(msg, player, socket, send, fail);
      } catch (error) {
        console.error('Message handling failed:', error);
        fail('badMessage', 'Server error');
      }
    });

    socket.on('close', () => {
      if (!player) return;
      this.rooms.get(player.id)?.detach(socket);
      this.sockets.get(player.id)?.delete(socket);
      const waiting = this.friends.tableOf(player.id);
      if (waiting) this.friends.broadcast(waiting);
      void sessionId?.then(async (id) => {
        if (id !== null) await this.s.db.query('UPDATE play_sessions SET ended_at = $2 WHERE id = $1', [id, this.s.now()]).catch(() => undefined);
      });
    });
  }

  private async handle(
    msg: Exclude<ClientMessage, { type: 'hello' }>,
    player: PlayerRow,
    socket: WebSocket,
    send: (m: ServerMessage) => void,
    fail: (code: ErrorCode, message: string) => void,
  ): Promise<void> {
    const room = this.rooms.get(player.id);
    switch (msg.type) {
      case 'startGame': {
        if (room && !room.gameOver && !room.isClosed) {
          room.attach(socket, this.seatIn(room, player.id)); // already playing: just resend the table
          return;
        }
        this.friends.leave(player.id);
        // Account state may have changed over HTTP since the socket connected (real-name, coins…).
        const fresh = await this.s.accounts.get(player.id);
        if (!fresh) return fail('unauthorized', 'Account no longer exists');
        Object.assign(player, fresh);
        const check = await checkStart(this.s, player, msg.options);
        if (!check.ok) return send({ type: 'startRejected', reason: check.reason, detail: check.detail });
        if (room && !room.multiplayer) room.close();
        await this.createRoom(player, check.plan, socket);
        return;
      }
      case 'createFriendRoom': {
        if (room && !room.gameOver && !room.isClosed) return send({ type: 'friendRoomRejected', reason: 'inGame' });
        const hands = Number.isInteger(msg.handsPerGame) ? Math.min(Math.max(msg.handsPerGame, 1), this.deps.config.maxHandsPerGame) : this.deps.config.defaultHandsPerGame;
        this.friends.create({ playerId: player.id, name: player.nickname, avatar: player.avatar }, hands, msg.xueliu === true);
        return;
      }
      case 'joinFriendRoom': {
        if (room && !room.gameOver && !room.isClosed) return send({ type: 'friendRoomRejected', reason: 'inGame' });
        if (typeof msg.code !== 'string') return fail('badMessage', 'Malformed room number');
        const joined = this.friends.join({ playerId: player.id, name: player.nickname, avatar: player.avatar }, msg.code);
        if (typeof joined === 'string') send({ type: 'friendRoomRejected', reason: joined });
        return;
      }
      case 'leaveFriendRoom':
        this.friends.leave(player.id);
        return;
      case 'startFriendRoom': {
        const table = this.friends.tableOf(player.id);
        if (!table) return send({ type: 'friendRoomRejected', reason: 'notFound' });
        if (table.hostId !== player.id) return send({ type: 'friendRoomRejected', reason: 'notHost' });
        if (table.members.length < 2) return send({ type: 'friendRoomRejected', reason: 'needFriend' });
        await this.startFriendGame(table, socket);
        return;
      }
      case 'action': {
        if (!room) return fail('notInGame', 'No active game');
        if (!isWellFormedAction(msg.action) || !Number.isInteger(msg.version)) return fail('badMessage', 'Malformed action');
        const seat = this.seatIn(room, player.id);
        const error = room.humanAction({ ...msg.action, seat } as Action, msg.version, seat);
        if (error) fail('illegalAction', error);
        return;
      }
      case 'setAutoPlay':
        room?.setAutoPlay(!!msg.on, this.seatIn(room, player.id));
        return;
      case 'setFastPace':
        room?.setFastPace(!!msg.on);
        return;
      case 'skipToResults':
        room?.skipToResults();
        return;
      case 'nextHand':
        room?.nextHand(this.seatIn(room, player.id));
        return;
      case 'leaveGame':
        room?.leave(this.seatIn(room, player.id));
        send({ type: 'left', reason: 'user' });
        return;
      case 'setBanter': {
        if (!BANTER_LEVELS.includes(msg.level)) return fail('badMessage', 'Unknown banter level');
        await this.s.accounts.updateProfile(player.id, { banterLevel: msg.level });
        player.banter_level = msg.level; // the room reads this object live
        send({ type: 'banter', level: msg.level });
        return;
      }
      case 'chat': {
        if (!room) return send({ type: 'chatRejected', reason: 'notInGame' });
        if (typeof msg.text !== 'string') return fail('badMessage', 'Malformed chat');
        const text = msg.text.trim();
        if (textLength(text) > this.deps.dialogue.chat.maxLength) return send({ type: 'chatRejected', reason: 'tooLong' });
        const target: Seat | 'table' = [1, 2, 3].includes(msg.target as number) ? (msg.target as Seat) : 'table';
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        // Moderate before any AI or display sees it (PRD §7.1).
        const verdict = await this.deps.moderator.check(text, 'playerChat');
        if (!verdict.allowed) {
          this.chatGuard.violation(player.id);
          await this.s.db.query("INSERT INTO moderation_events (kind, player_id, text, reason, game_id) VALUES ('blockedPlayerMessage', $1, $2, $3, $4)", [
            player.id,
            text,
            verdict.reason ?? null,
            room.id,
          ]);
          return send({ type: 'chatRejected', reason: this.chatGuard.isSuspended(player.id) ? 'suspended' : 'blocked' });
        }
        room.playerChat(text, target, this.seatIn(room, player.id));
        return;
      }
      case 'quickPhrase': {
        const phrase = this.deps.dialogue.quickPhrases.find((q) => q.id === msg.id);
        if (!room || !phrase) return;
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        room.quickPhrase((this.languageOf(player.id) === 'en' && phrase.textEn) || phrase.text, this.seatIn(room, player.id));
        return;
      }
      case 'sticker': {
        if (!room || !(msg.id in STICKERS)) return;
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        room.sticker(msg.id, this.seatIn(room, player.id));
        return;
      }
      case 'reportLine': {
        const entry = room?.chatEntry(Number(msg.entryId));
        if (!room || !entry || entry.kind !== 'ai' || !entry.text) return;
        const characterId = room.aiSeats.find((a) => a.seat === entry.seat)?.characterId ?? null;
        await this.s.db.query("INSERT INTO moderation_events (kind, player_id, character_id, text, game_id) VALUES ('reportedAiLine', $1, $2, $3, $4)", [
          player.id,
          characterId,
          entry.text,
          room.id,
        ]);
        send({ type: 'lineReported', entryId: entry.id });
        return;
      }
      default:
        fail('badMessage', 'Unknown message type');
    }
  }

  /** Takes a player out of any game and disconnects them (suspension). */
  kick(playerId: string): void {
    const room = this.rooms.get(playerId);
    // In a friend room the others play on; the kicked seat is auto-played.
    if (room?.multiplayer) room.leave(this.seatIn(room, playerId));
    else room?.close();
    this.friends.leave(playerId);
    for (const socket of this.sockets.get(playerId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'error', code: 'unauthorized', message: 'Session ended' } satisfies ServerMessage));
      socket.close();
    }
    this.sockets.delete(playerId);
  }

  private async createRoom(player: PlayerRow, plan: GamePlan, socket: WebSocket): Promise<Room> {
    // Persistent characters; skill is chosen independently per game (PRD §3.2).
    const chosen = selectCharacters(this.deps.dialogue.roster, 3, this.rng);
    const memories = await this.loadMemories(player.id, chosen.map((c) => c.character.id));
    const ai: AiSeatSpec[] = chosen.map((c) => ({
      ...c,
      skill: pickWeighted(this.deps.config.skillWeights, this.rng),
      memory: memories.get(c.character.id) ?? null,
    }));
    const room = this.buildRoom(player, plan, ai, this.languageOf(player.id));
    room.start(socket);
    return room;
  }

  /** What each character remembers about this player (PRD §8). Memory is a bonus: never block a game on it. */
  private loadMemories(playerId: string, characterIds: string[]) {
    return this.s.memory.load(playerId, characterIds).catch((error) => {
      console.error('Loading AI memory failed:', error);
      return new Map();
    });
  }

  private buildRoom(
    player: PlayerRow,
    plan: GamePlan,
    ai: AiSeatSpec[],
    language: Language,
    restore?: { checkpoint: RoomCheckpoint; coinChange: number },
    guests: { seat: Seat; player: PlayerRow; plan: GamePlan }[] = [],
  ): Room {
    const room: Room = new Room({
      gameId: restore?.checkpoint.gameId ?? `g_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      config: this.deps.config,
      ruleSet: plan.ruleSet,
      baseScore: plan.baseScore,
      seed: this.nextSeed(),
      humanSeat: restore?.checkpoint.humanSeat ?? (0 as Seat),
      restore: restore?.checkpoint,
      pacer: this.pacer,
      coinChange: restore?.coinChange,
      human: { playerId: player.id, name: player.nickname, avatar: player.avatar },
      guests: guests.map((g) => ({ seat: g.seat, playerId: g.player.id, name: g.player.nickname, avatar: g.player.avatar })),
      ai,
      store: this.deps.hands,
      rng: createRng(this.nextSeed()),
      stake: plan.stake,
      talk: {
        settings: this.deps.dialogue.settings,
        idleEveryDiscards: this.deps.dialogue.idleEveryDiscards,
        llm: this.deps.llm,
        moderator: this.deps.moderator,
        banterLevel: () => this.banterOf(player),
        language,
        onMemoryUsed: (ids) => void this.s.memory.markReferenced(ids).catch((e) => console.error('Memory update failed:', e)),
        onLine: (entry, speaker) => {
          void this.s.db
            .query('INSERT INTO chat_log (player_id, game_id, seat, kind, speaker, text, sticker) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
              // A friend's own lines are logged under their account; AI lines under the host's table.
              room.players.find((p) => p.seat === entry.seat)?.playerId ?? player.id,
              room.id,
              entry.seat,
              entry.kind,
              speaker,
              entry.text,
              entry.sticker,
            ])
            .catch((error) => console.error('Writing chat log failed:', error));
        },
        onPlayerQuote: (text, target) => {
          const characterId = target === 'table' ? null : (room.aiSeats.find((a) => a.seat === target)?.characterId ?? null);
          void this.s.memory.recordQuote(player.id, characterId, text, room.id).catch((e) => console.error('Memory update failed:', e));
        },
      },
      onHandEnd: (r, handIndex, result) => this.track(this.afterHand(player, r, plan, handIndex, result)),
      // Friend rooms are not checkpointed (MVP): a restart ends them.
      onChange: (r) => (r.multiplayer ? undefined : this.scheduleCheckpoint(player.id, r, plan, language)),
      onClosed: (r) => {
        for (const id of [player.id, ...guests.map((g) => g.player.id)]) {
          if (this.rooms.get(id) === r) this.rooms.delete(id);
          this.clearLimit(id);
        }
        if (!this.stopping && !r.multiplayer) this.dropCheckpoint(player.id, r.id);
      },
    });
    this.rooms.set(player.id, room);
    this.scheduleLimit(player.id, room, plan);
    for (const g of guests) {
      this.rooms.set(g.player.id, room);
      this.scheduleLimit(g.player.id, room, g.plan, g.seat);
    }
    return room;
  }

  // ---------------------------------------------------------------------------
  // Restart safety: in-progress games are checkpointed and restored on start.
  // ---------------------------------------------------------------------------

  private scheduleCheckpoint(playerId: string, room: Room, plan: GamePlan, language: Language): void {
    if (this.saveTimers.has(playerId)) return;
    const write = async () => {
      this.saveTimers.delete(playerId);
      if (room.isClosed && !this.stopping) return;
      // A finished game (settled within the debounce window) has nothing to resume.
      if (room.gameOver) return void (await this.s.db.query('DELETE FROM active_games WHERE player_id = $1 AND game_id = $2', [playerId, room.id]).catch(() => undefined));
      const saved: SavedGame = { room: room.checkpoint(), plan, language };
      await this.s.db
        .query(
          `INSERT INTO active_games (player_id, game_id, state, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (player_id) DO UPDATE SET game_id = $2, state = $3, updated_at = now()`,
          [playerId, room.id, JSON.stringify(saved)],
        )
        .catch((error) => console.error('Saving game checkpoint failed:', error));
    };
    const run = () => {
      const previous = this.writing.get(playerId) ?? Promise.resolve();
      const next = previous.then(write);
      this.writing.set(playerId, next);
      void next.finally(() => {
        if (this.writing.get(playerId) === next) this.writing.delete(playerId);
      });
      return next;
    };
    this.saveTimers.set(playerId, { timer: setTimeout(() => void run(), CHECKPOINT_DEBOUNCE_MS), write: run });
  }

  private dropCheckpoint(playerId: string, gameId: string): void {
    const pending = this.saveTimers.get(playerId);
    if (pending) clearTimeout(pending.timer);
    this.saveTimers.delete(playerId);
    void this.s.db.query('DELETE FROM active_games WHERE player_id = $1 AND game_id = $2', [playerId, gameId]).catch(() => undefined);
  }

  /** Rebuilds the games that were in progress when the server stopped. Returns how many were restored. */
  async restoreGames(): Promise<number> {
    const rows = await this.s.db.query<{ player_id: string; game_id: string; state: SavedGame }>('SELECT player_id, game_id, state FROM active_games');
    let restored = 0;
    for (const row of rows) {
      try {
        if (await this.restoreGame(row.player_id, row.state)) restored++;
        else this.dropCheckpoint(row.player_id, row.game_id);
      } catch (error) {
        console.error(`Restoring game ${row.game_id} failed:`, error);
        this.dropCheckpoint(row.player_id, row.game_id);
      }
    }
    return restored;
  }

  private async restoreGame(playerId: string, saved: SavedGame): Promise<boolean> {
    const player = await this.s.accounts.get(playerId);
    if (!player) return false;
    const { roster } = this.deps.dialogue;
    const ai: AiSeatSpec[] = [];
    for (const a of saved.room.ai) {
      const character = roster.characters.find((c) => c.id === a.characterId);
      const personality = character && roster.personalities.find((p) => p.id === character.personalityId);
      if (!character || !personality) return false; // deleted by an admin since
      ai.push({ character, personality, skill: a.skill });
    }
    const memories = await this.loadMemories(playerId, ai.map((a) => a.character.id));
    for (const a of ai) a.memory = memories.get(a.character.id) ?? null;
    const [{ total }] = await this.s.db.query<{ total: string }>(
      "SELECT COALESCE(sum(amount), 0) AS total FROM ledger WHERE player_id = $1 AND type = 'handSettlement' AND ref LIKE $2",
      [playerId, `${saved.room.gameId}:%`],
    );
    const room = this.buildRoom(player, saved.plan, ai, saved.language ?? 'zh', { checkpoint: saved.room, coinChange: Number(total) });
    // The server may have stopped before the last hand was settled; settlement is idempotent.
    if (room.handEnded) {
      const settled = this.settle(playerId, room, saved.plan, room.currentHandIndex, room.lastResult!);
      this.track(settled);
      if (room.gameOver) {
        await settled;
        room.close();
        return false;
      }
    }
    room.resume(this.deps.config.restoreGraceMs);
    return true;
  }

  /** Coins first (what the player sees), then memory (best effort). */
  /** Pays today's login reward if it is still due; null otherwise (already paid, or a concurrent connection paid it). */
  private async payLoginReward(playerId: string): Promise<{ amount: number; balance: number } | null> {
    try {
      const claim = await this.s.rewards.claim(playerId, this.s.now());
      return { amount: claim.amount, balance: claim.balance };
    } catch (error) {
      if (!(error instanceof AlreadyClaimedError)) console.error('Login reward failed:', error);
      return null;
    }
  }

  /** The character roster (live: admins can edit it). */
  get characters(): DialogueConfig['roster']['characters'] {
    return this.deps.dialogue.roster.characters;
  }

  private async afterHand(player: PlayerRow, room: Room, plan: GamePlan, handIndex: number, result: HandResult): Promise<void> {
    if (room.multiplayer) return this.afterFriendHand(room, result);
    await this.settle(player.id, room, plan, handIndex, result);
    await this.remember(player, room, plan, result).catch((error) => console.error('Recording AI memory failed:', error));
    // After the memory write, so lifetime counts in the profile include this hand.
    const rewards = await this.s.achievements.recordHand(player.id, room.humanSeat, result).catch((error) => {
      console.error('Recording achievements failed:', error);
      return [];
    });
    if (rewards.length) room.human.send({ type: 'rewards', items: rewards, balance: await this.s.wallet.balance(player.id) });
    if (room.gameOver) {
      const rank = await this.s.ranks.recordGame(player.id, room.id, plan.stake, room.totals, room.humanSeat).catch((error) => {
        console.error('Recording rank failed:', error);
        return null;
      });
      if (rank) room.human.send({ type: 'rank', result: rank });
    }
  }

  /** Friend rooms: points only (no coins, unranked, no AI memory); each player gets their achievements and result. */
  private async afterFriendHand(room: Room, result: HandResult): Promise<void> {
    for (const p of room.players) {
      const rewards = await this.s.achievements.recordHand(p.playerId, p.seat, result).catch((error) => {
        console.error('Recording achievements failed:', error);
        return [];
      });
      if (rewards.length) room.sendTo(p.seat, { type: 'rewards', items: rewards, balance: await this.s.wallet.balance(p.playerId) });
      if (room.gameOver) await this.finishGame(p.playerId, room.summary(p.seat), room, p.seat);
    }
  }

  /** Starts a friend room: members take seats in join order, AI fill the rest. */
  private async startFriendGame(table: FriendTable, hostSocket: WebSocket): Promise<void> {
    const players: { player: PlayerRow; plan: GamePlan }[] = [];
    for (const m of table.members) {
      const p = await this.s.accounts.get(m.playerId);
      if (!p) continue;
      // Play limits (minors, guest trial, real name) apply to every member, not just the host.
      const check = await checkStart(this.s, p, { private: { baseScore: 0, handsPerGame: table.handsPerGame, rules: { xueliu: table.xueliu } } });
      if (!check.ok) {
        this.sendToPlayer(table.hostId, { type: 'friendRoomRejected', reason: 'blocked', detail: p.nickname });
        this.sendToPlayer(p.id, { type: 'startRejected', reason: check.reason, detail: check.detail });
        return;
      }
      players.push({ player: p, plan: { ...check.plan, stake: { kind: 'friend', name: '好友房', baseScore: 0, multiplier: 0, inviteCode: table.code } } });
    }
    if (players.length < 2) return void this.sendToPlayer(table.hostId, { type: 'friendRoomRejected', reason: 'needFriend' });
    for (const { player } of players) {
      const old = this.rooms.get(player.id);
      if (old && !old.multiplayer) old.close();
    }
    const [host, ...rest] = players;
    const guests = rest.map((g, i) => ({ seat: (i + 1) as Seat, player: g.player, plan: g.plan }));
    const chosen = selectCharacters(this.deps.dialogue.roster, 4 - players.length, this.rng);
    const ai: AiSeatSpec[] = chosen.map((c) => ({ ...c, skill: pickWeighted(this.deps.config.skillWeights, this.rng), memory: null }));
    this.friends.close(table);
    const room = this.buildRoom(host.player, host.plan, ai, this.languageOf(host.player.id), undefined, guests);
    const openSocket = (id: string) => [...(this.sockets.get(id) ?? [])].find((s) => s.readyState === s.OPEN);
    room.start(hostSocket, new Map(guests.flatMap((g) => (openSocket(g.player.id) ? [[g.seat, openSocket(g.player.id)!] as const] : []))));
  }

  /** Long-term memory write path (PRD Appendix B.2). */
  private async remember(player: PlayerRow, room: Room, plan: GamePlan, result: HandResult): Promise<void> {
    const memory = extractHandMemory({ humanSeat: room.humanSeat, characters: room.aiSeats, result, playerName: player.nickname });
    await this.s.memory.recordHand(player.id, room.id, memory.relationships, memory.events, memory.stats);
    if (!room.gameOver) return;
    const totals = room.totals;
    await this.s.memory.finishGame(
      player.id,
      room.aiSeats.map((a) => ({ characterId: a.characterId, delta: gameEndRivalry(totals[room.humanSeat], totals[a.seat], plan.baseScore) })),
    );
    // One LLM call per game polishes the summaries; templates are kept if it fails.
    await summarizeGame(this.s.memory, this.deps.llm, this.deps.moderator, {
      playerId: player.id,
      gameId: room.id,
      playerName: player.nickname,
      characterNames: new Map(room.aiSeats.map((a) => [a.characterId, a.name])),
    });
  }

  /**
   * Coin settlement after each hand (PRD §21): points × multiplier, a loss
   * capped at the player's balance, idempotent per (game, hand). AI seats
   * are backed by the house, so only the human's wallet changes.
   */
  private async settle(playerId: string, room: Room, plan: GamePlan, handIndex: number, result: HandResult): Promise<void> {
    const points = result.deltas[room.humanSeat];
    if (plan.multiplier > 0 && points !== 0) {
      const change = await this.s.wallet.apply(playerId, points * plan.multiplier, 'handSettlement', `${room.id}:${handIndex}`, {
        gameId: room.id,
        handIndex,
        points,
        stake: plan.stake,
      });
      const gameTotal = change.duplicate ? room.coinTotal : room.addCoinChange(change.applied);
      room.human.send({ type: 'wallet', balance: change.balance, change: { amount: change.applied, requested: change.requested, handIndex, gameTotal } });
    }
    if (room.gameOver) await this.finishGame(playerId, room.summary(), room);
  }

  /** Shows the result now, or stores it for the next login if the player is away (PRD §14.1). */
  private async finishGame(playerId: string, summary: GameSummary, room: Room, seat: Seat = room.humanSeat): Promise<void> {
    if (room.players.find((p) => p.seat === seat)?.connected) {
      room.sendTo(seat, { type: 'gameSummary', summary });
      return;
    }
    await this.s.db.query(
      'INSERT INTO pending_results (player_id, payload) VALUES ($1, $2) ON CONFLICT (player_id) DO UPDATE SET payload = $2, created_at = now()',
      [playerId, JSON.stringify(summary)],
    );
  }

  private async deliverPendingResult(playerId: string, send: (m: ServerMessage) => void): Promise<void> {
    const rows = await this.s.db.query<{ payload: GameSummary }>('DELETE FROM pending_results WHERE player_id = $1 RETURNING payload', [playerId]);
    if (rows.length) send({ type: 'pendingResult', summary: rows[0].payload });
  }

  /** Minor play windows and the guest trial end games on time (Appendix D.2–D.3). */
  private scheduleLimit(playerId: string, room: Room, plan: GamePlan, seat: Seat = room.humanSeat): void {
    this.clearLimit(playerId);
    const endsAt = plan.limitEndsAt;
    if (endsAt === null) return;
    const now = this.s.now().getTime();
    const kind = plan.limitKind === 'guestTrial' ? 'guestTrialOver' : 'minorTimeLimit';
    const timers: NodeJS.Timeout[] = [];
    const warnAt = endsAt - LIMIT_WARNING_MS;
    if (warnAt > now) {
      timers.push(setTimeout(() => room.sendTo(seat, { type: 'notice', kind, endsAt }), warnAt - now));
    }
    timers.push(
      setTimeout(() => {
        if (room.isClosed || room.gameOver) return;
        room.sendTo(seat, { type: 'notice', kind, endsAt });
        room.sendTo(seat, { type: 'left', reason: kind });
        // Leaving never voids settlement: auto-play finishes the game (PRD §14.1).
        room.leave(seat);
      }, Math.max(0, endsAt - now)),
    );
    this.limitTimers.set(playerId, timers);
  }

  private clearLimit(playerId: string): void {
    for (const t of this.limitTimers.get(playerId) ?? []) clearTimeout(t);
    this.limitTimers.delete(playerId);
  }

  /** Ends the player's game, e.g. when the account is deleted. */
  closePlayer(playerId: string): void {
    this.rooms.get(playerId)?.close();
  }

  private track(work: Promise<void>): void {
    const p = work.catch((error) => console.error('Settlement failed:', error)).finally(() => this.settling.delete(p));
    this.settling.add(p);
  }

  private nextSeed(): number {
    return this.deps.seed ? this.deps.seed() : randomInt(0, 2 ** 32 - 1);
  }

  /** Stops every room; their latest state is checkpointed so the next start can resume them. */
  async closeAll(): Promise<void> {
    this.stopping = true;
    const writes = [...this.saveTimers.values()].map(({ timer, write }) => {
      clearTimeout(timer);
      return write();
    });
    for (const room of this.rooms.values()) room.close();
    for (const id of [...this.limitTimers.keys()]) this.clearLimit(id);
    this.pacer.dispose();
    await Promise.all([...writes, ...this.writing.values()]);
  }
}

/** Normalizes arbitrary non-negative weights into a random pick (PRD §4.2, §37). */
export function pickWeighted<K extends string>(weights: Record<K, number>, rng: Rng): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) throw new Error('All weights are zero');
  let r = rng() * total;
  for (const [k, w] of entries) {
    if ((r -= w) < 0) return k;
  }
  return entries[entries.length - 1][0];
}

const ACTION_TYPES = new Set(['swap', 'dingque', 'discard', 'selfKong', 'zimo', 'hu', 'pong', 'kong', 'pass']);

function isWellFormedAction(a: unknown): a is Omit<Action, 'seat'> {
  if (!a || typeof a !== 'object') return false;
  const action = a as Record<string, unknown>;
  if (!ACTION_TYPES.has(action.type as string)) return false;
  if (action.type === 'swap') return Array.isArray(action.tiles) && action.tiles.every(isValidTile);
  if (action.type === 'discard' || action.type === 'selfKong') return isValidTile(action.tile);
  if (action.type === 'dingque') return [0, 1, 2].includes(action.suit as number);
  return true;
}

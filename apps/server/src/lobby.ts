/** Authenticated connections, game start checks, coin settlement and room lifecycle. */
import type { Rng } from '@mahjong/ai-play';
import { BANTER_LEVELS, extractHandMemory, gameEndRivalry, selectCharacters, STICKERS, type Moderator, type StickerId } from '@mahjong/dialogue';
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
import { Room, type AiSeatSpec } from './room';
import { accountSummary, checkStart, type GamePlan, type Services } from './services';
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

export class Lobby {
  /** Active room per player. */
  private rooms = new Map<string, Room>();
  /** Play-time limit timers per player (China minors / guest trial). */
  private limitTimers = new Map<string, NodeJS.Timeout[]>();
  /** Settlement work in flight (tests can await it). */
  readonly settling = new Set<Promise<void>>();
  private rng: Rng;
  private chatGuard: ChatGuard;
  private readonly catalog: ChatCatalog;

  constructor(private readonly deps: LobbyDeps) {
    this.rng = createRng(this.nextSeed());
    this.chatGuard = new ChatGuard(deps.dialogue.chat);
    this.catalog = {
      quickPhrases: deps.dialogue.quickPhrases,
      stickers: (Object.keys(STICKERS) as StickerId[]).map((id) => ({ id, ...STICKERS[id] })),
    };
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
          const room = this.rooms.get(player.id);
          send({
            type: 'welcome',
            playerId: player.id,
            inGame: !!room && !room.isClosed,
            banterLevel: this.banterOf(player),
            catalog: this.catalog,
            account: await accountSummary(this.s, player),
          });
          if (room && !room.isClosed) room.attach(socket);
          else await this.deliverPendingResult(player.id, send);
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
      if (player) this.rooms.get(player.id)?.detach(socket);
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
          room.attach(socket); // already playing: just resend the table
          return;
        }
        // Account state may have changed over HTTP since the socket connected (real-name, coins…).
        const fresh = await this.s.accounts.get(player.id);
        if (!fresh) return fail('unauthorized', 'Account no longer exists');
        Object.assign(player, fresh);
        const check = await checkStart(this.s, player, msg.options);
        if (!check.ok) return send({ type: 'startRejected', reason: check.reason, detail: check.detail });
        room?.close();
        await this.createRoom(player, check.plan, socket);
        return;
      }
      case 'action': {
        if (!room) return fail('notInGame', 'No active game');
        if (!isWellFormedAction(msg.action) || !Number.isInteger(msg.version)) return fail('badMessage', 'Malformed action');
        const error = room.humanAction({ ...msg.action, seat: room.humanSeat } as Action, msg.version);
        if (error) fail('illegalAction', error);
        return;
      }
      case 'setAutoPlay':
        room?.setAutoPlay(!!msg.on);
        return;
      case 'skipToResults':
        room?.skipToResults();
        return;
      case 'nextHand':
        room?.nextHand();
        return;
      case 'leaveGame':
        room?.leave();
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
        if ([...text].length > this.deps.dialogue.chat.maxLength) return send({ type: 'chatRejected', reason: 'tooLong' });
        const target: Seat | 'table' = [1, 2, 3].includes(msg.target as number) ? (msg.target as Seat) : 'table';
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        // Moderate before any AI or display sees it (PRD §7.1).
        const verdict = await this.deps.moderator.check(text, 'playerChat');
        if (!verdict.allowed) {
          this.chatGuard.violation(player.id);
          return send({ type: 'chatRejected', reason: this.chatGuard.isSuspended(player.id) ? 'suspended' : 'blocked' });
        }
        room.playerChat(text, target);
        return;
      }
      case 'quickPhrase': {
        const phrase = this.deps.dialogue.quickPhrases.find((q) => q.id === msg.id);
        if (!room || !phrase) return;
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        room.quickPhrase(phrase.text);
        return;
      }
      case 'sticker': {
        if (!room || !(msg.id in STICKERS)) return;
        const admitted = this.chatGuard.admit(player.id);
        if (admitted) return send({ type: 'chatRejected', reason: admitted });
        room.sticker(msg.id);
        return;
      }
      default:
        fail('badMessage', 'Unknown message type');
    }
  }

  private async createRoom(player: PlayerRow, plan: GamePlan, socket: WebSocket): Promise<Room> {
    const humanSeat = 0 as Seat;
    // Persistent characters; skill is chosen independently per game (PRD §3.2).
    const chosen = selectCharacters(this.deps.dialogue.roster, 3, this.rng);
    // What each character remembers about this player (PRD §8). Memory is a bonus: never block a game on it.
    const memories = await this.s.memory.load(player.id, chosen.map((c) => c.character.id)).catch((error) => {
      console.error('Loading AI memory failed:', error);
      return new Map();
    });
    const ai: AiSeatSpec[] = chosen.map((c) => ({
      ...c,
      skill: pickWeighted(this.deps.config.skillWeights, this.rng),
      memory: memories.get(c.character.id) ?? null,
    }));
    const room = new Room({
      gameId: `g_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      config: this.deps.config,
      ruleSet: plan.ruleSet,
      baseScore: plan.baseScore,
      seed: this.nextSeed(),
      humanSeat,
      human: { playerId: player.id, name: player.nickname, avatar: player.avatar },
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
        onMemoryUsed: (ids) => void this.s.memory.markReferenced(ids).catch((e) => console.error('Memory update failed:', e)),
        onPlayerQuote: (text, target) => {
          const characterId = target === 'table' ? null : (room.aiSeats.find((a) => a.seat === target)?.characterId ?? null);
          void this.s.memory.recordQuote(player.id, characterId, text, room.id).catch((e) => console.error('Memory update failed:', e));
        },
      },
      onHandEnd: (r, handIndex, result) => this.track(this.afterHand(player, r, plan, handIndex, result)),
      onClosed: (r) => {
        if (this.rooms.get(player.id) === r) this.rooms.delete(player.id);
        this.clearLimit(player.id);
      },
    });
    this.rooms.set(player.id, room);
    this.scheduleLimit(player.id, room, plan);
    room.start(socket);
    return room;
  }

  /** Coins first (what the player sees), then memory (best effort). */
  private async afterHand(player: PlayerRow, room: Room, plan: GamePlan, handIndex: number, result: HandResult): Promise<void> {
    await this.settle(player.id, room, plan, handIndex, result);
    await this.remember(player, room, plan, result).catch((error) => console.error('Recording AI memory failed:', error));
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
  private async finishGame(playerId: string, summary: GameSummary, room: Room): Promise<void> {
    if (room.human.connected) {
      room.human.send({ type: 'gameSummary', summary });
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
  private scheduleLimit(playerId: string, room: Room, plan: GamePlan): void {
    this.clearLimit(playerId);
    const endsAt = plan.limitEndsAt;
    if (endsAt === null) return;
    const now = this.s.now().getTime();
    const kind = plan.limitKind === 'guestTrial' ? 'guestTrialOver' : 'minorTimeLimit';
    const timers: NodeJS.Timeout[] = [];
    const warnAt = endsAt - LIMIT_WARNING_MS;
    if (warnAt > now) {
      timers.push(setTimeout(() => room.human.send({ type: 'notice', kind, endsAt }), warnAt - now));
    }
    timers.push(
      setTimeout(() => {
        if (room.isClosed || room.gameOver) return;
        room.human.send({ type: 'notice', kind, endsAt });
        room.human.send({ type: 'left', reason: kind });
        // Leaving never voids settlement: auto-play finishes the game (PRD §14.1).
        room.leave();
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

  closeAll(): void {
    for (const room of this.rooms.values()) room.close();
    for (const id of [...this.limitTimers.keys()]) this.clearLimit(id);
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

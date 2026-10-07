/** Connections, identity and room lifecycle for single-player tables. */
import type { Rng } from '@mahjong/ai-play';
import { createRng, DEFAULT_RULESET, isValidTile, type Action, type Seat } from '@mahjong/engine';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type GameOptions,
  type ServerMessage,
} from '@mahjong/protocol';
import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PLACEHOLDER_AI_NAMES, PLACEHOLDER_AVATARS, type ServerConfig } from './config';
import { Room, type AiSeatSpec } from './room';
import type { HandLogStore, Player, PlayerStore } from './store';

export interface LobbyDeps {
  config: ServerConfig;
  hands: HandLogStore;
  players: PlayerStore;
  /** Seed source; injectable for deterministic tests. */
  seed?: () => number;
}

export class Lobby {
  /** Active room per player. */
  private rooms = new Map<string, Room>();
  private rng: Rng;

  constructor(private readonly deps: LobbyDeps) {
    this.rng = createRng(this.nextSeed());
  }

  roomOf(playerId: string): Room | undefined {
    return this.rooms.get(playerId);
  }

  handleConnection(socket: WebSocket): void {
    let player: Player | null = null;
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

      if (msg.type === 'hello') {
        if (msg.protocol !== PROTOCOL_VERSION) return fail('protocolMismatch', `Server speaks protocol ${PROTOCOL_VERSION}`);
        if (typeof msg.deviceId !== 'string' || msg.deviceId.length < 8 || msg.deviceId.length > 128) {
          return fail('badMessage', 'Invalid deviceId');
        }
        player = await this.deps.players.getOrCreate(msg.deviceId);
        const room = this.rooms.get(player.playerId);
        send({ type: 'welcome', playerId: player.playerId, inGame: !!room });
        room?.attach(socket);
        return;
      }
      if (!player) return fail('helloRequired', 'Send hello first');

      const room = this.rooms.get(player.playerId);
      switch (msg.type) {
        case 'startGame': {
          if (room && !room.gameOver) {
            room.attach(socket); // already playing: just resend the table
            return;
          }
          room?.close();
          this.createRoom(player, sanitizeOptions(msg.options, this.deps.config), socket);
          return;
        }
        case 'action': {
          if (!room) return fail('notInGame', 'No active game');
          if (!isWellFormedAction(msg.action) || !Number.isInteger(msg.version)) {
            return fail('badMessage', 'Malformed action');
          }
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
          send({ type: 'left' });
          return;
        default:
          fail('badMessage', 'Unknown message type');
      }
    });

    socket.on('close', () => {
      if (player) this.rooms.get(player.playerId)?.detach(socket);
    });
  }

  private createRoom(player: Player, options: Required<GameOptions>, socket: WebSocket): Room {
    const humanSeat = 0 as Seat;
    const names = shuffled(PLACEHOLDER_AI_NAMES, this.rng);
    const avatars = shuffled(PLACEHOLDER_AVATARS, this.rng);
    const ai: AiSeatSpec[] = [0, 1, 2].map((i) => ({
      name: names[i],
      avatar: avatars[i],
      skill: pickWeighted(this.deps.config.skillWeights, this.rng),
    }));
    const room = new Room({
      gameId: `g_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      config: this.deps.config,
      ruleSet: { ...DEFAULT_RULESET, handsPerGame: options.handsPerGame },
      baseScore: options.baseScore,
      seed: this.nextSeed(),
      humanSeat,
      human: { playerId: player.playerId, name: player.name, avatar: '🙂' },
      ai,
      store: this.deps.hands,
      rng: createRng(this.nextSeed()),
      onClosed: (r) => {
        if (this.rooms.get(player.playerId) === r) this.rooms.delete(player.playerId);
      },
    });
    this.rooms.set(player.playerId, room);
    room.start(socket);
    return room;
  }

  private nextSeed(): number {
    return this.deps.seed ? this.deps.seed() : randomInt(0, 2 ** 32 - 1);
  }

  closeAll(): void {
    for (const room of this.rooms.values()) room.close();
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

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizeOptions(options: GameOptions | undefined, config: ServerConfig): Required<GameOptions> {
  const hands = Math.trunc(Number(options?.handsPerGame ?? config.defaultHandsPerGame));
  const base = Math.trunc(Number(options?.baseScore ?? config.defaultBaseScore));
  return {
    handsPerGame: Number.isFinite(hands) ? Math.min(Math.max(hands, 1), config.maxHandsPerGame) : config.defaultHandsPerGame,
    // Phase 1 has no coins; Phase 3 adds the balance-based private-room caps (PRD §13).
    baseScore: Number.isFinite(base) ? Math.min(Math.max(base, 0), 1_000_000) : config.defaultBaseScore,
  };
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

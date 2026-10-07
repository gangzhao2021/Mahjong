/**
 * Persistence for Phase 1: JSON files on disk behind small interfaces.
 * Phase 3 swaps these for PostgreSQL without touching the room logic.
 */
import type { Action, HandResult, RuleSet, Seat } from '@mahjong/engine';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Everything needed to replay a hand exactly (PRD §40 event-sourced action log). */
export interface HandLog {
  gameId: string;
  handIndex: number;
  playerId: string;
  seed: number;
  dealer: Seat;
  baseScore: number;
  ruleSet: RuleSet;
  seats: { seat: Seat; name: string; isHuman: boolean; skill?: string }[];
  actions: Action[];
  /** How each action was produced, for analysing timeouts and auto-play. */
  sources: ('human' | 'ai' | 'timeout' | 'autoPlay')[];
  result: HandResult | null;
  startedAt: string;
  endedAt: string | null;
}

export interface HandLogStore {
  save(log: HandLog): Promise<void>;
}

export class FileHandLogStore implements HandLogStore {
  constructor(private readonly dir: string) {}

  async save(log: HandLog): Promise<void> {
    const dir = path.join(this.dir, 'hands');
    await mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, `${log.gameId}-${log.handIndex}.json`), JSON.stringify(log, null, 1));
  }
}

export class MemoryHandLogStore implements HandLogStore {
  readonly logs: HandLog[] = [];
  async save(log: HandLog): Promise<void> {
    this.logs.push(structuredClone(log));
  }
}

export interface Player {
  playerId: string;
  name: string;
  createdAt: string;
  /** Player's banter setting (PRD §7); null = regional default. */
  banterLevel?: 'mild' | 'spicy' | 'quiet' | null;
}

/** Anonymous device-ID identity; becomes the guest account in Phase 3. */
export interface PlayerStore {
  getOrCreate(deviceId: string): Promise<Player>;
  update(playerId: string, patch: Partial<Omit<Player, 'playerId'>>): Promise<Player | null>;
}

export class FilePlayerStore implements PlayerStore {
  private cache: Record<string, Player> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, 'players.json');
  }

  async getOrCreate(deviceId: string): Promise<Player> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await readFile(this.file, 'utf8'));
      } catch {
        this.cache = {};
      }
    }
    const existing = this.cache![deviceId];
    if (existing) return existing;
    const player = newPlayer();
    this.cache![deviceId] = player;
    await this.flush();
    return player;
  }

  async update(playerId: string, patch: Partial<Omit<Player, 'playerId'>>): Promise<Player | null> {
    const entry = Object.values(this.cache ?? {}).find((p) => p.playerId === playerId);
    if (!entry) return null;
    Object.assign(entry, patch);
    await this.flush();
    return entry;
  }

  private async flush(): Promise<void> {
    const snapshot = JSON.stringify(this.cache, null, 1);
    this.writing = this.writing.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await writeAtomic(this.file, snapshot);
    });
    await this.writing;
  }
}

export class MemoryPlayerStore implements PlayerStore {
  private players = new Map<string, Player>();
  async getOrCreate(deviceId: string): Promise<Player> {
    let p = this.players.get(deviceId);
    if (!p) this.players.set(deviceId, (p = newPlayer()));
    return p;
  }

  async update(playerId: string, patch: Partial<Omit<Player, 'playerId'>>): Promise<Player | null> {
    const p = [...this.players.values()].find((x) => x.playerId === playerId);
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
}

function newPlayer(): Player {
  const playerId = `p_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  return { playerId, name: `玩家${playerId.slice(-4)}`, createdAt: new Date().toISOString() };
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

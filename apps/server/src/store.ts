/**
 * Persistence for Phase 1: JSON files on disk behind small interfaces.
 * Phase 3 swaps these for PostgreSQL without touching the room logic.
 */
import type { Action, HandResult, RuleSet, Seat } from '@mahjong/engine';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

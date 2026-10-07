/** Economy settings (PRD §11, §13, §22–§24, §34). Admin-editable in Phase 5. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TableConfig {
  id: string;
  name: string;
  baseScore: number;
  /** Minimum balance to start a game here. */
  minCoins: number;
  /** Coins per point of score; 0 = no coin settlement (practice table). */
  multiplier: number;
}

export interface EconomyConfig {
  startingCoins: number;
  /** Login reward cycle; length 1 = flat daily reward (PRD §23). */
  loginRewards: number[];
  rewardResetHour: number;
  rewardUtcOffsetHours: number;
  tables: TableConfig[];
  privateRoom: { maxBaseRatio: number; maxBase: number; maxHands: number };
}

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config');

export function loadEconomyConfig(): EconomyConfig {
  const config = JSON.parse(readFileSync(path.join(CONFIG_DIR, 'economy.json'), 'utf8')) as EconomyConfig;
  const problems: string[] = [];
  if (!config.loginRewards.length) problems.push('loginRewards must not be empty');
  if (!config.tables.some((t) => t.baseScore === 0 && t.minCoins === 0)) problems.push('a practice table (base 0, min 0) is required (PRD §11)');
  if (new Set(config.tables.map((t) => t.id)).size !== config.tables.length) problems.push('duplicate table ids');
  if (problems.length) throw new Error(`Invalid economy config: ${problems.join('; ')}`);
  return config;
}

/**
 * The "game day" used for daily rewards: the calendar date in the configured
 * time zone, rolling over at `rewardResetHour` (default 04:00 UTC+8).
 */
export function gameDay(now: Date, config: Pick<EconomyConfig, 'rewardResetHour' | 'rewardUtcOffsetHours'>): string {
  const shifted = new Date(now.getTime() + (config.rewardUtcOffsetHours - config.rewardResetHour) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Largest base score a player may set for a private room (PRD §13). */
export function privateRoomMaxBase(balance: number, config: EconomyConfig): number {
  return Math.max(0, Math.min(Math.floor(balance * config.privateRoom.maxBaseRatio), config.privateRoom.maxBase));
}

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
  const problems = validateEconomy(config);
  if (problems.length) throw new Error(`Invalid economy config: ${problems.join('; ')}`);
  return config;
}

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/** Problems with an economy config (empty = valid). Used for the file and for admin edits. */
export function validateEconomy(c: EconomyConfig): string[] {
  const problems: string[] = [];
  if (!isCount(c.startingCoins)) problems.push('startingCoins must be a non-negative integer');
  if (!Array.isArray(c.loginRewards) || !c.loginRewards.length || !c.loginRewards.every(isCount)) {
    problems.push('loginRewards must be a non-empty list of non-negative integers');
  }
  if (!Number.isInteger(c.rewardResetHour) || c.rewardResetHour < 0 || c.rewardResetHour > 23) problems.push('rewardResetHour must be 0–23');
  if (!Number.isInteger(c.rewardUtcOffsetHours) || Math.abs(c.rewardUtcOffsetHours) > 14) problems.push('rewardUtcOffsetHours must be -14–14');
  if (!Array.isArray(c.tables) || !c.tables.length) problems.push('at least one table is required');
  else {
    for (const t of c.tables) {
      if (typeof t.id !== 'string' || !/^[a-z0-9_-]{1,20}$/.test(t.id)) problems.push(`table id "${t.id}" must be 1–20 lowercase letters, digits, - or _`);
      if (typeof t.name !== 'string' || !t.name.trim()) problems.push(`table ${t.id}: name is required`);
      if (!isCount(t.baseScore) || !isCount(t.minCoins)) problems.push(`table ${t.id}: baseScore and minCoins must be non-negative integers`);
      if (!(typeof t.multiplier === 'number' && t.multiplier >= 0 && t.multiplier <= 100)) problems.push(`table ${t.id}: multiplier must be 0–100`);
    }
    if (!c.tables.some((t) => t.baseScore === 0 && t.minCoins === 0)) problems.push('a practice table (base 0, min 0) is required (PRD §11)');
    if (new Set(c.tables.map((t) => t.id)).size !== c.tables.length) problems.push('duplicate table ids');
  }
  const p = c.privateRoom;
  if (!p || !(p.maxBaseRatio >= 0 && p.maxBaseRatio <= 1) || !isCount(p.maxBase) || !Number.isInteger(p.maxHands) || p.maxHands < 1 || p.maxHands > 16) {
    problems.push('privateRoom: maxBaseRatio 0–1, maxBase ≥ 0, maxHands 1–16');
  }
  return problems;
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

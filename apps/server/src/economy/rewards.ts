/**
 * Login reward cycle (PRD §23–§24): one claim per game day; missing a day
 * keeps progress; after the last day the cycle restarts. No reminders.
 */
import type { Db } from '../db/db';
import { gameDay, type EconomyConfig } from './config';
import type { Wallet } from './wallet';

export interface RewardStatus {
  cycle: number[];
  /** 0-based day of the cycle the next claim pays. */
  dayIndex: number;
  claimable: boolean;
  nextAmount: number;
}

export class AlreadyClaimedError extends Error {
  constructor() {
    super('Reward already claimed today');
  }
}

export class Rewards {
  constructor(
    private readonly db: Db,
    private readonly wallet: Wallet,
    private readonly config: EconomyConfig,
  ) {}

  status(row: { reward_day: number; last_reward_date: string | Date | null }, now = new Date()): RewardStatus {
    const cycle = this.config.loginRewards;
    const dayIndex = row.reward_day % cycle.length;
    const last = row.last_reward_date ? toDate(row.last_reward_date) : null;
    return { cycle, dayIndex, claimable: last !== gameDay(now, this.config), nextAmount: cycle[dayIndex] };
  }

  async claim(playerId: string, now = new Date()): Promise<{ amount: number; balance: number; status: RewardStatus }> {
    const day = gameDay(now, this.config);
    return this.db.tx(async (q) => {
      const rows = await q.query<{ reward_day: number; last_reward_date: string | Date | null }>(
        'SELECT reward_day, last_reward_date FROM players WHERE id = $1 FOR UPDATE',
        [playerId],
      );
      if (!rows.length) throw new Error('Unknown player');
      const status = this.status(rows[0], now);
      if (!status.claimable) throw new AlreadyClaimedError();
      const change = await this.wallet.apply(playerId, status.nextAmount, 'loginReward', day, { cycleDay: status.dayIndex + 1 }, q);
      const nextDay = (status.dayIndex + 1) % this.config.loginRewards.length;
      await q.query('UPDATE players SET reward_day = $2, last_reward_date = $3 WHERE id = $1', [playerId, nextDay, day]);
      return {
        amount: change.applied,
        balance: change.balance,
        status: this.status({ reward_day: nextDay, last_reward_date: day }, now),
      };
    });
  }
}

function toDate(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

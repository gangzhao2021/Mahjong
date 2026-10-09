/**
 * Daily tasks and one-time achievements. Progress is recorded after every
 * finished hand and rewards are paid right away (no claim chores); each is
 * paid once per task per game day (and once per achievement), guarded by the
 * ledger's unique ref. `claim` remains for anything earned but not yet paid.
 */
import type { HandResult, Pattern, Seat } from '@mahjong/engine';
import type { AchievementId, AchievementStatus, DailyTaskId, DailyTaskStatus, EarnedReward, TasksStatus } from '@mahjong/protocol';
import type { Db } from '../db/db';
import { gameDay, type EconomyConfig } from './config';
import type { Wallet } from './wallet';

export const DAILY_TASKS: { id: DailyTaskId; target: number; reward: number }[] = [
  { id: 'playHands', target: 4, reward: 200 },
  { id: 'win', target: 2, reward: 300 },
  { id: 'selfDraw', target: 1, reward: 300 },
];

export const ACHIEVEMENTS: { id: AchievementId; reward: number }[] = [
  { id: 'firstWin', reward: 300 },
  { id: 'firstSelfDraw', reward: 300 },
  { id: 'firstKong', reward: 300 },
  { id: 'duiDuiHu', reward: 500 },
  { id: 'qiDui', reward: 800 },
  { id: 'qingYiSe', reward: 1000 },
  { id: 'gangShangHua', reward: 1000 },
  { id: 'bigWin', reward: 1500 },
  { id: 'wins10', reward: 1000 },
  { id: 'wins50', reward: 3000 },
  { id: 'games10', reward: 1000 },
];

/** A win of at least this many fan earns "bigWin". */
const BIG_WIN_FAN = 3;

/** Patterns that count for each pattern achievement (the stronger forms include the weaker). */
const PATTERN_ACHIEVEMENTS: [AchievementId, Pattern[]][] = [
  ['duiDuiHu', ['duiDuiHu', 'qingDui', 'jiangDui', 'jinGouDiao']],
  ['qiDui', ['qiDui', 'longQiDui', 'qingQiDui', 'qingLongQiDui']],
  ['qingYiSe', ['qingYiSe', 'qingDui', 'qingQiDui', 'qingLongQiDui']],
  ['gangShangHua', ['gangShangHua']],
];

export class NothingToClaimError extends Error {
  constructor() {
    super('Nothing to claim');
  }
}

export class Tasks {
  constructor(
    private readonly db: Db,
    private readonly wallet: Wallet,
    private readonly config: EconomyConfig,
    private readonly now: () => Date,
  ) {}

  /** Counts a finished hand towards today's tasks, unlocks achievements, and pays whatever it completed. */
  async recordHand(playerId: string, seat: Seat, result: HandResult): Promise<EarnedReward[]> {
    const day = gameDay(this.now(), this.config);
    const win = result.wins.find((w) => w.seat === seat);
    const add: Record<DailyTaskId, number> = { playHands: 1, win: win ? 1 : 0, selfDraw: win?.selfDraw ? 1 : 0 };
    for (const task of DAILY_TASKS) {
      if (!add[task.id]) continue;
      await this.db.query(
        `INSERT INTO player_tasks (player_id, day, task_id, progress) VALUES ($1, $2, $3, LEAST($4::int, $5::int))
         ON CONFLICT (player_id, day, task_id) DO UPDATE SET progress = LEAST(player_tasks.progress + $4::int, $5::int)`,
        [playerId, day, task.id, add[task.id], task.target],
      );
    }

    const earned = new Set<AchievementId>();
    if (win) {
      earned.add('firstWin');
      if (win.selfDraw) earned.add('firstSelfDraw');
      for (const [id, patterns] of PATTERN_ACHIEVEMENTS) if (win.patterns.some((p) => patterns.includes(p))) earned.add(id);
      if (win.fan >= BIG_WIN_FAN) earned.add('bigWin');
    }
    const kongPaid = result.payments.some((p) => p.to === seat && (p.reason === 'directKong' || p.reason === 'addedKong' || p.reason === 'concealedKong'));
    if (kongPaid) earned.add('firstKong');
    // Lifetime counts come from the profile the memory layer keeps up to date (written before this runs).
    const profile = (await this.db.query<{ wins: number; games_played: number }>('SELECT wins, games_played FROM player_profiles WHERE player_id = $1', [playerId]))[0];
    if (profile) {
      if (profile.wins >= 10) earned.add('wins10');
      if (profile.wins >= 50) earned.add('wins50');
      if (profile.games_played >= 10) earned.add('games10');
    }
    for (const id of earned) {
      await this.db.query('INSERT INTO player_achievements (player_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [playerId, id]);
    }
    return this.payDue(playerId);
  }

  /** Pays every finished task and earned achievement not yet paid. */
  private async payDue(playerId: string): Promise<EarnedReward[]> {
    const status = await this.status(playerId);
    const due = [
      ...status.daily.filter((d) => !d.claimed && d.progress >= d.target).map((d) => ({ kind: 'daily' as const, id: d.id })),
      ...status.achievements.filter((a) => a.unlockedAt !== null && !a.claimed).map((a) => ({ kind: 'achievement' as const, id: a.id })),
    ];
    const paid: EarnedReward[] = [];
    for (const item of due) {
      try {
        paid.push({ ...item, amount: await this.claim(playerId, item.kind, item.id) });
      } catch (error) {
        if (!(error instanceof NothingToClaimError)) throw error;
      }
    }
    return paid;
  }

  async status(playerId: string): Promise<TasksStatus> {
    const day = gameDay(this.now(), this.config);
    const tasks = await this.db.query<{ task_id: string; progress: number; claimed: boolean }>(
      'SELECT task_id, progress, claimed FROM player_tasks WHERE player_id = $1 AND day = $2',
      [playerId, day],
    );
    const unlocked = await this.db.query<{ achievement_id: string; unlocked_at: Date | string; claimed: boolean }>(
      'SELECT achievement_id, unlocked_at, claimed FROM player_achievements WHERE player_id = $1',
      [playerId],
    );
    const daily = DAILY_TASKS.map((t): DailyTaskStatus => {
      const row = tasks.find((r) => r.task_id === t.id);
      return { id: t.id, progress: row?.progress ?? 0, target: t.target, reward: t.reward, claimed: row?.claimed ?? false };
    });
    const achievements = ACHIEVEMENTS.map((a): AchievementStatus => {
      const row = unlocked.find((r) => r.achievement_id === a.id);
      return { id: a.id, reward: a.reward, unlockedAt: row ? new Date(row.unlocked_at).getTime() : null, claimed: row?.claimed ?? false };
    });
    return { daily, achievements };
  }

  /** Pays out a finished daily task or an earned achievement; throws NothingToClaimError otherwise. */
  async claim(playerId: string, kind: 'daily' | 'achievement', id: string): Promise<number> {
    const day = gameDay(this.now(), this.config);
    return this.db.tx(async (q) => {
      if (kind === 'daily') {
        const task = DAILY_TASKS.find((t) => t.id === id);
        if (!task) throw new NothingToClaimError();
        const rows = await q.query<{ progress: number; claimed: boolean }>(
          'SELECT progress, claimed FROM player_tasks WHERE player_id = $1 AND day = $2 AND task_id = $3 FOR UPDATE',
          [playerId, day, id],
        );
        if (!rows.length || rows[0].claimed || rows[0].progress < task.target) throw new NothingToClaimError();
        const change = await this.wallet.apply(playerId, task.reward, 'taskReward', `${day}:${id}`, { task: id }, q);
        await q.query('UPDATE player_tasks SET claimed = true WHERE player_id = $1 AND day = $2 AND task_id = $3', [playerId, day, id]);
        return change.applied;
      }
      const achievement = ACHIEVEMENTS.find((a) => a.id === id);
      if (!achievement) throw new NothingToClaimError();
      const rows = await q.query<{ claimed: boolean }>('SELECT claimed FROM player_achievements WHERE player_id = $1 AND achievement_id = $2 FOR UPDATE', [
        playerId,
        id,
      ]);
      if (!rows.length || rows[0].claimed) throw new NothingToClaimError();
      const change = await this.wallet.apply(playerId, achievement.reward, 'achievementReward', id, { achievement: id }, q);
      await q.query('UPDATE player_achievements SET claimed = true WHERE player_id = $1 AND achievement_id = $2', [playerId, id]);
      return change.applied;
    });
  }
}

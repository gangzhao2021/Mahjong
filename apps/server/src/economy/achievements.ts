/**
 * Achievements: milestones that unlock by playing (no chores, no daily
 * quotas) and pay their coins automatically, once each — guarded by the
 * ledger's unique ref. `claim` remains for anything earned but not yet paid.
 */
import type { HandResult, Pattern, Seat } from '@mahjong/engine';
import type { AchievementId, AchievementStatus, AchievementsStatus, EarnedReward } from '@mahjong/protocol';
import type { Db } from '../db/db';
import type { Wallet } from './wallet';

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

export class Achievements {
  constructor(
    private readonly db: Db,
    private readonly wallet: Wallet,
  ) {}

  /** Unlocks whatever a finished hand earned and pays it straight away. */
  async recordHand(playerId: string, seat: Seat, result: HandResult): Promise<EarnedReward[]> {
    const earned = new Set<AchievementId>();
    const win = result.wins.find((w) => w.seat === seat);
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

  /** Pays every earned achievement not yet paid. */
  async payDue(playerId: string): Promise<EarnedReward[]> {
    const { achievements } = await this.status(playerId);
    const paid: EarnedReward[] = [];
    for (const a of achievements.filter((x) => x.unlockedAt !== null && !x.claimed)) {
      try {
        paid.push({ kind: 'achievement', id: a.id, amount: await this.claim(playerId, a.id) });
      } catch (error) {
        if (!(error instanceof NothingToClaimError)) throw error;
      }
    }
    return paid;
  }

  async status(playerId: string): Promise<AchievementsStatus> {
    const unlocked = await this.db.query<{ achievement_id: string; unlocked_at: Date | string; claimed: boolean }>(
      'SELECT achievement_id, unlocked_at, claimed FROM player_achievements WHERE player_id = $1',
      [playerId],
    );
    const achievements = ACHIEVEMENTS.map((a): AchievementStatus => {
      const row = unlocked.find((r) => r.achievement_id === a.id);
      return { id: a.id, reward: a.reward, unlockedAt: row ? new Date(row.unlocked_at).getTime() : null, claimed: row?.claimed ?? false };
    });
    return { achievements };
  }

  /** Pays an earned achievement; throws NothingToClaimError if it isn't earned or was already paid. */
  async claim(playerId: string, id: string): Promise<number> {
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (!achievement) throw new NothingToClaimError();
    return this.db.tx(async (q) => {
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

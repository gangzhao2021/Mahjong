/**
 * Ranks (段位): finished games at public coin tables move the player's rank
 * points by placement, scaled by the stakes. Each game counts once, and a
 * player never drops below the floor of the tier they have reached.
 */
import type { Seat } from '@mahjong/engine';
import type { RankInfo, RankResult, RankTierId, StakeInfo } from '@mahjong/protocol';
import type { Db } from '../db/db';

export const RANK_TIERS: { id: RankTierId; min: number }[] = [
  { id: 'novice', min: 0 },
  { id: 'adept', min: 300 },
  { id: 'expert', min: 800 },
  { id: 'master', min: 1600 },
  { id: 'saint', min: 3000 },
];

/** Points for finishing 1st to 4th. */
const PLACE_POINTS = [40, 15, -10, -25];
/** Higher stakes move the rank faster. */
const TABLE_SCALE: Record<string, number> = { low: 1, mid: 1.5, high: 2 };

export function rankInfo(points: number): RankInfo {
  let i = 0;
  while (i + 1 < RANK_TIERS.length && points >= RANK_TIERS[i + 1].min) i++;
  return { tier: RANK_TIERS[i].id, points, tierMin: RANK_TIERS[i].min, nextAt: RANK_TIERS[i + 1]?.min ?? null };
}

/** 1-based placement by final totals; ties share the better place. */
export function placement(totals: readonly number[], seat: Seat): number {
  return 1 + totals.filter((t) => t > totals[seat]).length;
}

export function rankAfter(points: number, place: number, tableId: string | undefined): number {
  const change = Math.round(PLACE_POINTS[place - 1] * (TABLE_SCALE[tableId ?? ''] ?? 1));
  return Math.max(rankInfo(points).tierMin, points + change);
}

/** Whether a game at this stake counts towards rank: public tables that settle coins. */
export function isRanked(stake: StakeInfo): boolean {
  return stake.kind === 'public' && stake.multiplier > 0;
}

export class Ranks {
  constructor(private readonly db: Db) {}

  /** Applies a finished game once; null when it doesn't count or was already applied. */
  async recordGame(playerId: string, gameId: string, stake: StakeInfo, totals: readonly number[], seat: Seat): Promise<RankResult | null> {
    if (!isRanked(stake)) return null;
    const place = placement(totals, seat);
    return this.db.tx(async (q) => {
      const fresh = await q.query('INSERT INTO rank_games (player_id, game_id, place) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [playerId, gameId, place]);
      if (!fresh.length) return null;
      const rows = await q.query<{ rank_points: number }>('SELECT rank_points FROM players WHERE id = $1 FOR UPDATE', [playerId]);
      if (!rows.length) return null;
      const before = rows[0].rank_points;
      const after = rankAfter(before, place, stake.tableId);
      await q.query('UPDATE players SET rank_points = $2 WHERE id = $1', [playerId, after]);
      return { gameId, place, change: after - before, before: rankInfo(before), after: rankInfo(after) };
    });
  }
}

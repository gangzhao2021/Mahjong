/**
 * Each player's finished hands, kept for the in-app history list and replay,
 * plus the lifetime numbers on the stats page. Rows go with the account
 * (ON DELETE CASCADE) and are purged with the other hand logs.
 */
import type { Seat } from '@mahjong/engine';
import type { HandHistoryEntry, HandReplay, PlayerStats } from '@mahjong/protocol';
import type { Queryable } from './db/db';
import type { HandLog, HandLogStore } from './store';

const LIST_LIMIT = 30;

export class HandHistory implements HandLogStore {
  constructor(private readonly db: Queryable) {}

  async save(log: HandLog): Promise<void> {
    if (!log.result) return;
    await this.db.query(
      `INSERT INTO hand_history (player_id, game_id, hand_index, log, ended_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_id, game_id, hand_index) DO NOTHING`,
      [log.playerId, log.gameId, log.handIndex, JSON.stringify(log), log.endedAt ?? new Date().toISOString()],
    );
  }

  async list(playerId: string, limit = LIST_LIMIT): Promise<HandHistoryEntry[]> {
    const rows = await this.db.query<{ log: HandLog | string }>('SELECT log FROM hand_history WHERE player_id = $1 ORDER BY ended_at DESC LIMIT $2', [
      playerId,
      limit,
    ]);
    return rows.map((r) => summarize(parse(r.log)));
  }

  async replay(playerId: string, gameId: string, handIndex: number): Promise<HandReplay | null> {
    const rows = await this.db.query<{ log: HandLog | string }>('SELECT log FROM hand_history WHERE player_id = $1 AND game_id = $2 AND hand_index = $3', [
      playerId,
      gameId,
      handIndex,
    ]);
    if (!rows.length) return null;
    const log = parse(rows[0].log);
    return {
      gameId: log.gameId,
      handIndex: log.handIndex,
      mySeat: humanSeat(log),
      seats: log.seats.map(({ seat, name, isHuman }) => ({ seat, name, isHuman })),
      seed: log.seed,
      dealer: log.dealer,
      baseScore: log.baseScore,
      ruleSet: log.ruleSet,
      actions: log.actions,
    };
  }

  async stats(playerId: string): Promise<PlayerStats> {
    const profile = (
      await this.db.query<{ games_played: number; hands_played: number; wins: number; self_draws: number; deal_ins: number; big_wins: number; hua_zhu: number }>(
        'SELECT games_played, hands_played, wins, self_draws, deal_ins, big_wins, hua_zhu FROM player_profiles WHERE player_id = $1',
        [playerId],
      )
    )[0];
    const best = (
      await this.db.query<{ best: number | null }>(
        `SELECT max((w->>'fan')::int) AS best
         FROM hand_history, jsonb_array_elements(log->'result'->'wins') AS w
         WHERE player_id = $1 AND (w->>'seat')::int = (
           SELECT (s->>'seat')::int FROM jsonb_array_elements(log->'seats') AS s WHERE (s->>'isHuman')::boolean LIMIT 1
         )`,
        [playerId],
      )
    )[0]?.best;
    return {
      gamesPlayed: profile?.games_played ?? 0,
      handsPlayed: profile?.hands_played ?? 0,
      wins: profile?.wins ?? 0,
      selfDraws: profile?.self_draws ?? 0,
      dealIns: profile?.deal_ins ?? 0,
      bigWins: profile?.big_wins ?? 0,
      huaZhu: profile?.hua_zhu ?? 0,
      bestFan: best ?? null,
    };
  }
}

/** Saves each hand to every store (files for analysis, the database for players). */
export class TeeHandLogStore implements HandLogStore {
  constructor(private readonly stores: HandLogStore[]) {}
  async save(log: HandLog): Promise<void> {
    await Promise.all(this.stores.map((s) => s.save(log)));
  }
}

function parse(log: HandLog | string): HandLog {
  return typeof log === 'string' ? (JSON.parse(log) as HandLog) : log;
}

function humanSeat(log: HandLog): Seat {
  return log.seats.find((s) => s.isHuman)?.seat ?? 0;
}

function summarize(log: HandLog): HandHistoryEntry {
  const mySeat = humanSeat(log);
  const result = log.result!;
  const win = result.wins.find((w) => w.seat === mySeat);
  return {
    gameId: log.gameId,
    handIndex: log.handIndex,
    endedAt: Date.parse(log.endedAt ?? log.startedAt),
    mySeat,
    seats: log.seats.map(({ seat, name, isHuman }) => ({ seat, name, isHuman })),
    deltas: result.deltas,
    reason: result.reason,
    myWin: win ? { fan: win.fan, selfDraw: win.selfDraw } : null,
  };
}

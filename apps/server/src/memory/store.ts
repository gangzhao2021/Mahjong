/**
 * Long-term AI memory storage (PRD §8, §45, §47, Appendix B). Structured
 * rows, not chat logs: relationship counters per (character, player), a
 * capped set of memorable events, and a shared player profile.
 */
import {
  fade,
  GRUDGE_HALF_LIFE_DAYS,
  profileFromStats,
  recallScore,
  retentionScore,
  RIVALRY_HALF_LIFE_DAYS,
  type CharacterMemory,
  type MemoryCandidate,
  type MemoryKind,
  type PlayerHandStats,
  type PlayerStats,
  type RelationshipDelta,
} from '@mahjong/dialogue';
import type { Db, Queryable } from '../db/db';

/** Events kept per (character, player) — shared events form their own bucket (Appendix B.2). */
export const MAX_EVENTS_PER_PAIR = 50;
const MAX_QUOTES_PER_PLAYER = 10;
/** Memories recalled into one conversation: a couple of the character's own plus one shared. */
const RECALL_OWN = 2;
const RECALL_SHARED = 1;

interface RelationshipRow {
  character_id: string;
  games_together: number;
  hands_together: number;
  character_wins: number;
  player_wins: number;
  dealt_in_by_player: number;
  dealt_in_to_player: number;
  points_net: string;
  rivalry: number;
  grudge_reason: string | null;
  grudge_strength: number;
  grudge_at: Date | string | null;
  last_seen_at: Date | string | null;
}

interface EventRow {
  id: string;
  character_id: string | null;
  kind: MemoryKind;
  summary: string;
  importance: number;
  game_id: string | null;
  created_at: Date | string;
  reference_count: number;
}

interface ProfileRow {
  hands_played: number;
  games_played: number;
  deal_ins: number;
  wins: number;
  self_draws: number;
  big_wins: number;
  hua_zhu: number;
  chat_messages: number;
  play_style: string | null;
  habits: string[] | null;
}

const toDate = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface MemoryEventView {
  id: number;
  characterId: string | null;
  kind: MemoryKind;
  summary: string;
  importance: number;
  createdAt: string;
  referenceCount: number;
}

export class MemoryStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Write path, per hand (Appendix B.2): counters deterministically, candidate events, player stats. */
  async recordHand(playerId: string, gameId: string, deltas: RelationshipDelta[], events: MemoryCandidate[], stats: PlayerHandStats): Promise<void> {
    const now = this.now();
    await this.db.tx(async (q) => {
      for (const d of deltas) await this.applyDelta(q, playerId, d, now);
      for (const e of events) {
        await q.query('INSERT INTO memory_events (character_id, player_id, kind, summary, importance, game_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          e.characterId,
          playerId,
          e.kind,
          e.summary,
          e.importance,
          gameId,
          now,
        ]);
      }
      await q.query(
        `INSERT INTO player_profiles (player_id, hands_played, deal_ins, wins, self_draws, big_wins, hua_zhu, updated_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (player_id) DO UPDATE SET
           hands_played = player_profiles.hands_played + 1,
           deal_ins = player_profiles.deal_ins + $2,
           wins = player_profiles.wins + $3,
           self_draws = player_profiles.self_draws + $4,
           big_wins = player_profiles.big_wins + $5,
           hua_zhu = player_profiles.hua_zhu + $6,
           updated_at = $7`,
        [playerId, stats.dealIns, stats.wins, stats.selfDraws, stats.bigWins, stats.huaZhu, now],
      );
    });
  }

  private async applyDelta(q: Queryable, playerId: string, d: RelationshipDelta, now: Date): Promise<void> {
    const rows = await q.query<RelationshipRow>('SELECT * FROM relationships WHERE character_id = $1 AND player_id = $2 FOR UPDATE', [d.characterId, playerId]);
    const r = rows[0];
    const rivalry = clamp((r ? fade(r.rivalry, toDate(r.last_seen_at), now, RIVALRY_HALF_LIFE_DAYS) : 0) + d.rivalryDelta, -1, 1);
    const oldGrudge = r ? fade(r.grudge_strength, toDate(r.grudge_at), now, GRUDGE_HALF_LIFE_DAYS) : 0;
    const grudge = d.grudge && d.grudge.strength >= oldGrudge ? d.grudge : null;
    await q.query(
      `INSERT INTO relationships (character_id, player_id, hands_together, character_wins, player_wins, dealt_in_by_player, dealt_in_to_player,
                                  points_net, rivalry, grudge_reason, grudge_strength, grudge_at, last_seen_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (character_id, player_id) DO UPDATE SET
         hands_together = relationships.hands_together + 1,
         character_wins = relationships.character_wins + $3,
         player_wins = relationships.player_wins + $4,
         dealt_in_by_player = relationships.dealt_in_by_player + $5,
         dealt_in_to_player = relationships.dealt_in_to_player + $6,
         points_net = relationships.points_net + $7,
         rivalry = $8,
         grudge_reason = COALESCE($9, relationships.grudge_reason),
         grudge_strength = CASE WHEN $9::text IS NULL THEN relationships.grudge_strength ELSE $10 END,
         grudge_at = CASE WHEN $9::text IS NULL THEN relationships.grudge_at ELSE $11 END,
         last_seen_at = $12`,
      [
        d.characterId,
        playerId,
        d.characterWins,
        d.playerWins,
        d.dealtInByPlayer,
        d.dealtInToPlayer,
        d.pointsNet,
        rivalry,
        grudge?.reason ?? null,
        grudge?.strength ?? 0,
        grudge ? now : null,
        now,
      ],
    );
  }

  /** A moderated player chat line worth remembering ("notable quote"). */
  async recordQuote(playerId: string, characterId: string | null, text: string, gameId: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('INSERT INTO memory_events (character_id, player_id, kind, summary, importance, game_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        characterId,
        playerId,
        'notable_quote',
        `他说过：「${text}」`,
        0.35,
        gameId,
        this.now(),
      ]);
      await q.query(
        `INSERT INTO player_profiles (player_id, chat_messages) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET chat_messages = player_profiles.chat_messages + 1`,
        [playerId],
      );
    });
  }

  /** Game end: counts the game for each character and nudges rivalry by the final standings. */
  async finishGame(playerId: string, rivalry: { characterId: string; delta: number }[]): Promise<void> {
    const now = this.now();
    await this.db.tx(async (q) => {
      for (const r of rivalry) {
        await q.query(
          `INSERT INTO relationships (character_id, player_id, games_together, rivalry, last_seen_at) VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (character_id, player_id) DO UPDATE SET
             games_together = relationships.games_together + 1,
             rivalry = LEAST(1, relationships.rivalry + $3),
             last_seen_at = $4`,
          [r.characterId, playerId, r.delta, now],
        );
      }
      await q.query(
        `INSERT INTO player_profiles (player_id, games_played) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET games_played = player_profiles.games_played + 1`,
        [playerId],
      );
    });
    await this.prune(playerId);
  }

  /** Read path (Appendix B.3): what each character remembers about the player, faded to now. */
  async load(playerId: string, characterIds: string[]): Promise<Map<string, CharacterMemory>> {
    const now = this.now();
    const rels = await this.db.query<RelationshipRow>('SELECT * FROM relationships WHERE player_id = $1 AND character_id = ANY($2)', [playerId, characterIds]);
    const events = await this.db.query<EventRow>(
      'SELECT * FROM memory_events WHERE player_id = $1 AND (character_id IS NULL OR character_id = ANY($2))',
      [playerId, characterIds],
    );
    const profile = await this.profile(playerId);
    const ranked = events
      .map((e) => ({ e, score: recallScore({ importance: e.importance, createdAt: new Date(e.created_at), referenceCount: e.reference_count }, now) }))
      .sort((a, b) => b.score - a.score);
    const shared = ranked.filter((x) => x.e.character_id === null).slice(0, RECALL_SHARED);

    const result = new Map<string, CharacterMemory>();
    for (const id of characterIds) {
      const r = rels.find((x) => x.character_id === id);
      const own = ranked.filter((x) => x.e.character_id === id).slice(0, RECALL_OWN);
      const lastSeen = r ? toDate(r.last_seen_at) : null;
      const grudgeStrength = r ? fade(r.grudge_strength, toDate(r.grudge_at), now, GRUDGE_HALF_LIFE_DAYS) : 0;
      result.set(id, {
        characterId: id,
        gamesTogether: r?.games_together ?? 0,
        characterWins: r?.character_wins ?? 0,
        playerWins: r?.player_wins ?? 0,
        dealtInByPlayer: r?.dealt_in_by_player ?? 0,
        dealtInToPlayer: r?.dealt_in_to_player ?? 0,
        rivalry: r ? fade(r.rivalry, lastSeen, now, RIVALRY_HALF_LIFE_DAYS) : 0,
        grudge: r?.grudge_reason && grudgeStrength >= 0.1 ? { reason: r.grudge_reason, strength: grudgeStrength } : null,
        daysSinceLastSeen: lastSeen ? (now.getTime() - lastSeen.getTime()) / 86_400_000 : null,
        // Strangers get no shared gossip either: there is no history to refer to.
        events: (r ? [...own, ...shared] : []).map(({ e }) => ({ id: Number(e.id), kind: e.kind, summary: e.summary })),
        profile: r ? profile : null,
      });
    }
    return result;
  }

  async profile(playerId: string): Promise<{ playStyle: string; habits: string[] } | null> {
    const rows = await this.db.query<ProfileRow>('SELECT * FROM player_profiles WHERE player_id = $1', [playerId]);
    const p = rows[0];
    if (!p) return null;
    if (p.play_style) return { playStyle: p.play_style, habits: p.habits ?? [] };
    return profileFromStats(statsOf(p));
  }

  async stats(playerId: string): Promise<PlayerStats | null> {
    const rows = await this.db.query<ProfileRow>('SELECT * FROM player_profiles WHERE player_id = $1', [playerId]);
    return rows[0] ? statsOf(rows[0]) : null;
  }

  /** Memories that made it into a conversation are less likely to be repeated soon. */
  async markReferenced(eventIds: number[]): Promise<void> {
    if (!eventIds.length) return;
    await this.db.query('UPDATE memory_events SET reference_count = reference_count + 1, last_referenced_at = $2 WHERE id = ANY($1)', [eventIds, this.now()]);
  }

  async gameEvents(playerId: string, gameId: string): Promise<MemoryEventView[]> {
    const rows = await this.db.query<EventRow>('SELECT * FROM memory_events WHERE player_id = $1 AND game_id = $2 ORDER BY importance DESC, id', [playerId, gameId]);
    return rows.map(toView);
  }

  async updateSummaries(playerId: string, updates: { id: number; summary: string }[]): Promise<void> {
    for (const u of updates) {
      await this.db.query('UPDATE memory_events SET summary = $3 WHERE id = $1 AND player_id = $2', [u.id, playerId, u.summary]);
    }
  }

  async updateProfileText(playerId: string, profile: { playStyle: string; habits: string[] }): Promise<void> {
    await this.db.query('UPDATE player_profiles SET play_style = $2, habits = $3, updated_at = $4 WHERE player_id = $1', [
      playerId,
      profile.playStyle,
      JSON.stringify(profile.habits),
      this.now(),
    ]);
  }

  /** Keeps the most valuable events per (character, player) and a few quotes (Appendix B.2). */
  async prune(playerId: string): Promise<void> {
    const now = this.now();
    const rows = await this.db.query<EventRow>('SELECT * FROM memory_events WHERE player_id = $1', [playerId]);
    const doomed: number[] = [];
    const buckets = new Map<string, EventRow[]>();
    for (const r of rows) {
      const key = r.character_id ?? '*';
      buckets.set(key, [...(buckets.get(key) ?? []), r]);
    }
    const byValue = (a: EventRow, b: EventRow) =>
      retentionScore({ importance: b.importance, createdAt: new Date(b.created_at) }, now) -
      retentionScore({ importance: a.importance, createdAt: new Date(a.created_at) }, now);
    for (const list of buckets.values()) {
      list.sort(byValue);
      doomed.push(...list.slice(MAX_EVENTS_PER_PAIR).map((r) => Number(r.id)));
    }
    const quotes = rows.filter((r) => r.kind === 'notable_quote').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    doomed.push(...quotes.slice(MAX_QUOTES_PER_PLAYER).map((r) => Number(r.id)));
    if (doomed.length) await this.db.query('DELETE FROM memory_events WHERE id = ANY($1)', [[...new Set(doomed)]]);
  }

  // -------------------------------------------------------------------------
  // Privacy controls (PRD §47) — admin API in Phase 5, player UI later.
  // -------------------------------------------------------------------------

  async view(playerId: string): Promise<{ relationships: Record<string, unknown>[]; events: MemoryEventView[]; profile: unknown }> {
    const relationships = await this.db.query('SELECT * FROM relationships WHERE player_id = $1 ORDER BY character_id', [playerId]);
    const events = (await this.db.query<EventRow>('SELECT * FROM memory_events WHERE player_id = $1 ORDER BY id', [playerId])).map(toView);
    const profile = (await this.db.query('SELECT * FROM player_profiles WHERE player_id = $1', [playerId]))[0] ?? null;
    return { relationships, events, profile };
  }

  async resetPlayer(playerId: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM relationships WHERE player_id = $1', [playerId]);
      await q.query('DELETE FROM memory_events WHERE player_id = $1', [playerId]);
      await q.query('DELETE FROM player_profiles WHERE player_id = $1', [playerId]);
    });
  }

  async resetPair(characterId: string, playerId: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM relationships WHERE character_id = $1 AND player_id = $2', [characterId, playerId]);
      await q.query('DELETE FROM memory_events WHERE character_id = $1 AND player_id = $2', [characterId, playerId]);
    });
  }

  /** Deleting a character deletes everything it remembers (Appendix B.4). */
  async deleteCharacter(characterId: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM relationships WHERE character_id = $1', [characterId]);
      await q.query('DELETE FROM memory_events WHERE character_id = $1', [characterId]);
    });
  }
}

function statsOf(p: ProfileRow): PlayerStats {
  return {
    handsPlayed: p.hands_played,
    gamesPlayed: p.games_played,
    dealIns: p.deal_ins,
    wins: p.wins,
    selfDraws: p.self_draws,
    bigWins: p.big_wins,
    huaZhu: p.hua_zhu,
    chatMessages: p.chat_messages,
  };
}

function toView(e: EventRow): MemoryEventView {
  return {
    id: Number(e.id),
    characterId: e.character_id,
    kind: e.kind,
    summary: e.summary,
    importance: e.importance,
    createdAt: new Date(e.created_at).toISOString(),
    referenceCount: e.reference_count,
  };
}

/**
 * Client crash reports (PRD §50 Phase 6). Clients post uncaught errors here;
 * they are grouped by fingerprint for the admin dashboard. Reports never
 * carry personal data beyond the player id, and are size- and rate-limited.
 */
import { createHash } from 'node:crypto';
import type { Db } from './db/db';

export interface ClientErrorReport {
  message: string;
  stack?: string;
  platform?: string;
  appVersion?: string;
  context?: Record<string, unknown>;
}

const MAX_PER_MINUTE = 20;

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/** Same error, same place → same group: first line of the message plus the top stack frame. */
export function fingerprint(message: string, stack?: string): string {
  const frame = (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || l.includes('@'));
  const normalized = `${message.split('\n')[0]}|${(frame ?? '').replace(/:\d+:\d+/g, '').replace(/\?[^)\s]*/g, '')}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class CrashReports {
  private recent = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns false when the report was dropped (invalid or rate-limited). */
  async record(ip: string, playerId: string | null, body: unknown): Promise<boolean> {
    const b = (body ?? {}) as Record<string, unknown>;
    const message = clip(b.message, 500);
    if (!message) return false;
    const now = this.now();
    const times = (this.recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= MAX_PER_MINUTE) return false;
    times.push(now);
    this.recent.set(ip, times);

    const stack = clip(b.stack, 4000);
    const context = b.context && typeof b.context === 'object' ? JSON.stringify(b.context).slice(0, 2000) : null;
    await this.db.query(
      'INSERT INTO client_errors (fingerprint, message, stack, platform, app_version, player_id, context) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [fingerprint(message, stack), message, stack ?? null, clip(b.platform, 20) ?? null, clip(b.appVersion, 40) ?? null, playerId, context],
    );
    return true;
  }

  /** Crash groups for the admin dashboard, most recent first. */
  async groups(days = 7) {
    const since = new Date(this.now() - days * 86_400_000);
    const rows = await this.db.query<{ fingerprint: string; message: string; count: string; players: string; last_seen: Date | string; platforms: string[]; versions: string[]; stack: string | null }>(
      `SELECT fingerprint, max(message) AS message, count(*) AS count, count(DISTINCT player_id) AS players, max(created_at) AS last_seen,
              array_agg(DISTINCT platform) AS platforms, array_agg(DISTINCT app_version) AS versions,
              (array_agg(stack ORDER BY created_at DESC))[1] AS stack
       FROM client_errors WHERE created_at >= $1 GROUP BY fingerprint ORDER BY max(created_at) DESC LIMIT 100`,
      [since],
    );
    return rows.map((r) => ({
      fingerprint: r.fingerprint,
      message: r.message,
      count: Number(r.count),
      players: Number(r.players),
      lastSeen: new Date(r.last_seen).toISOString(),
      platforms: (r.platforms ?? []).filter(Boolean),
      versions: (r.versions ?? []).filter(Boolean),
      stack: r.stack,
    }));
  }
}

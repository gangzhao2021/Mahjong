/**
 * Log retention (PRD Appendix D.6, Appendix C): login and chat logs are
 * kept for a minimum period (≥ 6 months in the China build, by law) and
 * then purged, together with other data that has a natural expiry.
 * The job runs at start-up and then periodically.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db/db';
import type { Region } from './dialogueConfig';

export interface RetentionPolicy {
  /** Player chat, quick phrases, stickers and AI lines (chat_log), plus moderated messages. */
  chatLogDays: number;
  loginLogDays: number;
  clientErrorDays: number;
  /** Replayable hand logs on disk. */
  handLogDays: number;
}

/** China's network security rules require at least 6 months for login and chat logs. */
export const CHINA_MIN_LOG_DAYS = 180;

export function retentionPolicy(region: Region, env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const days = (name: string, fallback: number, min = 1) => {
    const n = Number(env[name]);
    return Math.max(min, Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback);
  };
  const china = region === 'china';
  const logMin = china ? CHINA_MIN_LOG_DAYS : 1;
  return {
    chatLogDays: days('RETENTION_CHAT_DAYS', china ? CHINA_MIN_LOG_DAYS : 90, logMin),
    loginLogDays: days('RETENTION_LOGIN_DAYS', china ? CHINA_MIN_LOG_DAYS : 90, logMin),
    clientErrorDays: days('RETENTION_CRASH_DAYS', 90),
    handLogDays: days('RETENTION_HAND_LOG_DAYS', 180),
  };
}

const DAY = 86_400_000;

export class RetentionJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    readonly policy: RetentionPolicy,
    /** Directory holding hand log files (`hands/`), or null when hand logs are not on disk. */
    private readonly dataDir: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Deletes everything past its retention period; returns how many rows / files went per kind. */
  async runOnce(): Promise<Record<string, number>> {
    const now = this.now().getTime();
    const before = (days: number) => new Date(now - days * DAY);
    const del = async (sql: string, params: unknown[] = []) => (await this.db.query<{ n: string }>(`WITH d AS (${sql} RETURNING 1) SELECT count(*) AS n FROM d`, params))[0].n;
    const counts: Record<string, number> = {
      chatLog: Number(await del('DELETE FROM chat_log WHERE created_at < $1', [before(this.policy.chatLogDays)])),
      // Handled moderation items carry player text, so they follow the chat log; open ones wait for an admin.
      moderation: Number(await del("DELETE FROM moderation_events WHERE status <> 'open' AND created_at < $1", [before(this.policy.chatLogDays)])),
      loginLog: Number(await del('DELETE FROM login_events WHERE created_at < $1', [before(this.policy.loginLogDays)])),
      clientErrors: Number(await del('DELETE FROM client_errors WHERE created_at < $1', [before(this.policy.clientErrorDays)])),
      smsCodes: Number(await del('DELETE FROM sms_codes WHERE expires_at < $1', [new Date(now)])),
      adminSessions: Number(await del('DELETE FROM admin_sessions WHERE last_seen_at < $1', [before(2)])),
      // A checkpoint nobody resumed within a week is an abandoned game.
      staleGames: Number(await del('DELETE FROM active_games WHERE updated_at < $1', [before(7)])),
      handLogs: await this.purgeHandLogs(now - this.policy.handLogDays * DAY),
      handHistory: Number(await del('DELETE FROM hand_history WHERE ended_at < $1', [before(this.policy.handLogDays)])),
    };
    return counts;
  }

  private async purgeHandLogs(cutoff: number): Promise<number> {
    if (!this.dataDir) return 0;
    const dir = path.join(this.dataDir, 'hands');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return 0; // no hand logs yet
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      try {
        if ((await stat(file)).mtimeMs < cutoff) {
          await unlink(file);
          removed++;
        }
      } catch {
        // Already gone or unreadable: try again next run.
      }
    }
    return removed;
  }

  /** Runs now and then every `intervalMs` (default 6 hours); failures are logged and retried next time. */
  start(intervalMs = 6 * 3_600_000): void {
    const run = () =>
      void this.runOnce()
        .then((counts) => {
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          if (total) console.log('Retention purge:', counts);
        })
        .catch((error) => console.error('Retention purge failed:', error));
    run();
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

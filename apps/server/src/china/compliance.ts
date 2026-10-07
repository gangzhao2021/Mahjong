/**
 * Mainland China requirements (PRD Appendix D.2–D.3): real-name
 * verification, minor play-time windows, and the restricted guest trial.
 * Not legal advice — window rules and holidays live in config/china.json.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/db';

export interface ChinaConfig {
  utcOffsetHours: number;
  /** Weekly windows; days use 0 = Sunday … 6 = Saturday. */
  minorWindows: { days: number[]; start: string; end: string }[];
  holidayWindow: { start: string; end: string };
  /** Statutory holidays, YYYY-MM-DD in local time. */
  holidays: string[];
  guestTrialMinutes: number;
  guestTrialPeriodDays: number;
}

export function loadChinaConfig(): ChinaConfig {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config');
  return JSON.parse(readFileSync(path.join(dir, 'china.json'), 'utf8')) as ChinaConfig;
}

// ---------------------------------------------------------------------------
// Resident ID numbers (GB 11643-1999)
// ---------------------------------------------------------------------------

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK = '10X98765432';

/** Validates format, birth date and checksum; returns the birth date (YYYY-MM-DD) or null. */
export function parseIdNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(id)) return null;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(id[i]), 0);
  if (CHECK[sum % 11] !== id[17]) return null;
  const y = Number(id.slice(6, 10));
  const m = Number(id.slice(10, 12));
  const d = Number(id.slice(12, 14));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900) return null;
  return `${id.slice(6, 10)}-${id.slice(10, 12)}-${id.slice(12, 14)}`;
}

/** Only a keyed hash of the ID is stored (Appendix D.2: minimal sensitive data). */
export function hashIdNumber(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id.trim().toUpperCase()).digest('hex');
}

export interface RealNameVerifier {
  /** Checks name + ID against the national real-name system. */
  verify(name: string, idNumber: string): Promise<boolean>;
}

/**
 * Development verifier: accepts any well-formed ID. Production must use the
 * national anti-addiction real-name system through the publisher's credentials.
 */
export class DevRealNameVerifier implements RealNameVerifier {
  async verify(name: string, idNumber: string): Promise<boolean> {
    return name.trim().length >= 2 && parseIdNumber(idNumber) !== null;
  }
}

// ---------------------------------------------------------------------------
// Minor play windows (Appendix D.3)
// ---------------------------------------------------------------------------

/** Local wall-clock parts in the configured time zone. */
function local(now: Date, offsetHours: number) {
  const t = new Date(now.getTime() + offsetHours * 3_600_000);
  return { date: t.toISOString().slice(0, 10), day: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), midnightUtc: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - offsetHours * 3_600_000 };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function ageOn(birthDate: string, now: Date, offsetHours: number): number {
  const today = local(now, offsetHours).date;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** If a minor may play right now, when the current window ends; otherwise null. */
export function minorWindowEnd(now: Date, config: ChinaConfig): Date | null {
  const l = local(now, config.utcOffsetHours);
  const windows = [...config.minorWindows.filter((w) => w.days.includes(l.day))];
  if (config.holidays.includes(l.date)) windows.push({ days: [], ...config.holidayWindow });
  for (const w of windows) {
    const start = toMinutes(w.start);
    const end = toMinutes(w.end);
    if (l.minutes >= start && l.minutes < end) return new Date(l.midnightUtc + end * 60_000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Guest trial: at most N minutes per device per period (Appendix D.2)
// ---------------------------------------------------------------------------

/** Returns when the device's trial ends, or null if the trial is used up. */
export async function guestTrialEnd(db: Db, deviceId: string, now: Date, config: ChinaConfig): Promise<Date | null> {
  const periodMs = config.guestTrialPeriodDays * 86_400_000;
  const trialMs = config.guestTrialMinutes * 60_000;
  const rows = await db.query<{ started_at: Date | string }>('SELECT started_at FROM guest_trials WHERE device_id = $1', [deviceId]);
  let started = rows.length ? new Date(rows[0].started_at) : null;
  if (!started || now.getTime() - started.getTime() >= periodMs) {
    started = now;
    await db.query(
      'INSERT INTO guest_trials (device_id, started_at) VALUES ($1, $2) ON CONFLICT (device_id) DO UPDATE SET started_at = $2',
      [deviceId, now],
    );
  }
  const end = new Date(started.getTime() + trialMs);
  return end > now ? end : null;
}

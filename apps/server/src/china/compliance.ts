/**
 * Mainland China requirements (PRD Appendix D.2–D.3): real-name
 * verification, minor play-time windows, and the restricted guest trial.
 * Not legal advice — window rules and holidays are seeded from
 * config/china.json and edited in the admin dashboard (PRD §35).
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

/** Minors get only the weekly windows in a year with no holidays listed. */
export function warnIfNoHolidays(config: ChinaConfig, now = new Date()): void {
  const year = local(now, config.utcOffsetHours).date.slice(0, 4);
  if (!config.holidays.some((d) => d.startsWith(year))) {
    console.warn(`No statutory holidays configured for ${year}: minors get only the weekly windows until they are added in the admin dashboard.`);
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateChinaConfig(c: ChinaConfig): string[] {
  const problems: string[] = [];
  const badSpan = (w: { start: string; end: string }) => !HHMM.test(w?.start) || !HHMM.test(w?.end) || w.start >= w.end;
  if (typeof c.utcOffsetHours !== 'number' || c.utcOffsetHours < -12 || c.utcOffsetHours > 14) problems.push('utcOffsetHours must be between -12 and 14');
  if (!Array.isArray(c.minorWindows)) problems.push('minorWindows must be a list');
  else {
    for (const w of c.minorWindows) {
      if (!Array.isArray(w?.days) || !w.days.length || !w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) problems.push('each minor window needs days from 0 (Sunday) to 6');
      if (badSpan(w)) problems.push(`invalid minor window time ${w?.start}–${w?.end}`);
    }
  }
  if (badSpan(c.holidayWindow)) problems.push('holidayWindow needs a start before its end, as HH:MM');
  if (!Array.isArray(c.holidays)) problems.push('holidays must be a list');
  else {
    for (const d of c.holidays) {
      const valid = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
      if (!valid) problems.push(`invalid holiday date ${d}`);
    }
  }
  if (!Number.isInteger(c.guestTrialMinutes) || c.guestTrialMinutes < 0) problems.push('guestTrialMinutes must be a non-negative integer (0 turns the trial off)');
  if (!Number.isInteger(c.guestTrialPeriodDays) || c.guestTrialPeriodDays < 1) problems.push('guestTrialPeriodDays must be a positive integer');
  return problems;
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

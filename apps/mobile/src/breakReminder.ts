/**
 * Break reminders: after every hour at the table, suggest getting up. Time away from the table
 * pauses the count; a long enough break starts it over.
 */
export const REMIND_EVERY_MS = 60 * 60_000;
/** Away from the table (or the app) this long counts as having had a break. */
export const BREAK_MS = 10 * 60_000;

export interface PlayClock {
  /** Time at the table since the last real break. */
  playedMs: number;
  /** Hours already reminded about. */
  reminded: number;
  /** When the clock last ticked while playing, or when play stopped. */
  lastAt: number;
  playing: boolean;
}

export const newClock = (now: number): PlayClock => ({ playedMs: 0, reminded: 0, lastAt: now, playing: false });

/** Advances the clock to `now`; `remind` is the number of hours played when a reminder is due. */
export function tick(clock: PlayClock, now: number, playing: boolean): { clock: PlayClock; remind: number | null } {
  const elapsed = Math.max(0, now - clock.lastAt);
  if (!clock.playing) {
    // Still away: `lastAt` stays at the moment play stopped, so the break keeps growing.
    if (!playing) return { clock, remind: null };
    // Resuming after a long enough break starts over.
    const fresh = elapsed >= BREAK_MS ? newClock(now) : clock;
    return { clock: { ...fresh, lastAt: now, playing }, remind: null };
  }
  const playedMs = clock.playedMs + elapsed;
  const hours = Math.floor(playedMs / REMIND_EVERY_MS);
  const remind = hours > clock.reminded ? hours : null;
  return { clock: { playedMs, reminded: Math.max(hours, clock.reminded), lastAt: now, playing }, remind };
}

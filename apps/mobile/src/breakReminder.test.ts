import { describe, expect, it } from 'vitest';
import { BREAK_MS, newClock, REMIND_EVERY_MS, tick, type PlayClock } from './breakReminder';

const MIN = 60_000;

/** Runs (minutes, playing) steps one minute at a time; returns the reminders and the clock. */
function run(steps: [number, boolean][]): { reminders: number[]; clock: PlayClock } {
  let clock = newClock(0);
  let now = 0;
  const reminders: number[] = [];
  for (const [minutes, playing] of steps) {
    for (let i = 0; i < minutes; i++) {
      now += MIN;
      const next = tick(clock, now, playing);
      clock = next.clock;
      if (next.remind !== null) reminders.push(next.remind);
    }
  }
  return { reminders, clock };
}

describe('break reminders', () => {
  it('reminds once per hour of play', () => {
    expect(run([[1, true], [150, true]]).reminders).toEqual([1, 2]);
  });

  it('a short pause keeps counting; a real break starts over', () => {
    expect(BREAK_MS).toBeLessThan(REMIND_EVERY_MS);
    // 40 min, 5 min in the lobby, 25 min: an hour of play.
    expect(run([[1, true], [40, true], [5, false], [25, true]]).reminders).toEqual([1]);
    // 40 min, a 15 min break, 25 min: not yet.
    const { reminders, clock } = run([[1, true], [40, true], [15, false], [25, true]]);
    expect(reminders).toEqual([]);
    expect(clock.playedMs).toBe(24 * MIN);
  });
});

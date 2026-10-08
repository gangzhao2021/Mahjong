/**
 * Shared pace for games nobody is watching (the player left or is offline).
 * Such games play out with no artificial delay, but all of them together
 * get a fixed budget of actions per second, so a wave of abandoned or
 * restored games cannot starve the tables people are playing at. The queue
 * is first-in first-out and each room queues one step at a time, so rooms
 * take turns fairly.
 */
export type Cancel = () => void;

const TICK_MS = 20;

export class Pacer {
  private queue: { fn: () => void; cancelled: boolean }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly perTick: number;

  constructor(actionsPerSecond: number) {
    this.perTick = Math.max(1, Math.round((actionsPerSecond * TICK_MS) / 1000));
  }

  get waiting(): number {
    return this.queue.length;
  }

  schedule(fn: () => void): Cancel {
    const job = { fn, cancelled: false };
    this.queue.push(job);
    this.timer ??= setTimeout(() => this.tick(), 0);
    return () => {
      job.cancelled = true;
    };
  }

  private tick(): void {
    this.timer = null;
    let ran = 0;
    while (ran < this.perTick && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.cancelled) continue;
      ran++;
      try {
        job.fn();
      } catch (error) {
        console.error('Unattended game step failed:', error);
      }
    }
    if (this.queue.length) this.timer = setTimeout(() => this.tick(), TICK_MS);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
  }
}

/** setTimeout with the same cancel shape as the pacer. */
export function after(ms: number, fn: () => void): Cancel {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

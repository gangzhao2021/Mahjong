import { describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer';

describe('unattended game pacer', () => {
  it('runs queued steps in order within the per-second budget, skipping cancelled ones', async () => {
    const pacer = new Pacer(500); // 10 per 20 ms tick
    const ran: number[] = [];
    const cancels = Array.from({ length: 40 }, (_, i) => pacer.schedule(() => ran.push(i)));
    cancels[5]();
    await new Promise((r) => setTimeout(r, 5));
    expect(ran).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10]);
    await new Promise((r) => setTimeout(r, 200));
    expect(ran).toHaveLength(39);
    expect(pacer.waiting).toBe(0);
    pacer.dispose();
  });

  it('keeps going when a step throws', async () => {
    const pacer = new Pacer(1000);
    const ran: string[] = [];
    pacer.schedule(() => {
      throw new Error('boom');
    });
    pacer.schedule(() => ran.push('after'));
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toEqual(['after']);
    pacer.dispose();
  });
});

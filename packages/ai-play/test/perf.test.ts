/**
 * Performance budget (PRD §50 Phase 6): the server runs every AI seat, so a
 * decision must be cheap. Budgets are generous (CI machines vary) but catch
 * order-of-magnitude regressions. They count CPU time, not wall time: other
 * test files run in parallel, and waiting for a core pushed a 0.5 ms decision
 * past 2 ms of wall time.
 */
import { apply, createGame, createRng, legalActions, SEATS, startHand, viewFor, withRules } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src';

// This package has no Node types (its code also runs in the app), so declare the one Node call used here.
declare const process: { cpuUsage(since?: { user: number; system: number }): { user: number; system: number } };

describe('performance', () => {
  it('an expert AI decision averages under 2 ms and a full hand under 150 ms', () => {
    const rng = createRng(7);
    let decisions = 0;
    let hands = 0;
    const start = process.cpuUsage();
    for (let g = 0; g < 20; g++) {
      let h = startHand(createGame({ ruleSet: withRules({}), baseScore: 1, seed: 900 + g }));
      while (h.phase !== 'ended') {
        const seat = SEATS.find((s) => Object.keys(legalActions(h, s)).length > 0)!;
        h = apply(h, chooseAction(viewFor(h, seat), 'expert', rng)!).state;
        decisions++;
      }
      hands++;
    }
    const { user, system } = process.cpuUsage(start);
    const elapsed = (user + system) / 1000;
    expect(elapsed / decisions).toBeLessThan(2);
    expect(elapsed / hands).toBeLessThan(150);
  });
});

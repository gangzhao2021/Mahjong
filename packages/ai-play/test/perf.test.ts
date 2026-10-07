/**
 * Performance budget (PRD §50 Phase 6): the server runs every AI seat, so a
 * decision must be cheap. Budgets are generous (CI machines vary) but catch
 * order-of-magnitude regressions.
 */
import { apply, createGame, createRng, legalActions, SEATS, startHand, viewFor, withRules } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../src';

describe('performance', () => {
  it('an expert AI decision averages under 2 ms and a full hand under 150 ms', () => {
    const rng = createRng(7);
    let decisions = 0;
    let hands = 0;
    const start = Date.now();
    for (let g = 0; g < 20; g++) {
      let h = startHand(createGame({ ruleSet: withRules({}), baseScore: 1, seed: 900 + g }));
      while (h.phase !== 'ended') {
        const seat = SEATS.find((s) => Object.keys(legalActions(h, s)).length > 0)!;
        h = apply(h, chooseAction(viewFor(h, seat), 'expert', rng)!).state;
        decisions++;
      }
      hands++;
    }
    const elapsed = Date.now() - start;
    expect(elapsed / decisions).toBeLessThan(2);
    expect(elapsed / hands).toBeLessThan(150);
  });
});

import { legalActions, SUITS, suitOf, type HandState } from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { LESSONS, type Intent } from './lessons';
import { autoPlay, playerCanAct, tryPlayerMove } from './runner';

/** Every move the player could make right now. */
function candidates(s: HandState): Intent[] {
  const legal = legalActions(s, 0);
  const out: Intent[] = [];
  for (const suit of legal.swapSuits ?? []) {
    out.push({ type: 'swap', tiles: s.players[0].hand.filter((t) => suitOf(t) === suit).slice(0, 3) });
  }
  if (legal.dingque) for (const suit of SUITS) out.push({ type: 'dingque', suit });
  for (const tile of legal.discard ?? []) out.push({ type: 'discard', tile });
  for (const tile of legal.selfKong ?? []) out.push({ type: 'selfKong', tile });
  for (const type of ['zimo', 'hu', 'pong', 'kong', 'pass'] as const) if (legal[type]) out.push({ type });
  return out;
}

const runAuto = (s: HandState) => autoPlay(s).reduce((acc, t) => t.state, s);

describe('tutorial lessons', () => {
  it.each(LESSONS.map((l) => [l.title, l] as const))('%s can be completed exactly as scripted', (_title, lesson) => {
    let state = lesson.setup();
    if (lesson.autoPlayFirst) state = runAuto(state);

    lesson.steps.forEach((step, i) => {
      if (!step.expect) return;
      expect(playerCanAct(state), `step ${i}: the player should have a move`).toBe(true);
      expect(step.hint, `step ${i}: action steps need a hint`).toBeTruthy();
      const right = candidates(state).filter((c) => step.expect!(c, state));
      expect(right.length, `step ${i}: "${step.text}" has no legal way to succeed`).toBeGreaterThan(0);
      // A wrong move is refused without changing anything.
      const wrong = candidates(state).find((c) => !step.expect!(c, state));
      if (wrong) expect(tryPlayerMove(state, step, wrong)).toBeNull();

      state = tryPlayerMove(state, step, right[0])!.state;
      if (step.thenAutoPlay) state = runAuto(state);
    });
  });

  it('opponents never win or claim, so the script cannot be derailed', () => {
    for (const lesson of LESSONS) {
      let state = lesson.setup();
      if (lesson.autoPlayFirst) state = runAuto(state);
      for (const step of lesson.steps) {
        if (!step.expect) continue;
        const move = candidates(state).find((c) => step.expect!(c, state))!;
        state = tryPlayerMove(state, step, move)!.state;
        if (step.thenAutoPlay) state = runAuto(state);
        expect(state.wins.every((w) => w.seat === 0)).toBe(true);
        expect(state.players.slice(1).every((p) => p.melds.length === 0)).toBe(true);
      }
    }
  });
});

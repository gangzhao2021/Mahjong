import { describe, expect, it } from 'vitest';
import {
  allTilesOf,
  apply,
  createGame,
  createRng,
  isGameOver,
  legalActions,
  recordHand,
  SEATS,
  startHand,
  suitOf,
  viewFor,
  withRules,
  type Action,
  type HandState,
  type Seat,
} from '../src';

/** Random legal policy that still prefers wins and claims, so rare rules get exercised. */
function randomAction(h: HandState, seat: Seat, rng: () => number): Action | null {
  const legal = legalActions(h, seat);
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  if (legal.swapSuits) {
    const suit = pick(legal.swapSuits);
    return { type: 'swap', seat, tiles: h.players[seat].hand.filter((t) => suitOf(t) === suit).slice(0, 3) };
  }
  if (legal.dingque) return { type: 'dingque', seat, suit: pick([0, 1, 2] as const) };
  if (legal.zimo && rng() < 0.9) return { type: 'zimo', seat };
  if (legal.hu && rng() < 0.9) return { type: 'hu', seat };
  if (legal.selfKong && rng() < 0.7) return { type: 'selfKong', seat, tile: pick(legal.selfKong) };
  if (legal.kong && rng() < 0.7) return { type: 'kong', seat };
  if (legal.pong && rng() < 0.6) return { type: 'pong', seat };
  if (legal.discard) return { type: 'discard', seat, tile: pick(legal.discard) };
  if (legal.pass) return { type: 'pass', seat };
  return null;
}

function tileTotal(h: HandState): number {
  let n = h.wall.length;
  for (const p of h.players) {
    n += allTilesOf(p.hand, p.melds).length + p.discards.filter((d) => !d.claimed).length;
  }
  return n;
}

describe('randomized full games', () => {
  it.each([
    ['default rules', withRules({})],
    ['no swap, no multi-win, fan payouts', withRules({ huanSanZhang: { enabled: false, direction: 'random' }, allowMultiWin: false, selfDrawBonus: 'fan' })],
    ['loose rules', withRules({ mustDiscardVoidFirst: false, passedWinRestriction: false, callTransfer: false, maxFan: 6 })],
  ])('%s: zero-sum, tiles conserved, no hidden-info leaks', (_name, ruleSet) => {
    const rng = createRng(1234);
    const reasons = new Set<string>();
    const patterns = new Set<string>();

    for (let g = 0; g < 60; g++) {
      let game = createGame({ ruleSet, baseScore: 10, seed: g * 7919 + 1 });
      while (!isGameOver(game)) {
        let h = startHand(game);
        let duplicatedWinTiles = 0;
        for (let step = 0; h.phase !== 'ended'; step++) {
          expect(step).toBeLessThan(2000);
          const ready = SEATS.filter((s) => Object.keys(legalActions(h, s)).length > 0);
          expect(ready.length).toBeGreaterThan(0);
          const seat = ready[Math.floor(rng() * ready.length)];
          const r = apply(h, randomAction(h, seat, rng)!);
          // In a multi-win, the same discarded tile completes several hands.
          const claimWins = r.events.filter((e) => e.type === 'win' && !e.win.selfDraw).length;
          duplicatedWinTiles += Math.max(0, claimWins - 1);
          h = r.state;

          if (h.phase === 'play') {
            expect(tileTotal(h)).toBe(108 + duplicatedWinTiles);
            for (const viewer of SEATS) {
              const v = viewFor(h, viewer);
              for (const p of v.players) {
                if (p.seat !== viewer && !p.won) expect(p.hand).toBeNull();
              }
            }
          }
        }
        const result = h.result!;
        expect(result.deltas.reduce((a, b) => a + b, 0)).toBe(0);
        reasons.add(result.reason);
        result.wins.forEach((w) => w.patterns.forEach((p) => patterns.add(p)));
        game = recordHand(game, result);
      }
      expect(game.totals.reduce((a, b) => a + b, 0)).toBe(0);
    }
    // Random play rarely produces three winners; that path is covered by unit tests.
    expect(reasons.has('wallExhausted')).toBe(true);
    expect(patterns.size).toBeGreaterThan(0);
  });

  it('血流成河: winners play on with locked hands; hands end only when the wall runs out', () => {
    const ruleSet = withRules({ xueliu: true });
    const rng = createRng(4321);
    let repeatWinners = 0;
    for (let g = 0; g < 40; g++) {
      let game = createGame({ ruleSet, baseScore: 10, seed: g * 104729 + 3 });
      while (!isGameOver(game)) {
        let h = startHand(game);
        let duplicatedWinTiles = 0;
        for (let step = 0; h.phase !== 'ended'; step++) {
          expect(step).toBeLessThan(3000);
          const ready = SEATS.filter((s) => Object.keys(legalActions(h, s)).length > 0);
          expect(ready.length).toBeGreaterThan(0);
          const seat = ready[Math.floor(rng() * ready.length)];
          // A locked winner may only throw the tile just drawn (or win again).
          const legal = legalActions(h, seat);
          if (h.players[seat].won && h.stage.kind === 'turn' && legal.discard) expect(legal.discard).toEqual([h.stage.drawn]);
          if (h.players[seat].won) expect(legal.pong || legal.kong || legal.selfKong).toBeFalsy();
          const r = apply(h, randomAction(h, seat, rng)!);
          const claimWins = r.events.filter((e) => e.type === 'win' && !e.win.selfDraw).length;
          duplicatedWinTiles += Math.max(0, claimWins - 1);
          h = r.state;
          if (h.phase === 'play') {
            // Each winning tile is set aside instead of joining the hand.
            expect(tileTotal(h)).toBe(108 + duplicatedWinTiles - h.wins.length);
            // A winner's locked hand is 13 tiles, plus the one just drawn on their own turn.
            for (const [i, p] of h.players.entries()) {
              const drawing = h.stage.kind === 'turn' && h.stage.seat === i ? 1 : 0;
              if (p.won) expect(p.hand.length + p.melds.length * 3).toBe(13 + drawing);
            }
          }
        }
        const result = h.result!;
        expect(result.reason).toBe('wallExhausted');
        expect(result.deltas.reduce((a, b) => a + b, 0)).toBe(0);
        const perSeat = SEATS.map((s) => result.wins.filter((w) => w.seat === s).length);
        if (perSeat.some((n) => n > 1)) repeatWinners++;
        game = recordHand(game, result);
      }
      expect(game.totals.reduce((a, b) => a + b, 0)).toBe(0);
    }
    expect(repeatWinners).toBeGreaterThan(0);
  });
});

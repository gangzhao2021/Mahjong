import {
  apply,
  createGame,
  createRng,
  customHand,
  isGameOver,
  legalActions,
  parseTiles,
  recordHand,
  SEATS,
  startHand,
  toCounts,
  viewFor,
  withRules,
  type GameState,
  type HandResult,
} from '@mahjong/engine';
import { describe, expect, it } from 'vitest';
import { chooseAction, shanten, timeoutAction, type SkillLevel } from '../src';

const sh = (hand: string, melds = 0) => shanten(toCounts(parseTiles(hand)), melds);

describe('shanten', () => {
  it.each([
    ['complete hand', '123m456m789m234s55s', 0, -1],
    ['ready hand', '123m456m789m23s55s', 0, 0],
    ['two away', '123m456m789m2s5s8s', 0, 2],
    ['one away', '123m456m789m2s3s8s', 0, 1],
    ['seven pairs ready', '11m22m33m44m55s66s7s', 0, 0],
    ['four of a kind counts as two pairs', '1111m22m33m55s66s7s', 0, 0],
    ['with melds', '23s55s', 3, 0],
  ])('%s', (_name, hand, melds, expected) => {
    expect(sh(hand, melds)).toBe(expected);
  });
});

interface Totals {
  totals: number[];
  results: HandResult[];
}

/** Plays complete games with the given skill per seat, actions in random seat order. */
function playGames(skills: SkillLevel[], games: number, seed: number): Totals {
  const rng = createRng(seed);
  const totals = [0, 0, 0, 0];
  const results: HandResult[] = [];
  for (let g = 0; g < games; g++) {
    let game: GameState = createGame({ ruleSet: withRules({}), baseScore: 1, seed: seed * 1000 + g });
    while (!isGameOver(game)) {
      let h = startHand(game);
      while (h.phase !== 'ended') {
        const ready = SEATS.filter((s) => Object.keys(legalActions(h, s)).length > 0);
        const seat = ready[Math.floor(rng() * ready.length)];
        const action = chooseAction(viewFor(h, seat), skills[seat], rng);
        expect(action).not.toBeNull();
        h = apply(h, action!).state;
      }
      results.push(h.result!);
      game = recordHand(game, h.result!);
    }
    game.totals.forEach((t, i) => (totals[i] += t));
  }
  return { totals, results };
}

describe('self-play', () => {
  it('experts complete hands with a realistic spread of outcomes', () => {
    const { results } = playGames(['expert', 'expert', 'expert', 'expert'], 25, 1);
    const wins = results.flatMap((r) => r.wins);
    const patterns = new Set(wins.flatMap((w) => w.patterns));
    // Most hands should see winners, and some hands three winners.
    expect(wins.length / results.length).toBeGreaterThan(1.5);
    expect(results.some((r) => r.reason === 'threeWon')).toBe(true);
    expect(patterns.size).toBeGreaterThanOrEqual(6);
  });

  it('an expert beats three beginners over many games', () => {
    const { totals } = playGames(['expert', 'beginner', 'beginner', 'beginner'], 40, 2);
    expect(totals[0]).toBeGreaterThan(0);
    expect(totals[0]).toBeGreaterThan(Math.max(totals[1], totals[2], totals[3]));
  });

  it('a beginner loses to three experts over many games', () => {
    const { totals } = playGames(['beginner', 'expert', 'expert', 'expert'], 40, 3);
    expect(totals[0]).toBeLessThan(0);
  });
});

describe('timeout fallback', () => {
  it('never declares a win and passes on claims', () => {
    const rng = createRng(5);
    let game = createGame({ ruleSet: withRules({}), baseScore: 1, seed: 77 });
    let h = startHand(game);
    let steps = 0;
    while (h.phase !== 'ended') {
      const seat = SEATS.find((s) => Object.keys(legalActions(h, s)).length > 0)!;
      const action = timeoutAction(viewFor(h, seat), rng)!;
      expect(['zimo', 'hu', 'pong', 'kong', 'selfKong']).not.toContain(action.type);
      h = apply(h, action).state;
      steps++;
    }
    expect(h.result!.wins).toHaveLength(0);
    expect(steps).toBeGreaterThan(50);
    game = recordHand(game, h.result!);
  });
});

describe('dead waits', () => {
  // Seat 0 drew 9s holding 123m 456m 789m 11s 46s: throwing 9s is ready on 5s alone (kanchan).
  const setup = (wall: string, deadFive: boolean) => {
    const s = customHand({
      hands: ['123m456m789m11s46s9s', '1112223334445m', '1112223334446p', '5556667778889p'],
      voids: [2, 2, 1, 1],
      wall,
      turn: 0,
      drawn: '9s',
    });
    // All four 5s already on the table: the wait is dead.
    if (deadFive) for (const seat of [1, 1, 2, 3] as const) s.players[seat].discards.push({ tile: parseTiles('5s')[0], claimed: false });
    return viewFor(s, 0);
  };
  const LONG = '7s7s8s8s2s2s3s3s6s9s';
  const SHORT = '7s8s2s';
  const nine = parseTiles('9s')[0];

  it('keeps a live wait', () => {
    expect(chooseAction(setup(LONG, false), 'expert', () => 0.5)).toMatchObject({ type: 'discard', tile: nine });
  });

  it('gives up a dead wait while the wall is long', () => {
    for (const skill of ['expert', 'intermediate'] as SkillLevel[]) {
      expect(chooseAction(setup(LONG, true), skill, () => 0.5)).not.toMatchObject({ type: 'discard', tile: nine });
    }
  });

  it('keeps even a dead wait near the end, against 查大叫', () => {
    expect(chooseAction(setup(SHORT, true), 'expert', () => 0.5)).toMatchObject({ type: 'discard', tile: nine });
  });
});

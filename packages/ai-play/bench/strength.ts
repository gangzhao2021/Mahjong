import { apply, createGame, createRng, isGameOver, legalActions, recordHand, SEATS, startHand, viewFor, withRules, type GameState } from '@mahjong/engine';
import { chooseAction, type SkillLevel } from '../src';
/**
 * AI strength benchmark: one player of a skill vs three of another, over many 4-hand games, reporting
 * the per-game net (base units) with its standard error, win rate, average win and deal-in rate.
 *   pnpm ai:bench [games=800] [me:others,...=expert:intermediate,intermediate:intermediate] [seed=11]
 * Use thousands of games: the standard error at 800 is about ±0.3 base per game.
 */
function run(me: SkillLevel, others: SkillLevel, games: number, seed: number) {
  const rng = createRng(seed);
  const nets: number[] = [];
  let hands = 0, wins = 0, dealIns = 0, winScore = 0;
  for (let g = 0; g < games; g++) {
    let game: GameState = createGame({ ruleSet: withRules({}), baseScore: 1, seed: seed * 10000 + g });
    const meSeat = (g % 4) as 0 | 1 | 2 | 3;
    while (!isGameOver(game)) {
      let h = startHand(game);
      while (h.phase !== 'ended') {
        const ready = SEATS.filter((s) => Object.keys(legalActions(h, s)).length > 0);
        const seat = ready[Math.floor(rng() * ready.length)];
        h = apply(h, chooseAction(viewFor(h, seat), seat === meSeat ? me : others, rng)!).state;
      }
      hands++;
      for (const w of h.result!.wins) {
        if (w.seat === meSeat) { wins++; winScore += w.score; }
        if (w.from === meSeat) dealIns++;
      }
      game = recordHand(game, h.result!);
    }
    nets.push(game.totals[meSeat]);
  }
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const sd = Math.sqrt(nets.reduce((a, b) => a + (b - mean) ** 2, 0) / nets.length);
  return `${me} vs ${others}: ${mean.toFixed(2)} ± ${(sd / Math.sqrt(nets.length)).toFixed(2)} /game | win ${(wins / hands * 100).toFixed(1)}% avg ${(winScore / wins).toFixed(2)} | deal-in ${(dealIns / hands * 100).toFixed(1)}%`;
}
const games = Number(process.argv[2] ?? 800);
for (const pair of (process.argv[3] ?? 'expert:intermediate,intermediate:intermediate').split(',')) {
  const [a, b] = pair.split(':') as [SkillLevel, SkillLevel];
  console.log(run(a, b, games, Number(process.argv[4] ?? 11)));
}

/** A game = `handsPerGame` hands at the same table (PRD Appendix A.10 terminology). */
import { createHand } from './engine';
import { createRng, deriveSeed, randomInt } from './rng';
import type { RuleSet } from './ruleset';
import type { HandResult, HandState, Seat } from './types';

export interface GameConfig {
  ruleSet: RuleSet;
  baseScore: number;
  seed: number;
}

export interface GameState {
  config: GameConfig;
  /** Index of the next hand to be played. */
  handIndex: number;
  dealer: Seat;
  totals: [number, number, number, number];
  results: HandResult[];
}

export function createGame(config: GameConfig): GameState {
  return {
    config,
    handIndex: 0,
    // The first dealer is drawn among the seats in play.
    dealer: config.ruleSet.seats[randomInt(createRng(config.seed), config.ruleSet.seats.length)],
    totals: [0, 0, 0, 0],
    results: [],
  };
}

export function handSeed(game: GameState): number {
  return deriveSeed(game.config.seed, game.handIndex);
}

export function startHand(game: GameState): HandState {
  if (isGameOver(game)) throw new Error('Game is over');
  return createHand({
    ruleSet: game.config.ruleSet,
    baseScore: game.config.baseScore,
    seed: handSeed(game),
    dealer: game.dealer,
  });
}

export function recordHand(game: GameState, result: HandResult): GameState {
  const totals = game.totals.map((t, i) => t + result.deltas[i]) as GameState['totals'];
  return {
    ...game,
    handIndex: game.handIndex + 1,
    dealer: nextDealer(game, result),
    totals,
    results: [...game.results, result],
  };
}

function nextDealer(game: GameState, result: HandResult): Seat {
  if (game.config.ruleSet.dealerRule === 'rotate') {
    const seats = game.config.ruleSet.seats;
    return seats[(seats.indexOf(game.dealer) + 1) % seats.length];
  }
  return result.wins[0]?.seat ?? game.dealer;
}

export function isGameOver(game: GameState): boolean {
  return game.handIndex >= game.config.ruleSet.handsPerGame;
}

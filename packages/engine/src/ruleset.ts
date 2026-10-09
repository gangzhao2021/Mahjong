/** Rule variants (PRD Appendix A.10). Defaults are the confirmed values. */
import type { Suit } from './tiles';
import type { Seat } from './types';

export type SwapDirection = 'clockwise' | 'counterClockwise' | 'opposite';

export interface RuleSet {
  huanSanZhang: { enabled: boolean; direction: 'random' | SwapDirection };
  mustDiscardVoidFirst: boolean;
  allowMultiWin: boolean;
  /** 过手胡: after passing on a win, no discard win until the player's next draw. */
  passedWinRestriction: boolean;
  /** Allow an added kong with a pong tile kept in hand from an earlier turn. */
  allowDelayedAddedKong: boolean;
  selfDrawBonus: 'fan' | 'base';
  /** 封顶 */
  maxFan: number;
  enabledPatterns: {
    jinGouDiao: boolean;
    jiangDui: boolean;
    tianDiHu: boolean;
    haiDi: boolean;
    gangShangPao: boolean;
    qiangGang: boolean;
  };
  /** 呼叫转移 */
  callTransfer: boolean;
  drawSettlement: { checkHuaZhu: boolean; checkDaJiao: boolean; kongRefund: boolean };
  dealerRule: 'firstWinner' | 'rotate';
  handsPerGame: number;
  /**
   * 血流成河: winners stay in and can win again; the hand ends only when the wall
   * runs out. After a win the hand is locked (the winning tile is set aside):
   * the winner discards whatever they draw unless it wins again.
   * Off = 血战到底 (a winner leaves the hand; it ends when three have won).
   */
  xueliu: boolean;
  /**
   * Seats in play: all four, or fewer for friends' tables (two players sit opposite).
   * Empty seats get no tiles, no turns and take no part in payments.
   */
  seats: Seat[];
  /**
   * Suits in the wall. Two suits (条 and 筒: 两房, 72 tiles) is the usual rule for
   * three- and two-player tables: with only two suits there is no swap and no void suit.
   */
  suits: Suit[];
}

export const DEFAULT_RULESET: RuleSet = {
  huanSanZhang: { enabled: true, direction: 'random' },
  mustDiscardVoidFirst: true,
  allowMultiWin: true,
  passedWinRestriction: true,
  allowDelayedAddedKong: true,
  selfDrawBonus: 'base',
  maxFan: 4,
  enabledPatterns: {
    jinGouDiao: true,
    jiangDui: true,
    tianDiHu: true,
    haiDi: true,
    gangShangPao: true,
    qiangGang: true,
  },
  callTransfer: true,
  drawSettlement: { checkHuaZhu: true, checkDaJiao: true, kongRefund: true },
  dealerRule: 'firstWinner',
  handsPerGame: 4,
  xueliu: false,
  seats: [0, 1, 2, 3],
  suits: [0, 1, 2],
};

/** 三人两房 / 二人两房: the seats in play and the two-suit wall (no swap, no void suit). */
export function smallTableRules(players: 2 | 3): Pick<RuleSet, 'seats' | 'suits' | 'huanSanZhang'> {
  return {
    seats: players === 3 ? [0, 1, 2] : [0, 2],
    suits: [1, 2],
    huanSanZhang: { enabled: false, direction: 'random' },
  };
}

/** Uses two suits only (两房): no swap and no void suit. */
export function isTwoSuit(rules: Pick<RuleSet, 'suits'>): boolean {
  return rules.suits.length < 3;
}

export function withRules(overrides: Partial<RuleSet>): RuleSet {
  return { ...DEFAULT_RULESET, ...overrides };
}

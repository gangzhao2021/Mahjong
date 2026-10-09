/** Rule variants (PRD Appendix A.10). Defaults are the confirmed values. */
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
};

export function withRules(overrides: Partial<RuleSet>): RuleSet {
  return { ...DEFAULT_RULESET, ...overrides };
}

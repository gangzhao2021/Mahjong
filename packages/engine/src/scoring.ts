import { allTilesOf, isAllTripletsShape, isSevenPairsShape, isStandardShape } from './hands';
import type { RuleSet } from './ruleset';
import { rankOf, suitOf, toCounts, type Tile } from './tiles';
import type { Meld } from './types';

/** Fan patterns (PRD Appendix A.6). */
export type Pattern =
  | 'pingHu' // 平胡
  | 'duiDuiHu' // 对对胡
  | 'qingYiSe' // 清一色
  | 'qiDui' // 七对
  | 'jinGouDiao' // 金钩钓
  | 'jiangDui' // 将对
  | 'qingDui' // 清对
  | 'longQiDui' // 龙七对
  | 'qingQiDui' // 清七对
  | 'qingLongQiDui' // 清龙七对
  | 'gen' // 根 (one entry per root)
  | 'gangShangHua' // 杠上花
  | 'gangShangPao' // 杠上炮
  | 'qiangGang' // 抢杠胡
  | 'haiDi' // 海底捞月
  | 'ziMo' // 自摸
  | 'tianHu' // 天胡
  | 'diHu'; // 地胡

export interface WinContext {
  selfDraw: boolean;
  gangShangHua: boolean;
  gangShangPao: boolean;
  qiangGang: boolean;
  haiDi: boolean;
  tianHu: boolean;
  diHu: boolean;
}

export const NO_SITUATION: WinContext = {
  selfDraw: false,
  gangShangHua: false,
  gangShangPao: false,
  qiangGang: false,
  haiDi: false,
  tianHu: false,
  diHu: false,
};

export interface FanResult {
  /** Fan before the cap. */
  rawFan: number;
  /** Fan after the cap (封顶). */
  fan: number;
  patterns: Pattern[];
  /** baseScore × 2^fan (+ baseScore for self-draw when selfDrawBonus = "base"). */
  score: number;
}

const BASE_FAN: Record<string, number> = {
  pingHu: 0,
  duiDuiHu: 1,
  qingYiSe: 2,
  qiDui: 2,
  jinGouDiao: 2,
  jiangDui: 3,
  qingDui: 3,
  longQiDui: 3,
  qingQiDui: 4,
  qingLongQiDui: 5,
};

function basePattern(hand: readonly Tile[], melds: readonly Meld[], rules: RuleSet): Pattern {
  const counts = toCounts(hand);
  const all = allTilesOf(hand, melds);
  const flush = new Set(all.map(suitOf)).size === 1;
  const candidates: Pattern[] = [];

  if (isSevenPairsShape(counts, melds.length)) {
    const dragon = counts.some((n) => n === 4);
    if (flush) candidates.push(dragon ? 'qingLongQiDui' : 'qingQiDui');
    candidates.push(dragon ? 'longQiDui' : 'qiDui');
  }
  if (isStandardShape(counts)) {
    candidates.push('pingHu');
    if (flush) candidates.push('qingYiSe');
    if (isAllTripletsShape(counts)) {
      candidates.push('duiDuiHu');
      if (flush) candidates.push('qingDui');
      if (melds.length === 4 && rules.enabledPatterns.jinGouDiao) candidates.push('jinGouDiao');
      if (rules.enabledPatterns.jiangDui && all.every((t) => [2, 5, 8].includes(rankOf(t)))) {
        candidates.push('jiangDui');
      }
    }
  }
  if (candidates.length === 0) throw new Error('Not a winning hand');
  return candidates.reduce((best, p) => (BASE_FAN[p] > BASE_FAN[best] ? p : best));
}

/** Number of 根: kinds with all four copies among the player's tiles (kongs included). */
export function countRoots(hand: readonly Tile[], melds: readonly Meld[]): number {
  return toCounts(allTilesOf(hand, melds)).filter((n) => n === 4).length;
}

/** Scores a winning hand. `hand` is the concealed hand including the winning tile. */
export function scoreWin(
  hand: readonly Tile[],
  melds: readonly Meld[],
  ctx: WinContext,
  rules: RuleSet,
  baseScore: number,
): FanResult {
  const base = basePattern(hand, melds, rules);
  const patterns: Pattern[] = [base];
  let fan = BASE_FAN[base];

  let roots = countRoots(hand, melds);
  // For 龙七对 / 清龙七对 the first root is already part of the pattern.
  if (base === 'longQiDui' || base === 'qingLongQiDui') roots--;
  for (let i = 0; i < roots; i++) patterns.push('gen');
  fan += roots;

  const p = rules.enabledPatterns;
  if (ctx.gangShangHua) (fan++, patterns.push('gangShangHua'));
  if (ctx.gangShangPao && p.gangShangPao) (fan++, patterns.push('gangShangPao'));
  if (ctx.qiangGang && p.qiangGang) (fan++, patterns.push('qiangGang'));
  if (ctx.haiDi && p.haiDi) (fan++, patterns.push('haiDi'));
  if (ctx.selfDraw) {
    patterns.push('ziMo');
    if (rules.selfDrawBonus === 'fan') fan++;
  }
  if (p.tianDiHu && (ctx.tianHu || ctx.diHu)) {
    patterns.push(ctx.tianHu ? 'tianHu' : 'diHu');
    fan = Math.max(fan, rules.maxFan);
  }

  const capped = Math.min(fan, rules.maxFan);
  let score = baseScore * 2 ** capped;
  if (ctx.selfDraw && rules.selfDrawBonus === 'base') score += baseScore;
  return { rawFan: fan, fan: capped, patterns, score };
}

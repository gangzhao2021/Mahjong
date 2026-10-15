import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, NO_SITUATION, parseTiles, patternFan, scoreWin, withRules, type Meld, type WinContext } from '../src';
import { t } from './helpers';

function score(hand: string, opts: { melds?: Meld[]; ctx?: Partial<WinContext>; rules?: typeof DEFAULT_RULESET; base?: number } = {}) {
  return scoreWin(
    parseTiles(hand),
    opts.melds ?? [],
    { ...NO_SITUATION, ...opts.ctx },
    opts.rules ?? DEFAULT_RULESET,
    opts.base ?? 1,
  );
}

const pong = (tile: string): Meld => ({ type: 'pong', tile: t(tile), from: 1 });

describe('base patterns (Appendix A.6)', () => {
  it.each([
    ['平胡 pingHu', '123m456m789m234s55s', 'pingHu', 0],
    ['对对胡 duiDuiHu', '111m444m333s777s55s', 'duiDuiHu', 1],
    ['清一色 qingYiSe', '123m456m789m234m55m', 'qingYiSe', 2],
    ['七对 qiDui', '11m22m33m44m55s66s77s', 'qiDui', 2],
    ['将对 jiangDui', '222m555m888m222s55s', 'jiangDui', 3],
    ['清对 qingDui', '111m222m333m444m55m', 'qingDui', 3],
    ['龙七对 longQiDui', '1111m22m33m44s55s66s', 'longQiDui', 3],
    ['清七对 qingQiDui', '11m22m33m44m55m66m77m', 'qingQiDui', 4],
  ])('%s', (_name, hand, pattern, fan) => {
    const r = score(hand);
    expect(r.patterns[0]).toBe(pattern);
    expect(r.fan).toBe(fan);
  });

  it('清龙七对 qingLongQiDui is 5 fan, capped at 4 by default', () => {
    const r = score('1111m22m33m44m55m66m');
    expect(r.patterns[0]).toBe('qingLongQiDui');
    expect(r.rawFan).toBe(5);
    expect(r.fan).toBe(4);
    expect(score('1111m22m33m44m55m66m', { rules: withRules({ maxFan: 6 }) }).fan).toBe(5);
  });

  it('金钩钓 jinGouDiao: four melds and a single pair', () => {
    const r = score('55s', { melds: [pong('1m'), pong('4m'), pong('3s'), pong('7s')] });
    expect(r.patterns).toEqual(['jinGouDiao']);
    expect(r.fan).toBe(2);
  });

  it('disabled patterns fall back to the next best one', () => {
    const rules = withRules({ enabledPatterns: { ...DEFAULT_RULESET.enabledPatterns, jinGouDiao: false } });
    const r = score('55s', { melds: [pong('1m'), pong('4m'), pong('3s'), pong('7s')], rules });
    expect(r.patterns).toEqual(['duiDuiHu']);
  });
});

describe('roots and bonuses', () => {
  it('counts a concealed four-of-a-kind as a root', () => {
    const r = score('1111m23m456m789m55s');
    expect(r.patterns).toEqual(['pingHu', 'gen']);
    expect(r.fan).toBe(1);
  });

  it('counts a kong meld as a root', () => {
    const r = score('123m456m789m55s', { melds: [{ type: 'concealedKong', tile: t('9s') }] });
    expect(r.patterns).toEqual(['pingHu', 'gen']);
  });

  it('counts a pong plus the fourth tile in hand as a root', () => {
    const r = score('123m456m789m55s', { melds: [pong('1m')] });
    expect(r.patterns).toContain('gen');
  });

  it('龙七对 does not count its first four-of-a-kind again', () => {
    const r = score('1111m2222m33m44s55s');
    expect(r.patterns).toEqual(['longQiDui', 'gen']);
    expect(r.fan).toBe(4);
  });

  it.each([
    ['gangShangHua', { gangShangHua: true }],
    ['gangShangPao', { gangShangPao: true }],
    ['qiangGang', { qiangGang: true }],
    ['haiDi', { haiDi: true }],
  ])('%s adds one fan', (pattern, ctx) => {
    const r = score('123m456m789m234s55s', { ctx });
    expect(r.patterns).toContain(pattern);
    expect(r.fan).toBe(1);
  });

  it('self-draw adds one base by default', () => {
    const r = score('123m456m789m234s55s', { ctx: { selfDraw: true }, base: 100 });
    expect(r.patterns).toContain('ziMo');
    expect(r.score).toBe(200);
  });

  it('self-draw adds one fan when selfDrawBonus = "fan"', () => {
    const r = score('123m456m789m234s55s', { ctx: { selfDraw: true }, base: 100, rules: withRules({ selfDrawBonus: 'fan' }) });
    expect(r.fan).toBe(1);
    expect(r.score).toBe(200);
  });

  it('天胡 / 地胡 score the cap', () => {
    expect(score('123m456m789m234s55s', { ctx: { tianHu: true } }).fan).toBe(4);
    expect(score('123m456m789m234s55s', { ctx: { diHu: true }, rules: withRules({ maxFan: 3 }) }).fan).toBe(3);
  });

  it('A.11 example: 清一色 + 1 根 self-draw at base 100 scores 900', () => {
    const r = score('1111m23m456m789m55m', { ctx: { selfDraw: true }, base: 100 });
    expect(r.patterns).toEqual(['qingYiSe', 'gen', 'ziMo']);
    expect(r.score).toBe(900);
  });
});

describe('patternFan', () => {
  it.each([
    ['1111m23m456m789m55m', { gangShangHua: true }],
    ['111m444m333s777s55s', { haiDi: true }],
    ['1111m22m33m44s55s66s', {}],
    ['11m22m33m44m55s66s77s', { qiangGang: true }],
  ])('adds up to the raw fan for %s', (hand, ctx) => {
    const r = score(hand, { ctx, rules: withRules({ maxFan: 13 }) });
    expect(r.patterns.reduce((sum, p) => sum + (patternFan(p) ?? 0), 0)).toBe(r.rawFan);
  });

  it('leaves self-draw and heavenly / earthly hands to the rules', () => {
    expect(patternFan('ziMo')).toBeNull();
    expect(patternFan('tianHu')).toBeNull();
  });
});

describe('optional Chengdu patterns (幺九将对, 门清中张, 夹心五)', () => {
  const extras = withRules({
    maxFan: 13,
    enabledPatterns: { ...DEFAULT_RULESET.enabledPatterns, yaoJiu: true, menQing: true, zhongZhang: true, jiaXinWu: true },
  });
  const yaoJiuOnly = withRules({ maxFan: 13, enabledPatterns: { ...DEFAULT_RULESET.enabledPatterns, yaoJiu: true } });

  it('are all off by default', () => {
    expect(score('123m789m111s789s99s').patterns).toEqual(['pingHu']);
    expect(score('234m456m678m234s55s').patterns).toEqual(['pingHu']);
  });

  it('带幺九: every group holds a 1 or 9 (2 fan); 清幺九 in one suit (4 fan)', () => {
    expect(score('123m789m111s789s99s', { rules: yaoJiuOnly })).toMatchObject({ patterns: ['daiYaoJiu'], fan: 2 });
    expect(score('123m789m789m111m99m', { rules: yaoJiuOnly }).patterns[0]).toBe('qingYaoJiu');
    // A pong of a middle tile, or a middle pair, breaks it.
    expect(score('123m789m789s99s', { rules: yaoJiuOnly, melds: [pong('5s')] }).patterns[0]).toBe('pingHu');
    expect(score('123m789m111s789s55s', { rules: yaoJiuOnly }).patterns[0]).toBe('pingHu');
    // Exposed 1 / 9 pongs count.
    expect(score('123m789m789s99s', { rules: yaoJiuOnly, melds: [pong('1s')] }).patterns[0]).toBe('daiYaoJiu');
  });

  it('将七对: seven pairs of 2, 5 and 8 (4 fan)', () => {
    const r = score('2222m55m88m22s55s88s', { rules: yaoJiuOnly });
    expect(r.patterns).toEqual(['jiangQiDui', 'gen']);
    expect(r.rawFan).toBe(5);
  });

  it('门清 +1 fan without pongs or exposed kongs, but not on top of seven pairs', () => {
    expect(score('123m456m789m234s55s', { rules: extras }).patterns).toEqual(['pingHu', 'menQing']);
    expect(score('123m456m234s55s', { rules: extras, melds: [pong('8m')] }).patterns).not.toContain('menQing');
    expect(score('123m456m234s55s', { rules: extras, melds: [{ type: 'concealedKong', tile: t('8m') }] }).patterns).toContain('menQing');
    expect(score('11m22m33m44m55s66s77s', { rules: extras }).patterns).not.toContain('menQing');
  });

  it('中张 +1 fan with no 1 or 9 anywhere', () => {
    expect(score('234m456m678m234s55s', { rules: extras }).patterns).toContain('zhongZhang');
    expect(score('123m456m678m234s55s', { rules: extras }).patterns).not.toContain('zhongZhang');
  });

  it('夹心五 +1 fan when the winning 5 sits between a 4 and a 6', () => {
    const win = (hand: string, tile: string) => scoreWin(parseTiles(hand), [], NO_SITUATION, extras, 1, t(tile)).patterns;
    expect(win('123m456m789m234s55s', '5m')).toContain('jiaXinWu');
    expect(win('123m456m789m234s55s', '6m')).not.toContain('jiaXinWu');
    expect(win('123m456m789m234s55s', '5s')).not.toContain('jiaXinWu'); // the 5 is the pair
  });

  it('add up to the raw fan', () => {
    const r = scoreWin(parseTiles('234m456m678m345s55s'), [], NO_SITUATION, extras, 1, t('5m'));
    expect(r.patterns).toEqual(['pingHu', 'menQing', 'zhongZhang', 'jiaXinWu']);
    expect(r.patterns.reduce((sum, p) => sum + (patternFan(p) ?? 0), 0)).toBe(r.rawFan);
  });
});

import { describe, expect, it } from 'vitest';
import {
  apply,
  createHand,
  DEFAULT_RULESET,
  IllegalActionError,
  legalActions,
  suitOf,
  viewFor,
  withRules,
  type HandState,
  type Seat,
  type WinRecord,
} from '../src';
import { M, P, run, S, scenario, t } from './helpers';

describe('setup', () => {
  const config = { ruleSet: DEFAULT_RULESET, baseScore: 1, seed: 42, dealer: 2 as Seat };

  it('is deterministic for a seed', () => {
    expect(createHand(config)).toEqual(createHand(config));
    expect(createHand({ ...config, seed: 43 }).wall).not.toEqual(createHand(config).wall);
  });

  it('deals 14 to the dealer and 13 to others from 108 tiles', () => {
    const h = createHand(config);
    expect(h.players.map((p) => p.hand.length)).toEqual([13, 13, 14, 13]);
    expect(h.wall).toHaveLength(108 - 53);
    expect(h.phase).toBe('swap');
    expect(h.swapDirection).not.toBeNull();
  });

  it('skips the swap when Huan San Zhang is disabled', () => {
    const h = createHand({ ...config, ruleSet: withRules({ huanSanZhang: { enabled: false, direction: 'random' } }) });
    expect(h.phase).toBe('dingque');
    expect(h.swapDirection).toBeNull();
  });
});

function swapAll(h: HandState): HandState {
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const suit = legalActions(h, seat).swapSuits![0];
    const tiles = h.players[seat].hand.filter((x) => suitOf(x) === suit).slice(0, 3);
    h = apply(h, { type: 'swap', seat, tiles }).state;
  }
  return h;
}

describe('Huan San Zhang and Dingque', () => {
  it('passes three same-suit tiles counter-clockwise to the next seat', () => {
    let h = createHand({
      ruleSet: withRules({ huanSanZhang: { enabled: true, direction: 'counterClockwise' } }),
      baseScore: 1,
      seed: 7,
      dealer: 0,
    });
    h = swapAll(h);
    expect(h.phase).toBe('dingque');
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(h.players[(seat + 1) % 4].swapReceived).toEqual(h.players[seat].swapSelection);
    }
    expect(h.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
  });

  it('rejects a swap of mixed suits', () => {
    const h = createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed: 7, dealer: 0 });
    const hand = h.players[1].hand;
    const mixed = [hand.find((x) => suitOf(x) === 0)!, hand.find((x) => suitOf(x) === 1)!, hand[5]];
    expect(() => apply(h, { type: 'swap', seat: 1, tiles: mixed })).toThrow(IllegalActionError);
  });

  it('hides void suits until everyone has declared, then starts the dealer turn', () => {
    let h = swapAll(createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed: 9, dealer: 3 }));
    h = apply(h, { type: 'dingque', seat: 0, suit: M }).state;
    expect(viewFor(h, 1).players[0].voidSuit).toBeNull();
    expect(viewFor(h, 0).players[0].voidSuit).toBe(M);
    h = run(h, { type: 'dingque', seat: 1, suit: S }, { type: 'dingque', seat: 2, suit: P }, { type: 'dingque', seat: 3, suit: M }).state;
    expect(h.phase).toBe('play');
    expect(h.stage).toMatchObject({ kind: 'turn', seat: 3, drawn: null });
    expect(viewFor(h, 1).players[0].voidSuit).toBe(M);
  });
});

describe('discarding', () => {
  it('forces void-suit tiles to be discarded first', () => {
    const h = scenario({
      hands: ['123m456m789m11s2p5s', '147m258m369m147s9s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
    });
    expect(legalActions(h, 0).discard).toEqual([t('2p')]);
    expect(() => apply(h, { type: 'discard', seat: 0, tile: t('5s') })).toThrow(IllegalActionError);
  });

  it('allows any discard once the void suit is cleared, when mustDiscardVoidFirst is off', () => {
    const h = scenario({
      hands: ['123m456m789m11s2p5s', '147m258m369m147s9s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
      rules: { mustDiscardVoidFirst: false },
    });
    expect(legalActions(h, 0).discard).toContain(t('5s'));
  });

  it('lets the next player draw from the front when nobody claims', () => {
    const h = scenario({
      hands: ['123m456m789m11s22s5s', '147m258m369m147s9s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
    });
    const r = apply(h, { type: 'discard', seat: 0, tile: t('5s') });
    expect(r.state.stage).toMatchObject({ kind: 'turn', seat: 1, drawn: t('1m'), afterKong: false });
    expect(r.events.map((e) => e.type)).toEqual(['discard', 'draw']);
  });
});

describe('pong', () => {
  const base = () =>
    scenario({
      hands: ['123m456m789m11s22s5s', '55s123m456m789m1s2s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
    });

  it('offers pong and moves the turn to the claimer without a draw', () => {
    let h = apply(base(), { type: 'discard', seat: 0, tile: t('5s') }).state;
    expect(h.stage).toMatchObject({ kind: 'claim', options: { 1: ['pong'] } });
    h = apply(h, { type: 'pong', seat: 1 }).state;
    expect(h.players[1].melds).toEqual([{ type: 'pong', tile: t('5s'), from: 0 }]);
    expect(h.players[0].discards[0].claimed).toBe(true);
    expect(h.stage).toMatchObject({ kind: 'turn', seat: 1, drawn: null, mayDeclare: false });
    expect(legalActions(h, 1).selfKong).toBeUndefined();
  });

  it('passing lets the next player draw', () => {
    const h = run(base(), { type: 'discard', seat: 0, tile: t('5s') }, { type: 'pass', seat: 1 }).state;
    expect(h.stage).toMatchObject({ kind: 'turn', seat: 1, drawn: t('1m') });
  });
});

describe('wins on a discard', () => {
  const multi = (rules = {}) =>
    scenario({
      hands: ['123m456m789m11s22s5s', '123m456m789m34s55s', '123m456m789m111s5s', '147m258m369m147s9s'],
      turn: 0,
      rules,
    });

  it('一炮多响: every winner is paid by the discarder; play continues after the last winner', () => {
    const { state, events } = run(
      multi(),
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'hu', seat: 2 },
      { type: 'hu', seat: 1 },
    );
    expect(state.wins.map((w) => w.seat)).toEqual([1, 2]);
    expect(state.payments).toEqual([
      { from: 0, to: 1, amount: 1, reason: 'win' },
      { from: 0, to: 2, amount: 1, reason: 'win' },
    ]);
    expect(state.stage).toMatchObject({ kind: 'turn', seat: 3 });
    expect(events.filter((e) => e.type === 'win')).toHaveLength(2);
  });

  it('only the first winner in turn order wins when multi-win is off', () => {
    const { state } = run(
      multi({ allowMultiWin: false }),
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'hu', seat: 1 },
      { type: 'hu', seat: 2 },
    );
    expect(state.wins.map((w) => w.seat)).toEqual([1]);
    expect(state.stage).toMatchObject({ kind: 'turn', seat: 2 });
  });

  it('winners leave the hand and take no further actions', () => {
    const { state } = run(multi(), { type: 'discard', seat: 0, tile: t('5s') }, { type: 'hu', seat: 1 }, { type: 'pass', seat: 2 });
    expect(state.players[1].won).not.toBeNull();
    expect(legalActions(state, 1)).toEqual({});
  });
});

describe('过手胡 (passed win restriction)', () => {
  const setup = (rules = {}) =>
    scenario({
      hands: ['123m456m789m11s22s5s', '147m258m369m147s5s', '123m456m789m46s11s', '147m258m369m147s9s'],
      turn: 0,
      rules,
    });

  it('a player who passed a win cannot win on a discard before their next draw', () => {
    const { state } = run(
      setup(),
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'pass', seat: 2 },
      { type: 'discard', seat: 1, tile: t('5s') },
    );
    // No claim stage for seat 2 — it simply draws.
    expect(state.stage).toMatchObject({ kind: 'turn', seat: 2 });
    expect(state.players[2].passedWin).toBe(false);
  });

  it('can be disabled', () => {
    const { state } = run(
      setup({ passedWinRestriction: false }),
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'pass', seat: 2 },
      { type: 'discard', seat: 1, tile: t('5s') },
    );
    expect(state.stage).toMatchObject({ kind: 'claim', options: { 2: ['hu'] } });
  });
});

describe('kongs (刮风下雨)', () => {
  it('direct kong: the discarder pays 2 × base, replacement comes from the back', () => {
    const h = scenario({
      hands: ['123m456m789m11s22s5s', '555s123m456m789m1s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
      base: 10,
    });
    let s = apply(h, { type: 'discard', seat: 0, tile: t('5s') }).state;
    expect(s.stage).toMatchObject({ kind: 'claim', options: { 1: ['pong', 'kong'] } });
    s = apply(s, { type: 'kong', seat: 1 }).state;
    expect(s.payments).toEqual([{ from: 0, to: 1, amount: 20, reason: 'directKong' }]);
    expect(s.stage).toMatchObject({ kind: 'turn', seat: 1, drawn: t('9s'), afterKong: true });
    expect(s.players[1].melds[0]).toEqual({ type: 'directKong', tile: t('5s'), from: 0 });
  });

  it('concealed kong: every active opponent pays 2 × base', () => {
    const h = scenario({
      hands: ['1111m234m567m999m5s', '147m258m369m147s', '147m258m369m147s', '147m258m369m147s'],
      turn: 0,
    });
    expect(legalActions(h, 0).selfKong).toEqual([t('1m')]);
    const s = apply(h, { type: 'selfKong', seat: 0, tile: t('1m') }).state;
    expect(s.payments.map((p) => [p.from, p.to, p.amount])).toEqual([
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 2],
    ]);
    expect(s.stage).toMatchObject({ kind: 'turn', seat: 0, afterKong: true });
  });

  it('no kong when the wall is empty', () => {
    const h = scenario({ hands: ['1111m234m567m999m5s', '', '', ''], turn: 0, wall: '' });
    expect(legalActions(h, 0).selfKong).toBeUndefined();
  });

  const addedKong = () =>
    scenario({
      hands: ['123m456m789m1s5s', '123m456m789m46s11s', '147m258m369m147s', '147m258m369m147s'],
      melds: { 0: [{ type: 'pong', tile: t('5s'), from: 2 }] },
      turn: 0,
      drawn: '5s',
    });

  it('added kong: each active opponent pays 1 × base when nobody robs it', () => {
    let s = apply(addedKong(), { type: 'selfKong', seat: 0, tile: t('5s') }).state;
    expect(s.stage).toMatchObject({ kind: 'robKong', konger: 0, options: { 1: ['hu'] } });
    s = apply(s, { type: 'pass', seat: 1 }).state;
    expect(s.players[0].melds[0].type).toBe('addedKong');
    expect(s.payments.map((p) => [p.from, p.to, p.amount])).toEqual([
      [1, 0, 1],
      [2, 0, 1],
      [3, 0, 1],
    ]);
    expect(s.players[1].passedWin).toBe(true);
  });

  it('抢杠胡: the robber wins with +1 fan, the kong is cancelled and the konger pays', () => {
    const { state, events } = run(addedKong(), { type: 'selfKong', seat: 0, tile: t('5s') }, { type: 'hu', seat: 1 });
    expect(state.wins[0]).toMatchObject({ seat: 1, from: 0, patterns: ['pingHu', 'qiangGang'], score: 2 });
    expect(state.payments).toEqual([{ from: 0, to: 1, amount: 2, reason: 'win' }]);
    expect(state.players[0].melds[0].type).toBe('pong');
    expect(state.kongs).toEqual([]);
    expect(events.map((e) => e.type)).toContain('kongRobbed');
    expect(state.stage).toMatchObject({ kind: 'turn', seat: 2 });
  });
});

describe('杠上花 / 杠上炮 / 呼叫转移', () => {
  it('杠上花: self-draw on the kong replacement tile', () => {
    const h = scenario({
      hands: ['1111m234m567m999m5s', '147m258m369m147s', '147m258m369m147s', '147m258m369m147s'],
      turn: 0,
      wall: '9s5s',
    });
    const { state } = run(h, { type: 'selfKong', seat: 0, tile: t('1m') }, { type: 'zimo', seat: 0 });
    expect(state.wins[0].patterns).toEqual(['pingHu', 'gen', 'gangShangHua', 'ziMo']);
    // 2^2 + self-draw base, from each of three players
    expect(state.wins[0].score).toBe(5);
  });

  it('杠上炮 with call transfer: the kong income moves to the winner', () => {
    const h = scenario({
      hands: ['123m456m789m22s9m9m5s', '555s123m456m789m1s', '123m456m789m23s55s', '147m258m369m147s'],
      turn: 0,
      wall: '1m9s',
    });
    const { state } = run(
      h,
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'kong', seat: 1 },
      { type: 'pass', seat: 2 },
      { type: 'discard', seat: 1, tile: t('1s') },
      { type: 'hu', seat: 2 },
    );
    expect(state.wins[0].patterns).toEqual(['pingHu', 'gangShangPao']);
    expect(state.payments).toEqual([
      { from: 0, to: 1, amount: 2, reason: 'directKong' },
      { from: 1, to: 2, amount: 2, reason: 'win' },
      { from: 1, to: 2, amount: 2, reason: 'callTransfer' },
    ]);
  });

  it('no call transfer when the rule is off', () => {
    const h = scenario({
      hands: ['123m456m789m22s9m9m5s', '555s123m456m789m1s', '123m456m789m23s55s', '147m258m369m147s'],
      turn: 0,
      wall: '1m9s',
      rules: { callTransfer: false },
    });
    const { state } = run(
      h,
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'kong', seat: 1 },
      { type: 'pass', seat: 2 },
      { type: 'discard', seat: 1, tile: t('1s') },
      { type: 'hu', seat: 2 },
    );
    expect(state.payments.map((p) => p.reason)).toEqual(['directKong', 'win']);
  });
});

describe('self-draw', () => {
  it('each active opponent pays; winners who already left do not', () => {
    const h = scenario({
      hands: ['123m456m789m234s55s', '147m258m369m147s', '147m258m369m147s', '147m258m369m147s'],
      turn: 0,
      drawn: '5s',
      base: 100,
    });
    h.players[3].won = { seat: 3 } as WinRecord;
    const { state } = run(h, { type: 'zimo', seat: 0 });
    expect(state.payments.map((p) => [p.from, p.amount])).toEqual([
      [1, 200],
      [2, 200],
    ]);
  });

  it('海底捞月 on the last tile', () => {
    let h = scenario({
      hands: ['123m456m789m11s22s9s', '123m456m789m234s5s', '147m258m369m147s', '147m258m369m147s'],
      turn: 0,
      wall: '5s',
    });
    h = apply(h, { type: 'discard', seat: 0, tile: t('9s') }).state;
    expect(h.stage).toMatchObject({ kind: 'turn', seat: 1, lastTile: true });
    const { state } = run(h, { type: 'zimo', seat: 1 });
    expect(state.wins[0].patterns).toContain('haiDi');
  });

  it('天胡: dealer wins with the opening hand', () => {
    const h = scenario({
      hands: ['123m456m789m234s55s', '147m258m369m147s', '147m258m369m147s', '147m258m369m147s'],
      turn: 0,
      dealer: 0,
    });
    h.players[0].discardCount = 0;
    h.players[0].drawCount = 0;
    const { state } = run(h, { type: 'zimo', seat: 0 });
    expect(state.wins[0].patterns).toContain('tianHu');
    expect(state.wins[0].fan).toBe(4);
  });
});

describe('hand end', () => {
  it('ends when three players have won', () => {
    const h = scenario({
      hands: ['123m456m789m11s22s5s', '123m456m789m34s55s', '123m456m789m111s5s', '123m456m789m46s11s'],
      turn: 0,
    });
    const { state, events } = run(
      h,
      { type: 'discard', seat: 0, tile: t('5s') },
      { type: 'hu', seat: 1 },
      { type: 'hu', seat: 2 },
      { type: 'hu', seat: 3 },
    );
    expect(state.phase).toBe('ended');
    expect(state.result).toMatchObject({ reason: 'threeWon', deltas: [-3, 1, 1, 1] });
    expect(events[events.length - 1].type).toBe('handEnd');
  });

  it('查花猪 / 查大叫 / 退税 when the wall is exhausted (Appendix A.9)', () => {
    const h = scenario({
      hands: ['123m456m789m23s55s9s', '123m456m789m11s5p', '147m258m147s9s', '147m258m369m147s'],
      melds: { 2: [{ type: 'concealedKong', tile: t('9m') }] },
      turn: 0,
      wall: '',
      base: 100,
    });
    const kongPayments = ([0, 1, 3] as Seat[]).map((from) => ({ from, to: 2 as Seat, amount: 200, reason: 'concealedKong' as const }));
    h.kongs = [{ seat: 2, type: 'concealedKong', tile: t('9m'), payments: kongPayments, transferred: false }];
    h.payments = [...kongPayments];
    h.players[3].won = { seat: 3 } as WinRecord;

    const { state } = run(h, { type: 'discard', seat: 0, tile: t('9s') });
    expect(state.result!.reason).toBe('wallExhausted');
    expect(state.result!.drawSettlement).toEqual({ huaZhu: [1], ready: [0], notReady: [2] });
    expect(state.result!.deltas).toEqual([1700, -3200, 1500, 0]);
  });
});

describe('per-seat views', () => {
  it('never exposes other players’ concealed tiles or draws', () => {
    const h = scenario({
      hands: ['123m456m789m11s22s5s', '147m258m369m147s9s', '147m258m369m147s9s', '147m258m369m147s9s'],
      turn: 0,
    });
    const s = apply(h, { type: 'discard', seat: 0, tile: t('5s') }).state;
    const v = viewFor(s, 0);
    expect(v.players[1].hand).toBeNull();
    expect(v.players[1].handCount).toBe(14);
    expect(v.stage).toEqual({ kind: 'turn', seat: 1, drawn: null });
    expect(JSON.stringify(v)).not.toContain('"wall"');
    expect(viewFor(s, 1).stage).toEqual({ kind: 'turn', seat: 1, drawn: t('1m') });
  });
});

/**
 * Sichuan Xuezhan Daodi hand engine (PRD Appendix A).
 *
 * Pure and deterministic: `apply(state, action)` returns a new state plus the
 * events that happened. No I/O, clocks or Math.random() — timers live in the
 * server room layer, which submits ordinary actions (e.g. `pass`) on timeout.
 */
import { hasVoidTiles, isWinningHand, winningTiles } from './hands';
import { createRng, randomInt, shuffle } from './rng';
import type { SwapDirection } from './ruleset';
import { NO_SITUATION, scoreWin, type WinContext } from './scoring';
import { countOf, fullTileSet, removeTiles, sortTiles, SUITS, suitOf, type Suit, type Tile } from './tiles';
import {
  SEATS,
  type Action,
  type ClaimOption,
  type DrawSettlementInfo,
  type GameEvent,
  type HandConfig,
  type HandResult,
  type HandState,
  type KongRecord,
  type LegalActions,
  type Payment,
  type PaymentReason,
  type PlayerState,
  type Seat,
  type WinRecord,
} from './types';

export class IllegalActionError extends Error {
  constructor(public readonly action: Action, reason: string) {
    super(`Illegal action ${JSON.stringify(action)}: ${reason}`);
  }
}

export interface ApplyResult {
  state: HandState;
  events: GameEvent[];
}

const SWAP_DIRECTIONS: SwapDirection[] = ['clockwise', 'counterClockwise', 'opposite'];
/** Seat offset that receives a player's swap tiles. Turn order is counter-clockwise. */
const SWAP_OFFSET: Record<SwapDirection, number> = { counterClockwise: 1, opposite: 2, clockwise: 3 };

const HAND_SIZE = 13;

function emptyPlayer(): PlayerState {
  return {
    hand: [],
    melds: [],
    discards: [],
    voidSuit: null,
    swapSelection: null,
    swapReceived: null,
    won: null,
    passedWin: false,
    drawCount: 0,
    discardCount: 0,
  };
}

export const nextSeat = (seat: Seat, step = 1): Seat => ((seat + step) % 4) as Seat;

/** The three other seats in turn order starting after `seat`. */
export const seatsAfter = (seat: Seat): Seat[] => [nextSeat(seat, 1), nextSeat(seat, 2), nextSeat(seat, 3)];

/** Still in the hand: has not won yet, or anyone at all in 血流成河 (winners play on). */
export const isActive = (s: HandState, seat: Seat): boolean => s.ruleSet.xueliu || s.players[seat].won === null;

/** 血流成河: a player who has won plays on with a locked hand. */
const lockedAfterWin = (s: HandState, seat: Seat): boolean => s.ruleSet.xueliu && s.players[seat].won !== null;
export const activeSeats = (s: HandState): Seat[] => SEATS.filter((seat) => isActive(s, seat));

export function createHand(config: HandConfig): HandState {
  const rng = createRng(config.seed);
  const wall = shuffle(fullTileSet(), rng);
  const players = [emptyPlayer(), emptyPlayer(), emptyPlayer(), emptyPlayer()] as HandState['players'];

  for (let i = 0; i < 4; i++) {
    const seat = nextSeat(config.dealer, i);
    players[seat].hand = wall.splice(0, HAND_SIZE);
  }
  players[config.dealer].hand.push(wall.shift()!);
  for (const p of players) p.hand = sortTiles(p.hand);

  const swap = config.ruleSet.huanSanZhang;
  let swapDirection: SwapDirection | null = null;
  if (swap.enabled) {
    swapDirection = swap.direction === 'random' ? SWAP_DIRECTIONS[randomInt(rng, 3)] : swap.direction;
  }

  return {
    ...config,
    phase: swap.enabled ? 'swap' : 'dingque',
    stage: { kind: 'none' },
    wall,
    players,
    swapDirection,
    payments: [],
    kongs: [],
    wins: [],
    anyClaim: false,
    actionCount: 0,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

function canClaimWin(s: HandState, seat: Seat, tile: Tile): boolean {
  const p = s.players[seat];
  if (s.ruleSet.passedWinRestriction && p.passedWin) return false;
  return isWinningHand([...p.hand, tile], p.melds, p.voidSuit);
}

function selfKongTiles(s: HandState, seat: Seat, drawn: Tile | null): Tile[] {
  if (s.wall.length === 0) return [];
  const p = s.players[seat];
  const tiles = new Set<Tile>();
  for (const t of new Set(p.hand)) {
    if (suitOf(t) !== p.voidSuit && countOf(p.hand, t) === 4) tiles.add(t);
  }
  for (const m of p.melds) {
    if (m.type !== 'pong' || !p.hand.includes(m.tile)) continue;
    if (s.ruleSet.allowDelayedAddedKong || m.tile === drawn) tiles.add(m.tile);
  }
  return [...tiles].sort((a, b) => a - b);
}

export function legalActions(s: HandState, seat: Seat): LegalActions {
  const p = s.players[seat];
  switch (s.phase) {
    case 'swap':
      if (p.swapSelection) return {};
      return { swapSuits: SUITS.filter((suit) => p.hand.filter((t) => suitOf(t) === suit).length >= 3) };
    case 'dingque':
      return p.voidSuit === null ? { dingque: true } : {};
    case 'ended':
      return {};
  }

  const stage = s.stage;
  if (stage.kind === 'turn') {
    if (stage.seat !== seat) return {};
    if (lockedAfterWin(s, seat)) {
      // Locked hand: throw what was drawn, unless it wins again.
      const legal: LegalActions = { discard: stage.drawn !== null ? [stage.drawn] : [...new Set(p.hand)].sort((a, b) => a - b) };
      if (stage.mayDeclare && isWinningHand(p.hand, p.melds, p.voidSuit)) legal.zimo = true;
      return legal;
    }
    let discard = [...new Set(p.hand)];
    if (s.ruleSet.mustDiscardVoidFirst && hasVoidTiles(p.hand, p.voidSuit)) {
      discard = discard.filter((t) => suitOf(t) === p.voidSuit);
    }
    const legal: LegalActions = { discard: discard.sort((a, b) => a - b) };
    if (stage.mayDeclare) {
      if (isWinningHand(p.hand, p.melds, p.voidSuit)) legal.zimo = true;
      const kongs = selfKongTiles(s, seat, stage.drawn);
      if (kongs.length) legal.selfKong = kongs;
    }
    return legal;
  }
  if (stage.kind === 'claim' || stage.kind === 'robKong') {
    const options = stage.options[seat];
    if (!options || stage.responses[seat] !== undefined) return {};
    const legal: LegalActions = { pass: true };
    for (const o of options) legal[o] = true;
    return legal;
  }
  return {};
}

export function isLegal(s: HandState, action: Action): boolean {
  if (!SEATS.includes(action.seat)) return false;
  const legal = legalActions(s, action.seat);
  switch (action.type) {
    case 'swap': {
      const { tiles } = action;
      if (!legal.swapSuits || !Array.isArray(tiles) || tiles.length !== 3) return false;
      const suit = suitOf(tiles[0]);
      if (!legal.swapSuits.includes(suit) || tiles.some((t) => suitOf(t) !== suit)) return false;
      try {
        removeTiles(s.players[action.seat].hand, tiles);
        return true;
      } catch {
        return false;
      }
    }
    case 'dingque':
      return !!legal.dingque && SUITS.includes(action.suit);
    case 'discard':
      return !!legal.discard?.includes(action.tile);
    case 'selfKong':
      return !!legal.selfKong?.includes(action.tile);
    case 'zimo':
      return !!legal.zimo;
    case 'hu':
    case 'pong':
    case 'kong':
    case 'pass':
      return !!legal[action.type];
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** Mutable working context for one `apply` call (operates on a private copy). */
interface Ctx {
  s: HandState;
  events: GameEvent[];
}

export function apply(state: HandState, action: Action): ApplyResult {
  if (!isLegal(state, action)) throw new IllegalActionError(action, `not legal in phase ${state.phase}`);
  const ctx: Ctx = { s: JSON.parse(JSON.stringify(state)) as HandState, events: [] };
  ctx.s.actionCount++;

  switch (action.type) {
    case 'swap':
      applySwap(ctx, action.seat, action.tiles);
      break;
    case 'dingque':
      applyDingque(ctx, action.seat, action.suit);
      break;
    case 'discard':
      applyDiscard(ctx, action.seat, action.tile);
      break;
    case 'selfKong':
      applySelfKong(ctx, action.seat, action.tile);
      break;
    case 'zimo':
      applyZimo(ctx, action.seat);
      break;
    case 'hu':
    case 'pong':
    case 'kong':
    case 'pass':
      applyResponse(ctx, action.seat, action.type);
      break;
  }
  return { state: ctx.s, events: ctx.events };
}

function applySwap({ s, events }: Ctx, seat: Seat, tiles: Tile[]): void {
  const p = s.players[seat];
  p.hand = removeTiles(p.hand, tiles);
  p.swapSelection = sortTiles(tiles);
  events.push({ type: 'swapSelected', seat });
  if (s.players.some((x) => x.swapSelection === null)) return;

  const direction = s.swapDirection!;
  const received: Partial<Record<Seat, Tile[]>> = {};
  for (const from of SEATS) {
    const to = nextSeat(from, SWAP_OFFSET[direction]);
    const given = s.players[from].swapSelection!;
    s.players[to].hand = sortTiles([...s.players[to].hand, ...given]);
    s.players[to].swapReceived = [...given];
    received[to] = [...given];
  }
  s.phase = 'dingque';
  events.push({ type: 'swapDone', direction, received });
}

function applyDingque({ s, events }: Ctx, seat: Seat, suit: Suit): void {
  s.players[seat].voidSuit = suit;
  events.push({ type: 'dingqueDeclared', seat });
  if (s.players.some((p) => p.voidSuit === null)) return;

  s.phase = 'play';
  s.stage = { kind: 'turn', seat: s.dealer, drawn: null, afterKong: false, lastTile: false, mayDeclare: true };
  events.push({ type: 'dingqueRevealed', voids: s.players.map((p) => p.voidSuit!) });
}

function applyDiscard(ctx: Ctx, seat: Seat, tile: Tile): void {
  const { s, events } = ctx;
  const stage = s.stage;
  if (stage.kind !== 'turn') throw new Error('unreachable');
  const p = s.players[seat];
  p.hand = removeTiles(p.hand, [tile]);
  p.discards.push({ tile, claimed: false });
  p.discardCount++;
  events.push({ type: 'discard', seat, tile });

  const options: Partial<Record<Seat, ClaimOption[]>> = {};
  for (const other of seatsAfter(seat)) {
    if (!isActive(s, other)) continue;
    const q = s.players[other];
    const opts: ClaimOption[] = [];
    if (canClaimWin(s, other, tile)) opts.push('hu');
    if (suitOf(tile) !== q.voidSuit && !lockedAfterWin(s, other)) {
      const n = countOf(q.hand, tile);
      if (n >= 2) opts.push('pong');
      if (n >= 3 && s.wall.length > 0) opts.push('kong');
    }
    if (opts.length) options[other] = opts;
  }

  if (Object.keys(options).length) {
    s.stage = { kind: 'claim', discarder: seat, tile, afterKong: stage.afterKong, options, responses: {} };
  } else {
    drawNext(ctx, seat);
  }
}

function applySelfKong(ctx: Ctx, seat: Seat, tile: Tile): void {
  const { s } = ctx;
  const p = s.players[seat];

  if (countOf(p.hand, tile) === 4) {
    p.hand = removeTiles(p.hand, [tile, tile, tile, tile]);
    p.melds.push({ type: 'concealedKong', tile });
    completeKong(ctx, seat, 'concealedKong', tile);
    return;
  }

  // Added kong: the tile leaves the hand now; other players may rob it (抢杠胡).
  p.hand = removeTiles(p.hand, [tile]);
  const options: Partial<Record<Seat, ClaimOption[]>> = {};
  if (s.ruleSet.enabledPatterns.qiangGang) {
    for (const other of seatsAfter(seat)) {
      if (isActive(s, other) && canClaimWin(s, other, tile)) options[other] = ['hu'];
    }
  }
  if (Object.keys(options).length) {
    s.stage = { kind: 'robKong', konger: seat, tile, options, responses: {} };
  } else {
    completeAddedKong(ctx, seat, tile);
  }
}

function completeAddedKong(ctx: Ctx, seat: Seat, tile: Tile): void {
  const meld = ctx.s.players[seat].melds.find((m) => m.type === 'pong' && m.tile === tile)!;
  meld.type = 'addedKong';
  completeKong(ctx, seat, 'addedKong', tile);
}

/** Kong payments (刮风下雨), then the replacement draw. */
function completeKong(ctx: Ctx, seat: Seat, type: KongRecord['type'], tile: Tile, from?: Seat): void {
  const { s, events } = ctx;
  const base = s.baseScore;
  const payments: Payment[] = [];
  if (type === 'directKong') {
    payments.push(pay(s, from!, seat, 2 * base, 'directKong'));
  } else {
    const amount = type === 'concealedKong' ? 2 * base : base;
    for (const other of seatsAfter(seat)) {
      if (isActive(s, other)) payments.push(pay(s, other, seat, amount, type));
    }
  }
  s.kongs.push({ seat, type, tile, payments, transferred: false });
  s.anyClaim = true;
  events.push({ type: 'kong', seat, kongType: type, tile, from, payments });
  drawTile(ctx, seat, true);
}

function applyZimo(ctx: Ctx, seat: Seat): void {
  const { s } = ctx;
  const stage = s.stage;
  if (stage.kind !== 'turn') throw new Error('unreachable');
  const p = s.players[seat];
  const opening = stage.drawn === null && p.discardCount === 0 && p.melds.length === 0;
  const winCtx: WinContext = {
    ...NO_SITUATION,
    selfDraw: true,
    gangShangHua: stage.afterKong,
    haiDi: stage.lastTile,
    tianHu: opening && seat === s.dealer,
    diHu:
      seat !== s.dealer &&
      !stage.afterKong &&
      p.drawCount === 1 &&
      p.discardCount === 0 &&
      p.melds.length === 0 &&
      !s.anyClaim,
  };
  declareWin(ctx, seat, stage.drawn ?? p.hand[p.hand.length - 1], [...p.hand], winCtx, undefined);
  if (!endIfDone(ctx)) drawNext(ctx, seat);
}

function applyResponse(ctx: Ctx, seat: Seat, response: 'hu' | 'pong' | 'kong' | 'pass'): void {
  const { s, events } = ctx;
  const stage = s.stage;
  if (stage.kind !== 'claim' && stage.kind !== 'robKong') throw new Error('unreachable');
  stage.responses[seat] = response;
  if (response === 'pass') events.push({ type: 'pass', seat });

  const pending = (Object.keys(stage.options).map(Number) as Seat[]).some((o) => stage.responses[o] === undefined);
  if (pending) return;
  if (stage.kind === 'claim') resolveClaim(ctx);
  else resolveRobKong(ctx);
}

/** Seats that answered "hu", in turn order from `source`, honoring allowMultiWin. */
function winnersFrom(s: HandState, source: Seat, responses: Partial<Record<Seat, string>>): Seat[] {
  const winners = seatsAfter(source).filter((o) => responses[o] === 'hu');
  return s.ruleSet.allowMultiWin ? winners : winners.slice(0, 1);
}

/** 过手胡: anyone who could have won on this tile but didn't is locked until their next draw. */
function markPassedWins(s: HandState, stage: { options: Partial<Record<Seat, ClaimOption[]>>; responses: Partial<Record<Seat, string>> }): void {
  if (!s.ruleSet.passedWinRestriction) return;
  for (const o of Object.keys(stage.options).map(Number) as Seat[]) {
    if (stage.options[o]!.includes('hu') && stage.responses[o] !== 'hu') s.players[o].passedWin = true;
  }
}

function markLastDiscardClaimed(s: HandState, seat: Seat): void {
  const discards = s.players[seat].discards;
  discards[discards.length - 1].claimed = true;
}

function resolveClaim(ctx: Ctx): void {
  const { s, events } = ctx;
  const stage = s.stage;
  if (stage.kind !== 'claim') throw new Error('unreachable');
  const { discarder, tile, afterKong, responses } = stage;
  markPassedWins(s, stage);

  const winners = winnersFrom(s, discarder, responses);
  if (winners.length) {
    markLastDiscardClaimed(s, discarder);
    for (const w of winners) {
      const winCtx: WinContext = { ...NO_SITUATION, gangShangPao: afterKong };
      declareWin(ctx, w, tile, [...s.players[w].hand, tile], winCtx, discarder);
    }
    if (afterKong && s.ruleSet.callTransfer) transferKongIncome(s, discarder, winners);
    if (!endIfDone(ctx)) drawNext(ctx, winners[winners.length - 1]);
    return;
  }

  const kongSeat = seatsAfter(discarder).find((o) => responses[o] === 'kong');
  if (kongSeat !== undefined) {
    markLastDiscardClaimed(s, discarder);
    const p = s.players[kongSeat];
    p.hand = removeTiles(p.hand, [tile, tile, tile]);
    p.melds.push({ type: 'directKong', tile, from: discarder });
    completeKong(ctx, kongSeat, 'directKong', tile, discarder);
    return;
  }

  const pongSeat = seatsAfter(discarder).find((o) => responses[o] === 'pong');
  if (pongSeat !== undefined) {
    markLastDiscardClaimed(s, discarder);
    const p = s.players[pongSeat];
    p.hand = removeTiles(p.hand, [tile, tile]);
    p.melds.push({ type: 'pong', tile, from: discarder });
    s.anyClaim = true;
    s.stage = { kind: 'turn', seat: pongSeat, drawn: null, afterKong: false, lastTile: false, mayDeclare: false };
    events.push({ type: 'pong', seat: pongSeat, from: discarder, tile });
    return;
  }

  drawNext(ctx, discarder);
}

function resolveRobKong(ctx: Ctx): void {
  const { s, events } = ctx;
  const stage = s.stage;
  if (stage.kind !== 'robKong') throw new Error('unreachable');
  const { konger, tile, responses } = stage;
  markPassedWins(s, stage);

  const winners = winnersFrom(s, konger, responses);
  if (!winners.length) {
    completeAddedKong(ctx, konger, tile);
    return;
  }
  events.push({ type: 'kongRobbed', seat: konger, tile });
  for (const w of winners) {
    const winCtx: WinContext = { ...NO_SITUATION, qiangGang: true };
    declareWin(ctx, w, tile, [...s.players[w].hand, tile], winCtx, konger);
  }
  if (!endIfDone(ctx)) drawNext(ctx, winners[winners.length - 1]);
}

/** 呼叫转移: the discarder's income from the kong just made goes to the winner(s). */
function transferKongIncome(s: HandState, discarder: Seat, winners: Seat[]): void {
  const kong = [...s.kongs].reverse().find((k) => k.seat === discarder && !k.transferred);
  if (!kong) return;
  kong.transferred = true;
  const total = kong.payments.reduce((sum, p) => sum + p.amount, 0);
  const share = Math.floor(total / winners.length);
  winners.forEach((w, i) => {
    const amount = share + (i === 0 ? total - share * winners.length : 0);
    if (amount > 0) pay(s, discarder, w, amount, 'callTransfer');
  });
}

function declareWin(ctx: Ctx, seat: Seat, tile: Tile, finalHand: Tile[], winCtx: WinContext, from: Seat | undefined): void {
  const { s, events } = ctx;
  const p = s.players[seat];
  const hand = sortTiles(finalHand);
  const fan = scoreWin(hand, p.melds, winCtx, s.ruleSet, s.baseScore);

  const payers = from === undefined ? seatsAfter(seat).filter((o) => isActive(s, o)) : [from];
  const payments = payers.map((payer) => pay(s, payer, seat, fan.score, 'win'));

  const record: WinRecord = {
    seat,
    tile,
    from,
    selfDraw: winCtx.selfDraw,
    fan: fan.fan,
    patterns: fan.patterns,
    score: fan.score,
    order: s.wins.length,
    hand,
    melds: p.melds,
  };
  // 血战: the winner's hand is final. 血流: the winning tile is set aside and the 13-tile hand plays on, locked.
  if (!s.ruleSet.xueliu) p.hand = hand;
  else if (finalHand.length > p.hand.length) p.hand = sortTiles(p.hand);
  else p.hand = removeTiles(hand, [tile]);
  p.won = record;
  s.wins.push(record);
  events.push({ type: 'win', win: record, payments });
}

function pay(s: HandState, from: Seat, to: Seat, amount: number, reason: PaymentReason): Payment {
  const payment: Payment = { from, to, amount, reason };
  s.payments.push(payment);
  return payment;
}

/** Next active player after `after` draws; ends the hand if the wall is empty. */
function drawNext(ctx: Ctx, after: Seat): void {
  const next = seatsAfter(after).find((o) => isActive(ctx.s, o));
  if (next === undefined) throw new Error('No active player to draw');
  if (ctx.s.wall.length === 0) {
    settleExhaustedWall(ctx);
    return;
  }
  drawTile(ctx, next, false);
}

function drawTile({ s, events }: Ctx, seat: Seat, fromBack: boolean): void {
  const tile = fromBack ? s.wall.pop()! : s.wall.shift()!;
  const p = s.players[seat];
  p.hand = sortTiles([...p.hand, tile]);
  p.drawCount++;
  p.passedWin = false;
  s.stage = { kind: 'turn', seat, drawn: tile, afterKong: fromBack, lastTile: s.wall.length === 0, mayDeclare: true };
  events.push({ type: 'draw', seat, tile, fromBack });
}

function endIfDone(ctx: Ctx): boolean {
  if (activeSeats(ctx.s).length > 1) return false;
  finishHand(ctx, 'threeWon');
  return true;
}

/** Best score a ready (tenpai) hand could make, for 查大叫. */
export function maxPotentialScore(s: HandState, seat: Seat): number {
  const p = s.players[seat];
  let best = 0;
  for (const t of winningTiles(p.hand, p.melds, p.voidSuit)) {
    best = Math.max(best, scoreWin([...p.hand, t], p.melds, NO_SITUATION, s.ruleSet, s.baseScore).score);
  }
  return best;
}

/** 流局: 查花猪, 查大叫 and 退税 among players who have not won (Appendix A.9). */
function settleExhaustedWall(ctx: Ctx): void {
  const { s } = ctx;
  const rules = s.ruleSet.drawSettlement;
  // 血流成河: winners are done with 查叫; only those who never won are checked.
  const active = activeSeats(s).filter((seat) => !s.ruleSet.xueliu || s.players[seat].won === null);
  const huaZhu = rules.checkHuaZhu
    ? active.filter((seat) => hasVoidTiles(s.players[seat].hand, s.players[seat].voidSuit))
    : [];
  const rest = active.filter((seat) => !huaZhu.includes(seat));
  const ready = rest.filter((seat) => {
    const p = s.players[seat];
    return winningTiles(p.hand, p.melds, p.voidSuit).length > 0;
  });
  const notReady = rest.filter((seat) => !ready.includes(seat));

  const capScore = s.baseScore * 2 ** s.ruleSet.maxFan;
  for (const h of huaZhu) {
    for (const other of rest) pay(s, h, other, capScore, 'huaZhu');
  }
  if (rules.checkDaJiao) {
    for (const n of notReady) {
      for (const r of ready) pay(s, n, r, maxPotentialScore(s, r), 'daJiao');
    }
  }
  if (rules.kongRefund) {
    for (const seat of [...huaZhu, ...notReady]) {
      for (const kong of s.kongs) {
        if (kong.seat !== seat || kong.transferred) continue;
        for (const p of kong.payments) pay(s, seat, p.from, p.amount, 'kongRefund');
      }
    }
  }
  finishHand(ctx, 'wallExhausted', { huaZhu, ready, notReady });
}

function finishHand(ctx: Ctx, reason: HandResult['reason'], drawSettlement?: DrawSettlementInfo): void {
  const { s, events } = ctx;
  const result: HandResult = {
    reason,
    deltas: runningScores(s),
    wins: s.wins,
    payments: s.payments,
    drawSettlement,
  };
  s.phase = 'ended';
  s.stage = { kind: 'none' };
  s.result = result;
  events.push({ type: 'handEnd', result });
}

/** Net score per seat from all payments so far this hand. */
export function runningScores(s: HandState): [number, number, number, number] {
  const deltas: [number, number, number, number] = [0, 0, 0, 0];
  for (const p of s.payments) {
    deltas[p.from] -= p.amount;
    deltas[p.to] += p.amount;
  }
  return deltas;
}

/** Rebuilds a hand from its log: same seed + same actions = same hand (PRD §40). */
export function replayHand(config: HandConfig, actions: readonly Action[]): HandState {
  let state = createHand(config);
  for (const action of actions) state = apply(state, action).state;
  return state;
}

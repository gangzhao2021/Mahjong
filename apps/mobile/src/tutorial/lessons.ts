/**
 * Beginner tutorial (PRD §27): short guided lessons on scripted deals,
 * played on the real table UI with the shared rules engine running locally.
 * No server, no LLM, no coins.
 */
import { customHand, suitOf, type Action, type HandState, type LegalActions, type Seat, type Suit } from '@mahjong/engine';
import type { DistributiveOmit } from '@mahjong/protocol';

export type Intent = DistributiveOmit<Action, 'seat'>;

export interface LessonStep {
  /** Instruction for the player. */
  text: string;
  /** The action this step waits for; absent = an explanation with a "下一步" button. */
  expect?: (action: Intent, state: HandState) => boolean;
  /** Gentle nudge when the player does something else. */
  hint?: string;
  /** After the step: let the other players move until the player has something to do. */
  thenAutoPlay?: boolean;
  /** Lines the characters say when this step begins. */
  say?: { seat: Seat; text: string }[];
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  setup(): HandState;
  /** Let the other players move before the first step. */
  autoPlayFirst?: boolean;
  steps: LessonStep[];
}

const M: Suit = 0;
const S: Suit = 1;
const P: Suit = 2;
/** Opponents in every lesson; their hands never interfere with the script. */
const OPPONENT = '147m258m369m1478s';
const ALL_DOTS_VOID: [Suit, Suit, Suit, Suit] = [P, P, P, P];
const FILLER = '123456789m123456789s';

const tile = (notation: string) => {
  const rank = Number(notation[0]);
  return ['m', 's', 'p'].indexOf(notation[1]) * 9 + rank - 1;
};
const isDiscardOf = (t: string) => (a: Intent) => a.type === 'discard' && a.tile === tile(t);

/** The suit the player holds fewest of — the natural dingque choice. */
export function fewestSuit(state: HandState, seat: Seat = 0): Suit {
  const hand = state.players[seat].hand;
  const counts = [M, S, P].map((s) => hand.filter((t) => suitOf(t) === s).length);
  return counts.indexOf(Math.min(...counts)) as Suit;
}

export const LESSONS: Lesson[] = [
  {
    id: 'basics',
    title: '1. 摸牌与出牌',
    summary: '牌的种类、手牌、怎么出牌',
    setup: () =>
      customHand({
        hands: ['123m456m789m11s23s9s', OPPONENT, OPPONENT, OPPONENT],
        voids: ALL_DOTS_VOID,
        wall: `9m6s8s7s${FILLER}`,
        turn: 0,
        drawn: '9s',
      }),
    steps: [
      {
        text: '欢迎来到四川麻将！只用万、条、筒三种花色，共 108 张。四川麻将不能「吃」，只能碰、杠、胡。',
        say: [{ seat: 1, text: '新手？别紧张，叔带你。' }],
      },
      { text: '最下面一排是你的手牌，最右边隔开的那张是刚摸到的。轮到你时：先摸一张，再打一张。' },
      {
        text: '这张 9条 和其他牌都连不上。双击它，或者按住向上一滑，把它打出去。',
        expect: isDiscardOf('9s'),
        hint: '先打 9条：双击它，或按住向上滑。',
        thenAutoPlay: true,
      },
      { text: '大家按逆时针轮流摸牌、出牌，打出的牌放在桌子中间。现在又轮到你了。' },
      { text: '目标：凑成 4 组（三张一样，或同花色三张相连）再加 1 对「将」，就能胡牌。你现在已经很接近了！' },
    ],
  },
  {
    id: 'swap',
    title: '2. 换三张与定缺',
    summary: '开局换牌、选缺门、先打缺门',
    setup: () =>
      customHand({
        hands: ['1234567m1234s258p', OPPONENT, OPPONENT, '12m45s123456789p'],
        wall: FILLER + FILLER,
        phase: 'swap',
        dealer: 0,
        swapDirection: 'counterClockwise',
      }),
    steps: [
      { text: '每局开始先「换三张」：每人选 3 张同一花色的牌，按方向交换给别人。一般换掉最用不上的那门。' },
      {
        text: '你的筒子最少。点选 2筒、5筒、8筒，再点「确认换牌」。',
        expect: (a) => a.type === 'swap' && a.tiles.every((t) => suitOf(t) === P),
        hint: '要选同一花色的 3 张：点 2筒、5筒、8筒，再点「确认换牌」。',
        thenAutoPlay: true,
      },
      { text: '这局是逆时针换牌：你的牌给了右手边，左手边阿强换给你 1筒、2筒、3筒。' },
      {
        text: '接下来「定缺」：选一门这局不要的花色，不能用它胡牌。你的筒子最少，选「缺筒」。',
        expect: (a, s) => a.type === 'dingque' && a.suit === fewestSuit(s),
        hint: '选你最少的那门花色。',
        thenAutoPlay: true,
      },
      {
        text: '缺门的牌要先打完。你手里还有 3 张筒子，先打一张（其他牌现在是灰的，不能打）。',
        expect: (a) => a.type === 'discard' && suitOf(a.tile) === P,
        hint: '先打筒子。',
      },
      { text: '手里还留着缺门的牌就不能胡。如果流局时还拿着缺门牌，叫「花猪」，要赔给别人！' },
    ],
  },
  {
    id: 'pong',
    title: '3. 碰与杠',
    summary: '碰别人的牌、暗杠、刮风下雨',
    setup: () =>
      customHand({
        hands: ['55s999m123m46m78s1s', OPPONENT, OPPONENT, `${OPPONENT}5s`],
        voids: ALL_DOTS_VOID,
        // Draws: three opponents, then the 4th 9万 for you; 5万 is the kong replacement at the back.
        wall: `2s7m3s9m${FILLER}5m`,
        turn: 3,
        drawn: '5s',
      }),
    autoPlayFirst: true,
    steps: [
      {
        text: '左手边阿强打出一张 5条，你手里正好有一对。别人打出的牌，你有一对一样的就能「碰」。点「碰」！',
        expect: (a) => a.type === 'pong',
        hint: '点「碰」把 5条 拿过来。',
        say: [{ seat: 3, text: '这张你也要？拿去拿去。' }],
      },
      {
        text: '碰完不用摸牌，直接打一张。把用不上的 1条 打出去。',
        expect: isDiscardOf('1s'),
        hint: '打 1条。',
        thenAutoPlay: true,
      },
      {
        text: '你摸到了第 4 张 9万！手里有 4 张一样的可以「暗杠」：点「杠 9万」。暗杠时其他每家付你 2 倍底分，这叫「下雨」。',
        expect: (a) => a.type === 'selfKong' && a.tile === tile('9m'),
        hint: '点「杠 9万」。',
      },
      {
        text: '杠完从牌墙尾巴补摸一张（你补到了 5万），然后照常出一张。',
        expect: (a) => a.type === 'discard',
        hint: '随便打一张。',
      },
      { text: '别人打出的牌你有三张一样的，也能直接杠（明杠，打牌的人付 2 倍）；碰过的牌再摸到第 4 张可以补杠（每家付 1 倍）。杠完马上收钱，叫「刮风下雨」。' },
    ],
  },
  {
    id: 'win',
    title: '4. 胡牌与番数',
    summary: '点炮胡、番数怎么算、血战到底',
    setup: () =>
      customHand({
        hands: ['123m456m789m23s55s', OPPONENT, OPPONENT, `${OPPONENT}4s`],
        voids: ALL_DOTS_VOID,
        wall: FILLER,
        turn: 3,
        drawn: '4s',
      }),
    autoPlayFirst: true,
    steps: [
      {
        text: '你的牌是 3 组 + 23条 + 一对将，只差 1条 或 4条。阿强刚好打出 4条——点「胡」！',
        expect: (a) => a.type === 'hu',
        hint: '点「胡」。',
        say: [{ seat: 3, text: '这张总安全吧……' }],
      },
      {
        text: '胡了！这叫「点炮」：打出这张牌的人一个人付钱。你这手是「平胡」，0 番，得 1 倍底分。',
        say: [{ seat: 3, text: '哎呀，点炮了……' }],
      },
      { text: '番数越大赢得越多，每多 1 番翻一倍：对对胡 1 番，清一色、七对 2 番，龙七对 3 番；每有一个「根」（4 张一样的）再加 1 番。默认 4 番封顶。' },
      { text: '这就是「血战到底」：你胡了之后退出这一局，其他三家继续打，直到三家胡牌或牌摸完。正式牌局里可以点「跳过，直接看结算」。' },
    ],
  },
  {
    id: 'zimo',
    title: '5. 自摸与流局',
    summary: '自摸、查花猪、查大叫',
    setup: () =>
      customHand({
        hands: ['123m456m789m23s4s55s', OPPONENT, OPPONENT, OPPONENT],
        voids: ALL_DOTS_VOID,
        wall: FILLER,
        turn: 0,
        drawn: '4s',
      }),
    steps: [
      {
        text: '你自己摸到了要的 4条！点「自摸」。自摸时其他每家都要付钱，默认每家还多给 1 倍底分。',
        expect: (a) => a.type === 'zimo',
        hint: '点「自摸」。',
      },
      { text: '如果牌摸完还没人胡（流局），要「查花猪」和「查大叫」：花猪赔给其他人；没听牌的人赔给听牌的人，还要把收过的杠钱退回去（退税）。' },
    ],
  },
  {
    id: 'table',
    title: '6. 计时、托管、聊天和金币',
    summary: '倒计时与托管、AI 牌友、金币',
    setup: () =>
      customHand({
        hands: ['123m456m789m11s23s9s', OPPONENT, OPPONENT, OPPONENT],
        voids: ALL_DOTS_VOID,
        wall: FILLER,
        turn: 0,
        drawn: '9s',
      }),
    steps: [
      { text: '正式牌局里每次操作有 15 秒倒计时。超时会自动帮你「过」或出一张牌；连续超时 2 次进入「托管」，系统替你打，点提示条就能拿回控制。' },
      {
        text: '桌上的 AI 牌友会看着牌局说话、斗嘴，有时还会虚张声势——别全信！他们还会记得你，下次见面可能翻旧账。',
        say: [
          { seat: 2, text: '我快听了，你们小心点。' },
          { seat: 1, text: '你就吹吧。' },
        ],
      },
      { text: '点左上角「💬 聊天」可以和他们说话、发表情、选快捷语。嫌吵的话，在「账号」里把嘴碎程度调成「安静」。' },
      { text: '金币只用于游戏里的结算，没有任何现实价值，不能兑换。练习场不结算金币，适合练手；每天可以领一次每日奖励。祝你玩得开心！' },
    ],
  },
];

/** Deterministic tutorial opponent: discards what it drew, never claims, never declares. */
export function tutorialMove(state: HandState, seat: Seat, legal: LegalActions): Action | null {
  if (legal.swapSuits?.length) {
    const suit = legal.swapSuits[0];
    return { type: 'swap', seat, tiles: state.players[seat].hand.filter((t) => suitOf(t) === suit).slice(0, 3) };
  }
  if (legal.dingque) return { type: 'dingque', seat, suit: fewestSuit(state, seat) };
  if (legal.pass) return { type: 'pass', seat };
  if (legal.discard?.length) {
    const stage = state.stage;
    const drawn = stage.kind === 'turn' ? stage.drawn : null;
    const t = drawn !== null && legal.discard.includes(drawn) ? drawn : legal.discard[legal.discard.length - 1];
    return { type: 'discard', seat, tile: t };
  }
  return null;
}


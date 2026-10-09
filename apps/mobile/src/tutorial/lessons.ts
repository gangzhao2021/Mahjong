/**
 * Beginner tutorial (PRD §27): short guided lessons on scripted deals,
 * played on the real table UI with the shared rules engine running locally.
 * No server, no LLM, no coins. Every text is written in both languages.
 */
import { customHand, suitOf, type Action, type HandState, type LegalActions, type Seat, type Suit } from '@mahjong/engine';
import type { DistributiveOmit } from '@mahjong/protocol';
import type { Bilingual } from '../strings';

export type Intent = DistributiveOmit<Action, 'seat'>;

export interface LessonStep {
  /** Instruction for the player. */
  text: Bilingual;
  /** The action this step waits for; absent = an explanation with a "next" button. */
  expect?: (action: Intent, state: HandState) => boolean;
  /** Gentle nudge when the player does something else. */
  hint?: Bilingual;
  /** After the step: let the other players move until the player has something to do. */
  thenAutoPlay?: boolean;
  /** Lines the characters say when this step begins. */
  say?: { seat: Seat; text: Bilingual }[];
}

export interface Lesson {
  id: string;
  title: Bilingual;
  summary: Bilingual;
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
    title: { zh: '1. 摸牌与出牌', en: '1. Draw and discard' },
    summary: { zh: '牌的种类、手牌、怎么出牌', en: 'The tiles, your hand, how to discard' },
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
        text: {
          zh: '欢迎来到四川麻将！只用万、条、筒三种花色，共 108 张。四川麻将不能「吃」，只能碰、杠、胡。',
          en: 'Welcome to Sichuan Mahjong! Only three suits are used — Characters, Bamboo and Dots — 108 tiles in all. There is no chow: you can only pong, kong and win.',
        },
        say: [{ seat: 1, text: { zh: '新手？别紧张，叔带你。', en: "New here? Don't worry, I'll show you the ropes." } }],
      },
      {
        text: {
          zh: '最下面一排是你的手牌，最右边隔开的那张是刚摸到的。轮到你时：先摸一张，再打一张。',
          en: 'The bottom row is your hand; the tile set apart on the right is the one you just drew. On your turn you draw one tile, then discard one.',
        },
      },
      {
        text: {
          zh: '这张 9条 和其他牌都连不上。点它一下选中，再点一下就打出去了（双击或往上滑也可以）。',
          en: "This 9 Bamboo doesn't fit with anything. Tap it to select it, then tap it again to discard (double-tap or a swipe up work too).",
        },
        expect: isDiscardOf('9s'),
        hint: { zh: '先打 9条：点它两下，或往上滑。', en: 'Discard the 9 Bamboo: tap it twice, or swipe it up.' },
        thenAutoPlay: true,
      },
      {
        text: {
          zh: '大家按逆时针轮流摸牌、出牌，打出的牌放在桌子中间。现在又轮到你了。',
          en: 'Players take turns counter-clockwise; discards go to the middle of the table. Now it is your turn again.',
        },
      },
      {
        text: {
          zh: '目标：凑成 4 组（三张一样，或同花色三张相连）再加 1 对「将」，就能胡牌。你现在已经很接近了！',
          en: 'The goal: 4 sets (three of a kind, or a run of three in one suit) plus 1 pair. You are already very close!',
        },
      },
    ],
  },
  {
    id: 'swap',
    title: { zh: '2. 换三张与定缺', en: '2. Swap three and void suit' },
    summary: { zh: '开局换牌、选缺门、先打缺门', en: 'Opening swap, choosing a void suit, clearing it' },
    setup: () =>
      customHand({
        hands: ['1234567m1234s258p', OPPONENT, OPPONENT, '12m45s123456789p'],
        wall: FILLER + FILLER,
        phase: 'swap',
        dealer: 0,
        swapDirection: 'counterClockwise',
      }),
    steps: [
      {
        text: {
          zh: '每局开始先「换三张」：每人选 3 张同一花色的牌，按方向交换给别人。一般换掉最用不上的那门。',
          en: 'Each hand starts with "swap three": everyone passes 3 tiles of one suit to another player. Usually you give away your least useful suit.',
        },
      },
      {
        text: {
          zh: '你的筒子最少，系统已经按建议帮你选好了 2筒、5筒、8筒（抬起来的三张）。想换别的可以点牌改选；这次直接点「确认换牌」。',
          en: 'You have the fewest Dots, so the suggested 2, 5 and 8 Dots are already selected (the raised tiles). You can tap tiles to change the pick; this time just tap "Swap".',
        },
        expect: (a) => a.type === 'swap' && a.tiles.every((t) => suitOf(t) === P),
        hint: { zh: '换牌要同一花色的 3 张。选回 2筒、5筒、8筒，再点「确认换牌」。', en: 'Swap needs 3 tiles of one suit. Select 2, 5 and 8 Dots again, then tap "Swap".' },
        thenAutoPlay: true,
      },
      {
        text: {
          zh: '这局是逆时针换牌：你的牌给了右手边，左手边阿强换给你 1筒、2筒、3筒。',
          en: 'This hand swaps counter-clockwise: your tiles went to the right, and Qiang on your left passed you 1, 2 and 3 Dots.',
        },
      },
      {
        text: {
          zh: '接下来「定缺」：选一门这局不要的花色，不能用它胡牌。你的筒子最少，选「缺筒」。',
          en: 'Next, pick a void suit: a suit you give up for this hand and cannot win with. You still have the fewest Dots, so choose Dots.',
        },
        expect: (a, s) => a.type === 'dingque' && a.suit === fewestSuit(s),
        hint: { zh: '选你最少的那门花色。', en: 'Choose the suit you hold the fewest of.' },
        thenAutoPlay: true,
      },
      {
        text: {
          zh: '缺门的牌要先打完。你手里还有 3 张筒子，先打一张（其他牌现在是灰的，不能打）。',
          en: 'Void-suit tiles must be discarded first. You still hold 3 Dots — discard one (the other tiles are greyed out for now).',
        },
        expect: (a) => a.type === 'discard' && suitOf(a.tile) === P,
        hint: { zh: '先打筒子。', en: 'Discard a Dots tile first.' },
      },
      {
        text: {
          zh: '手里还留着缺门的牌就不能胡。如果流局时还拿着缺门牌，叫「花猪」，要赔给别人！',
          en: 'You cannot win while holding void-suit tiles. If the wall runs out and you still have some, you are a "Flower Pig" and must pay everyone!',
        },
      },
    ],
  },
  {
    id: 'pong',
    title: { zh: '3. 碰与杠', en: '3. Pong and kong' },
    summary: { zh: '碰别人的牌、暗杠、刮风下雨', en: 'Claiming a pong, concealed kongs, kong payments' },
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
        text: {
          zh: '左手边阿强打出一张 5条，你手里正好有一对。别人打出的牌，你有一对一样的就能「碰」。点「碰」！',
          en: 'Qiang on your left discarded a 5 Bamboo, and you hold a pair of them. When you have a pair matching a discard, you can pong it. Tap "Pong"!',
        },
        expect: (a) => a.type === 'pong',
        hint: { zh: '点「碰」把 5条 拿过来。', en: 'Tap "Pong" to take the 5 Bamboo.' },
        say: [{ seat: 3, text: { zh: '这张你也要？拿去拿去。', en: 'You want that one too? Fine, take it.' } }],
      },
      {
        text: {
          zh: '碰完不用摸牌，直接打一张。把用不上的 1条 打出去。',
          en: "After a pong you don't draw — just discard. Get rid of the useless 1 Bamboo.",
        },
        expect: isDiscardOf('1s'),
        hint: { zh: '打 1条。', en: 'Discard the 1 Bamboo.' },
        thenAutoPlay: true,
      },
      {
        text: {
          zh: '你摸到了第 4 张 9万！手里有 4 张一样的可以「暗杠」：点「杠 9万」。暗杠时其他每家付你 2 倍底分，这叫「下雨」。',
          en: 'You drew the 4th 9 Characters! Four of a kind in your hand is a concealed kong: tap "Kong 9 Crak". Every other player pays you 2× the base score — that\'s "rain".',
        },
        expect: (a) => a.type === 'selfKong' && a.tile === tile('9m'),
        hint: { zh: '点「杠 9万」。', en: 'Tap "Kong 9 Crak".' },
      },
      {
        text: {
          zh: '杠完从牌墙尾巴补摸一张（你补到了 5万），然后照常出一张。',
          en: 'After a kong you draw a replacement from the back of the wall (you got a 5 Characters), then discard as usual.',
        },
        expect: (a) => a.type === 'discard',
        hint: { zh: '随便打一张。', en: 'Discard any tile.' },
      },
      {
        text: {
          zh: '别人打出的牌你有三张一样的，也能直接杠（明杠，打牌的人付 2 倍）；碰过的牌再摸到第 4 张可以补杠（每家付 1 倍）。杠完马上收钱，叫「刮风下雨」。',
          en: 'You can also kong a discard when you hold three of it (exposed kong: the discarder pays 2×), or add a drawn 4th tile to a pong (added kong: everyone pays 1×). Kongs pay out immediately.',
        },
      },
    ],
  },
  {
    id: 'win',
    title: { zh: '4. 胡牌与番数', en: '4. Winning and fan' },
    summary: { zh: '点炮胡、番数怎么算、血战到底', en: 'Winning on a discard, counting fan, the bloody battle' },
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
        text: {
          zh: '你的牌是 3 组 + 23条 + 一对将，只差 1条 或 4条。阿强刚好打出 4条——点「胡」！',
          en: 'You have 3 sets, 2-3 Bamboo and a pair: you only need a 1 or 4 Bamboo. Qiang just discarded a 4 Bamboo — tap "Win"!',
        },
        expect: (a) => a.type === 'hu',
        hint: { zh: '点「胡」。', en: 'Tap "Win".' },
        say: [{ seat: 3, text: { zh: '这张总安全吧……', en: 'This one has to be safe…' } }],
      },
      {
        text: {
          zh: '胡了！这叫「点炮」：打出这张牌的人一个人付钱。你这手是「平胡」，0 番，得 1 倍底分。',
          en: 'You won! Winning on a discard means only the discarder pays. This is a Plain Win, 0 fan, worth 1× the base score.',
        },
        say: [{ seat: 3, text: { zh: '哎呀，点炮了……', en: 'Oh no, I dealt in…' } }],
      },
      {
        text: {
          zh: '番数越大赢得越多，每多 1 番翻一倍：对对胡 1 番，清一色、七对 2 番，龙七对 3 番；每有一个「根」（4 张一样的）再加 1 番。默认 4 番封顶。',
          en: 'Each fan doubles the payout: All Pongs is 1 fan, Pure Suit and Seven Pairs 2 fan, Dragon Seven Pairs 3 fan, and every "root" (four of a kind) adds 1 more. The default cap is 4 fan.',
        },
      },
      {
        text: {
          zh: '这就是「血战到底」：你胡了之后退出这一局，其他三家继续打，直到三家胡牌或牌摸完。正式牌局里可以点「跳过，直接看结算」。',
          en: 'This is the "bloody battle": once you win you sit out, and the others play on until three players have won or the wall runs out. In real games you can tap "Skip to results".',
        },
      },
    ],
  },
  {
    id: 'zimo',
    title: { zh: '5. 自摸与流局', en: '5. Self-draw and exhausted wall' },
    summary: { zh: '自摸、查花猪、查大叫', en: 'Self-draw, Flower Pig and not-ready penalties' },
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
        text: {
          zh: '你自己摸到了要的 4条！点「自摸」。自摸时其他每家都要付钱，默认每家还多给 1 倍底分。',
          en: 'You drew the 4 Bamboo you needed yourself! Tap "Self-draw". On a self-draw every other player pays, plus 1× base score each by default.',
        },
        expect: (a) => a.type === 'zimo',
        hint: { zh: '点「自摸」。', en: 'Tap "Self-draw".' },
      },
      {
        text: {
          zh: '如果牌摸完还没人胡（流局），要「查花猪」和「查大叫」：花猪赔给其他人；没听牌的人赔给听牌的人，还要把收过的杠钱退回去（退税）。',
          en: 'If the wall runs out (exhausted wall), penalties apply: Flower Pigs pay everyone, and players who are not ready pay those who are — and refund any kong money they collected.',
        },
      },
    ],
  },
  {
    id: 'table',
    title: { zh: '6. 计时、托管、聊天和金币', en: '6. Timers, auto-play, chat and coins' },
    summary: { zh: '倒计时与托管、AI 牌友、金币', en: 'Turn timers and auto-play, AI players, coins' },
    setup: () =>
      customHand({
        hands: ['123m456m789m11s23s9s', OPPONENT, OPPONENT, OPPONENT],
        voids: ALL_DOTS_VOID,
        wall: FILLER,
        turn: 0,
        drawn: '9s',
      }),
    steps: [
      {
        text: {
          zh: '正式牌局里每次操作有 15 秒倒计时。超时会自动帮你「过」或出一张牌；连续超时 2 次进入「托管」，系统替你打，点提示条就能拿回控制。',
          en: 'In real games each decision has a 15-second timer. When it runs out you pass or discard automatically; after 2 timeouts in a row auto-play takes over — tap the banner to take back control.',
        },
      },
      {
        text: {
          zh: '桌上的 AI 牌友会看着牌局说话、斗嘴，有时还会虚张声势——别全信！他们还会记得你，下次见面可能翻旧账。',
          en: "The AI players chat and banter about the game, and sometimes they bluff — don't believe everything! They also remember you, and may bring up old games next time.",
        },
        say: [
          { seat: 2, text: { zh: '我快听了，你们小心点。', en: "I'm almost ready, watch out." } },
          { seat: 1, text: { zh: '你就吹吧。', en: 'Yeah, right.' } },
        ],
      },
      {
        text: {
          zh: '点左上角「💬 聊天」可以和他们说话、发表情、选快捷语。嫌吵的话，在「账号」里把嘴碎程度调成「安静」。',
          en: 'Tap "💬 Chat" in the top left to talk to them, send stickers or quick phrases. Too noisy? Set table talk to "Quiet" under Account.',
        },
      },
      {
        text: {
          zh: '金币只用于游戏里的结算，没有任何现实价值，不能兑换。练习场不结算金币，适合练手；每天可以领一次每日奖励。祝你玩得开心！',
          en: 'Coins are only for scoring in the game: they have no real-world value and cannot be exchanged. The practice table has no coins at stake, and you can claim a daily reward once a day. Have fun!',
        },
      },
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

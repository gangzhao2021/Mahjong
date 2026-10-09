/**
 * The rules page: every fan pattern with an example hand, then the rules of
 * 血战到底 as this game plays them (DEFAULT_RULESET). Amounts match the engine.
 */
import { parseTiles, type Meld, type Pattern, type Tile } from '@mahjong/engine';
import type { Bilingual } from '../strings';

export interface PatternEntry {
  pattern: Pattern;
  /** Example winning hand in compact notation; '|' separates exposed sets. */
  example: string | null;
  fan: Bilingual;
  about: Bilingual;
}

export const PATTERNS: PatternEntry[] = [
  { pattern: 'pingHu', example: '123m456m789m234s55s', fan: { zh: '0 番', en: '0 fan' }, about: { zh: '四组顺子或刻子加一对将，最基本的胡法。', en: 'Four sets plus a pair: the basic win.' } },
  { pattern: 'duiDuiHu', example: '111m444m333s777s55s', fan: { zh: '1 番', en: '1 fan' }, about: { zh: '四组全是刻子（三张相同）。', en: 'All four sets are triplets.' } },
  { pattern: 'qingYiSe', example: '123m456m789m234m55m', fan: { zh: '2 番', en: '2 fan' }, about: { zh: '整手牌只有一种花色。', en: 'The whole hand is one suit.' } },
  { pattern: 'qiDui', example: '11m22m33m44m55s66s77s', fan: { zh: '2 番', en: '2 fan' }, about: { zh: '七个对子，不能碰过牌。', en: 'Seven pairs, with no exposed sets.' } },
  { pattern: 'jinGouDiao', example: '111m|222s|333s|777m|5s5s', fan: { zh: '2 番', en: '2 fan' }, about: { zh: '碰杠了四组，手里只剩一张单钓将。', en: 'Four exposed sets, waiting on a single tile for the pair.' } },
  { pattern: 'jiangDui', example: '222m555m888m222s55s', fan: { zh: '3 番', en: '3 fan' }, about: { zh: '对对胡，而且每张牌都是 2、5、8。', en: 'All triplets, and every tile is a 2, 5 or 8.' } },
  { pattern: 'qingDui', example: '111m222m333m444m55m', fan: { zh: '3 番', en: '3 fan' }, about: { zh: '清一色的对对胡。', en: 'All triplets in a single suit.' } },
  { pattern: 'longQiDui', example: '1111m22m33m44s55s66s', fan: { zh: '3 番', en: '3 fan' }, about: { zh: '七对里有四张相同的牌（算两对）。', en: 'Seven pairs including four of a kind (counted as two pairs).' } },
  { pattern: 'qingQiDui', example: '11m22m33m44m55m66m77m', fan: { zh: '4 番', en: '4 fan' }, about: { zh: '清一色的七对。', en: 'Seven pairs in a single suit.' } },
  { pattern: 'qingLongQiDui', example: '1111m22m33m44m55m66m', fan: { zh: '5 番', en: '5 fan' }, about: { zh: '清一色的龙七对。', en: 'Dragon seven pairs in a single suit.' } },
  { pattern: 'gen', example: null, fan: { zh: '每个 +1 番', en: '+1 fan each' }, about: { zh: '手里或碰杠中有四张相同的牌，每有一组加 1 番（杠也算）。', en: 'Each kind you hold all four of, kongs included, adds 1 fan.' } },
  { pattern: 'gangShangHua', example: null, fan: { zh: '+1 番', en: '+1 fan' }, about: { zh: '杠后补摸的牌正好自摸。', en: 'Self-draw on the replacement tile after a kong.' } },
  { pattern: 'gangShangPao', example: null, fan: { zh: '+1 番', en: '+1 fan' }, about: { zh: '别人杠后打出的牌被你胡。', en: 'Win on the tile someone discards right after their kong.' } },
  { pattern: 'qiangGang', example: null, fan: { zh: '+1 番', en: '+1 fan' }, about: { zh: '别人补杠时，你正好胡那张牌，把杠抢过来。', en: 'Win on the tile another player adds to a pong to make a kong.' } },
  { pattern: 'haiDi', example: null, fan: { zh: '+1 番', en: '+1 fan' }, about: { zh: '摸到最后一张牌自摸。', en: 'Self-draw on the last tile of the wall.' } },
  { pattern: 'ziMo', example: null, fan: { zh: '每家多付一份底分', en: 'everyone pays one more base' }, about: { zh: '自己摸到胡牌，还没胡的每家都要付。', en: 'You draw your winning tile yourself: every player still in pays.' } },
  { pattern: 'tianHu', example: null, fan: { zh: '满番', en: 'max fan' }, about: { zh: '庄家起手 14 张就已经胡了。', en: 'The dealer wins with the opening fourteen tiles.' } },
  { pattern: 'diHu', example: null, fan: { zh: '满番', en: 'max fan' }, about: { zh: '闲家第一次摸牌就自摸。', en: 'A non-dealer self-draws a win on their first draw.' } },
];

/** Parses "111m|222s|...|55s": every part before the last is an exposed pong. */
export function parseExample(example: string): { hand: Tile[]; melds: Meld[] } {
  const parts = example.split('|');
  const melds = parts.slice(0, -1).map((p): Meld => ({ type: 'pong', tile: parseTiles(p)[0], from: 1 }));
  return { hand: parseTiles(parts[parts.length - 1]), melds };
}

export interface RuleSection {
  title: Bilingual;
  body: Bilingual;
}

export const RULES: RuleSection[] = [
  {
    title: { zh: '公平说明', en: 'Fair play' },
    body: {
      zh: '发牌：开局前公布一个加密摘要，结束后公开发牌种子，结算页会自动校验，任何人都能用种子重新发出整副牌。AI：只能看到自己的手牌和桌面上公开的牌，看不到你的牌，也不会根据输赢或金币调整发牌。对手是 AI 时，座位上始终标着「AI」。游戏里没有充值、广告和付费道具。',
      en: 'Deals: a digest is published before each deal and the seed is revealed afterwards; the result screen checks it, and anyone can re-deal the whole wall from the seed. AI players see only their own tiles and what is on the table — never yours — and deals never depend on wins or coins. AI seats are always labelled "AI". There are no purchases, ads or paid items.',
    },
  },
  {
    title: { zh: '牌和座位', en: 'Tiles and seats' },
    body: {
      zh: '只用万、条、筒三门，共 108 张。四人各 13 张，庄家 14 张先打。不能吃，只能碰、杠、胡。',
      en: 'Only characters, bamboo and dots: 108 tiles. Everyone gets 13, the dealer 14 and discards first. No chow: you can only pong, kong or win.',
    },
  },
  {
    title: { zh: '换三张', en: 'Swap three' },
    body: {
      zh: '开局每人选三张同一花色的牌，按顺时针、逆时针或对家的方向交换（每局随机）。',
      en: 'At the start everyone passes three tiles of one suit, clockwise, counter-clockwise or across (random each hand).',
    },
  },
  {
    title: { zh: '定缺', en: 'Void suit' },
    body: {
      zh: '换完牌后每人选一门不要的花色（缺门）。缺门的牌必须先打完，胡牌时手里只能有两门花色。',
      en: 'After the swap everyone picks a suit to give up. Those tiles must be discarded first, and a winning hand may hold only two suits.',
    },
  },
  {
    title: { zh: '血战到底', en: 'Bloody battle' },
    body: {
      zh: '有人胡牌后这局不结束，其余的人继续打，直到三家都胡了，或者牌摸完了。一张牌可以同时被几家胡（一炮多响）。',
      en: 'A win does not end the hand: the rest play on until three players have won or the wall runs out. Several players can win on the same discard.',
    },
  },
  {
    title: { zh: '过手胡', en: 'Passed win' },
    body: {
      zh: '能胡却选择了「过」，在自己下次摸牌前，不能再胡别人打出的牌（自摸可以）。',
      en: 'If you pass on a win, you cannot win on a discard again until your next draw (self-draw still counts).',
    },
  },
  {
    title: { zh: '计分', en: 'Scoring' },
    body: {
      zh: '每家付：底分 × 2 的番数次方，默认封顶 4 番。点炮由打出那张牌的人付；自摸由还没胡的每家付，并多付一份底分。',
      en: 'Each payer pays base × 2^fan, capped at 4 fan by default. The discarder pays for a discard win; on a self-draw everyone still in pays, plus one extra base each.',
    },
  },
  {
    title: { zh: '刮风下雨（杠）', en: 'Kongs pay at once' },
    body: {
      zh: '明杠（刮风）：点杠的人付 2 倍底分。补杠：还没胡的每家付 1 倍底分。暗杠（下雨）：还没胡的每家付 2 倍底分。杠后点炮，杠钱转给胡牌的人（呼叫转移）。',
      en: 'Exposed kong: the discarder pays 2× base. Added kong: everyone still in pays 1× base. Concealed kong: everyone still in pays 2× base. If you deal in right after your kong, that kong money goes to the winner.',
    },
  },
  {
    title: { zh: '流局查叫', en: 'When the wall runs out' },
    body: {
      zh: '查花猪：手里还有三门牌的人，赔给其余每家封顶分。查大叫：没听牌的人，赔给听牌的人他能胡的最大分。退税：没听牌的人要退还这局杠来的钱。',
      en: 'Flower pig: anyone still holding three suits pays everyone else the capped score. Not ready: players who are not ready pay each ready player their best possible win. Kong refund: players who are not ready return their kong money.',
    },
  },
];

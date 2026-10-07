/**
 * Long-term AI memory (PRD §8, §45, Appendix B) — the pure parts: what to
 * remember from a hand, how memories fade, and how they are phrased for
 * templates and prompts. Storage lives in the server.
 */
import type { HandResult, Pattern, Seat } from '@mahjong/engine';
import { publicTileName } from './templates';

export type MemoryKind = 'dealt_in' | 'lost_to_player' | 'big_win' | 'memorable_hand' | 'funny_moment' | 'notable_quote' | 'habit';

/** A memory about the player, held by one character (or shared by all when characterId is null). */
export interface MemoryCandidate {
  characterId: string | null;
  kind: MemoryKind;
  /** One sentence. Character memories are first person ("我"), shared ones third person. */
  summary: string;
  importance: number;
}

/** What one hand changes in a (character, player) relationship. */
export interface RelationshipDelta {
  characterId: string;
  characterWins: number;
  playerWins: number;
  /** The player's discard let this character win. */
  dealtInByPlayer: number;
  /** This character's discard let the player win. */
  dealtInToPlayer: number;
  /** Points the character gained from the player (negative = lost to them). */
  pointsNet: number;
  rivalryDelta: number;
  grudge: { reason: string; strength: number } | null;
}

export interface PlayerHandStats {
  dealIns: number;
  wins: number;
  selfDraws: number;
  bigWins: number;
  huaZhu: number;
}

export interface HandMemoryInput {
  humanSeat: Seat;
  characters: { seat: Seat; characterId: string }[];
  result: HandResult;
  playerName: string;
}

const PATTERN_ZH: Record<Pattern, string> = {
  pingHu: '平胡',
  duiDuiHu: '对对胡',
  qingYiSe: '清一色',
  qiDui: '七对',
  jinGouDiao: '金钩钓',
  jiangDui: '将对',
  qingDui: '清对',
  longQiDui: '龙七对',
  qingQiDui: '清七对',
  qingLongQiDui: '清龙七对',
  gen: '根',
  gangShangHua: '杠上花',
  gangShangPao: '杠上炮',
  qiangGang: '抢杠胡',
  haiDi: '海底捞月',
  ziMo: '自摸',
  tianHu: '天胡',
  diHu: '地胡',
};

const BIG_FAN = 3;

const handName = (patterns: Pattern[]) => PATTERN_ZH[patterns[0]] ?? '胡牌';

/** Extracts relationship changes, memorable events and player stats from one finished hand. */
export function extractHandMemory(input: HandMemoryInput): { relationships: RelationshipDelta[]; events: MemoryCandidate[]; stats: PlayerHandStats } {
  const { humanSeat: h, result, playerName: name } = input;
  const events: MemoryCandidate[] = [];
  const stats: PlayerHandStats = { dealIns: 0, wins: 0, selfDraws: 0, bigWins: 0, huaZhu: 0 };

  for (const w of result.wins) {
    if (w.from === h) stats.dealIns++;
    if (w.seat === h) {
      stats.wins++;
      if (w.selfDraw) stats.selfDraws++;
      if (w.fan >= BIG_FAN) {
        stats.bigWins++;
        events.push({
          characterId: null,
          kind: 'big_win',
          summary: `${name}胡过一把${handName(w.patterns)}，${w.fan} 番。`,
          importance: Math.min(1, 0.45 + 0.1 * w.fan),
        });
      }
    }
  }
  if (result.drawSettlement?.huaZhu.includes(h)) {
    stats.huaZhu++;
    events.push({ characterId: null, kind: 'funny_moment', summary: `${name}有一局流局时当了花猪。`, importance: 0.45 });
  }

  const relationships = input.characters.map(({ seat: c, characterId }): RelationshipDelta => {
    const delta: RelationshipDelta = {
      characterId,
      characterWins: 0,
      playerWins: 0,
      dealtInByPlayer: 0,
      dealtInToPlayer: 0,
      pointsNet: 0,
      rivalryDelta: 0,
      grudge: null,
    };
    for (const p of result.payments) {
      if (p.from === h && p.to === c) delta.pointsNet += p.amount;
      if (p.from === c && p.to === h) delta.pointsNet -= p.amount;
    }
    const robbed = result.wins.some((w) => w.seat === h && w.from === c && w.patterns.includes('qiangGang'));

    for (const w of result.wins) {
      if (w.seat === c && (w.from === h || w.selfDraw)) {
        delta.characterWins++;
        delta.rivalryDelta += 0.03 + 0.02 * w.fan;
        if (w.from === h) {
          delta.dealtInByPlayer++;
          events.push({
            characterId,
            kind: 'dealt_in',
            summary: `${name}打出${publicTileName(w.tile)}点炮，我胡了${handName(w.patterns)}（${w.fan} 番）。`,
            importance: Math.min(1, 0.3 + 0.1 * w.fan),
          });
        }
      }
      if (w.seat === h && (w.from === c || w.selfDraw)) {
        delta.playerWins++;
        delta.rivalryDelta += 0.04 + 0.03 * w.fan;
        if (w.from === c) {
          delta.dealtInToPlayer++;
          const summary = robbed
            ? `我补杠的时候被${name}抢杠胡了，${w.fan} 番。`
            : `我打${publicTileName(w.tile)}点炮给${name}，被胡了${handName(w.patterns)}（${w.fan} 番）。`;
          events.push({
            characterId,
            kind: robbed ? 'memorable_hand' : 'lost_to_player',
            summary,
            importance: Math.min(1, (robbed ? 0.55 : 0.35) + 0.12 * w.fan),
          });
          // Losing a big hand to the player is the stuff grudges are made of.
          if (w.fan >= 2 || robbed) {
            delta.grudge = { reason: summary, strength: Math.min(1, 0.3 + 0.15 * w.fan + (robbed ? 0.2 : 0)) };
          }
        }
      }
    }
    return delta;
  });

  return { relationships, events, stats };
}

/** Rivalry change at game end, from the final standings between player and character. */
export function gameEndRivalry(playerTotal: number, characterTotal: number, baseScore: number): number {
  const gap = Math.abs(playerTotal - characterTotal) / Math.max(1, baseScore);
  // Close games and lopsided games both make a rivalry; middling ones barely register.
  return gap <= 2 ? 0.06 : gap >= 16 ? 0.08 : 0.02;
}

// ---------------------------------------------------------------------------
// Fading
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export function fade(value: number, since: Date | null, now: Date, halfLifeDays: number): number {
  if (!since) return value;
  const days = Math.max(0, (now.getTime() - since.getTime()) / DAY);
  return value * 0.5 ** (days / halfLifeDays);
}

export const RIVALRY_HALF_LIFE_DAYS = 21;
export const GRUDGE_HALF_LIFE_DAYS = 30;

/** Ranking for recall: important, recent, and not already brought up many times. */
export function recallScore(e: { importance: number; createdAt: Date; referenceCount: number }, now: Date): number {
  const ageDays = (now.getTime() - e.createdAt.getTime()) / DAY;
  return e.importance * 0.5 ** (ageDays / 45) / (1 + 0.6 * e.referenceCount);
}

/** Retention ranking for pruning (PRD Appendix B.2: importance × recency). */
export function retentionScore(e: { importance: number; createdAt: Date }, now: Date): number {
  return e.importance * 0.5 ** ((now.getTime() - e.createdAt.getTime()) / DAY / 60);
}

// ---------------------------------------------------------------------------
// Recall context for dialogue
// ---------------------------------------------------------------------------

/** What a character remembers about the human at the table, loaded at game start. */
export interface CharacterMemory {
  characterId: string;
  gamesTogether: number;
  characterWins: number;
  playerWins: number;
  dealtInByPlayer: number;
  dealtInToPlayer: number;
  /** Already faded to "now". */
  rivalry: number;
  grudge: { reason: string; strength: number } | null;
  daysSinceLastSeen: number | null;
  events: { id: number; kind: MemoryKind; summary: string }[];
  /** Shared impression of the player's play style. */
  profile: { playStyle: string; habits: string[] } | null;
}

export type ReunionFlavor = 'grudge' | 'rival' | 'beaten' | 'beatThem' | 'friendly';

export function reunionFlavor(m: CharacterMemory): ReunionFlavor {
  if (m.grudge && m.grudge.strength >= 0.3) return 'grudge';
  if (m.rivalry >= 0.35) return 'rival';
  if (m.playerWins > m.characterWins + 1) return 'beaten';
  if (m.characterWins > m.playerWins + 1) return 'beatThem';
  return 'friendly';
}

/** How notable a reunion is — picks which character greets the player. */
export function reunionWeight(m: CharacterMemory): number {
  return m.gamesTogether === 0 ? 0 : 0.2 + m.rivalry + (m.grudge?.strength ?? 0) + Math.min(0.3, m.gamesTogether * 0.03);
}

export function relationLabel(m: CharacterMemory): string {
  if (m.grudge && m.grudge.strength >= 0.5) return '记仇的对手';
  if (m.rivalry >= 0.5) return '死对头';
  if (m.rivalry >= 0.25) return '冤家';
  if (m.gamesTogether >= 5) return '老牌友';
  return '打过几次牌的牌友';
}

/** The memory section of an LLM prompt. Summaries may quote the player, so callers fence it as data. */
export function describeMemory(m: CharacterMemory, playerName: string): string[] {
  if (m.gamesTogether === 0 && !m.events.length && !m.profile) return [];
  const lines = [
    `关系：${relationLabel(m)}。一起打过 ${m.gamesTogether} 场；${playerName}点过你的炮 ${m.dealtInByPlayer} 次，你点过${playerName}的炮 ${m.dealtInToPlayer} 次；你赢过他 ${m.characterWins} 把，他赢过你 ${m.playerWins} 把。`,
  ];
  if (m.daysSinceLastSeen !== null && m.daysSinceLastSeen >= 7) lines.push(`你们已经 ${Math.round(m.daysSinceLastSeen)} 天没一起打牌了。`);
  if (m.grudge && m.grudge.strength >= 0.2) lines.push(`你记着仇：${m.grudge.reason}`);
  for (const e of m.events) lines.push(`往事：${e.summary}`);
  if (m.profile) {
    lines.push(`${playerName}的打牌风格：${m.profile.playStyle}${m.profile.habits.length ? `（${m.profile.habits.join('、')}）` : ''}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Player profile (deterministic; an LLM may rewrite the wording)
// ---------------------------------------------------------------------------

export interface PlayerStats {
  handsPlayed: number;
  gamesPlayed: number;
  dealIns: number;
  wins: number;
  selfDraws: number;
  bigWins: number;
  huaZhu: number;
  chatMessages: number;
}

export function profileFromStats(s: PlayerStats): { playStyle: string; habits: string[] } | null {
  if (s.handsPlayed < 4) return null;
  const habits: string[] = [];
  const dealInRate = s.dealIns / s.handsPlayed;
  const winRate = s.wins / s.handsPlayed;
  if (dealInRate >= 0.25) habits.push('经常点炮');
  else if (dealInRate <= 0.08) habits.push('很少点炮');
  if (winRate >= 0.45) habits.push('手气很旺');
  if (s.wins >= 3 && s.selfDraws / s.wins >= 0.5) habits.push('爱自摸');
  if (s.wins >= 3 && s.bigWins / s.wins >= 0.3) habits.push('喜欢做大牌');
  if (s.huaZhu >= 2) habits.push('当过不止一次花猪');
  if (s.gamesPlayed >= 3) {
    const perGame = s.chatMessages / s.gamesPlayed;
    if (perGame >= 4) habits.push('牌桌上话很多');
    else if (s.chatMessages === 0) habits.push('从不说话');
  }
  const style = dealInRate >= 0.25 ? '打法激进，不太防守' : dealInRate <= 0.08 ? '打法谨慎，守得很严' : '攻守比较均衡';
  return { playStyle: style, habits };
}

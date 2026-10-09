import type { SkillLevel } from '@mahjong/ai-play';

export interface ServerConfig {
  port: number;
  dataDir: string;
  /** Decision time for the human seat (PRD §14). */
  timers: {
    swapMs: number;
    dingqueMs: number;
    discardMs: number;
    claimMs: number;
    /** Results screen before the next hand starts on its own. */
    nextHandMs: number;
    nextHandAutoPlayMs: number;
  };
  /** Consecutive timeouts before auto-play (托管) turns on. */
  autoPlayAfterTimeouts: number;
  /** Practice tables (no coins) are for learning: longer timers and slower to fall into auto-play. */
  practice: { timerScale: number; autoPlayAfterTimeouts: number };
  /** Delay of an auto-played human move, so the table stays readable. */
  autoPlayDelayMs: number;
  /** Pay the daily login reward automatically on the first connection of the game day. */
  autoLoginReward: boolean;
  /** AI "thinking" time; beginners think a little longer. */
  ai: { minDelayMs: number; maxDelayMs: number; beginnerExtraMs: number };
  /** Arbitrary weights, normalized to probabilities (PRD §4.2). Admin-configurable in Phase 5. */
  skillWeights: Record<SkillLevel, number>;
  defaultBaseScore: number;
  defaultHandsPerGame: number;
  maxHandsPerGame: number;
  /** After a server restart, restored games wait this long for the player to reconnect before play resumes. */
  restoreGraceMs: number;
  /** Budget for all unattended games together (actions per second), so they never starve live tables. */
  unattendedActionsPerSecond: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? 'data',
  timers: {
    swapMs: 20_000,
    dingqueMs: 15_000,
    discardMs: 25_000,
    claimMs: 15_000,
    nextHandMs: 20_000,
    nextHandAutoPlayMs: 4_000,
  },
  autoPlayAfterTimeouts: 2,
  practice: { timerScale: 2, autoPlayAfterTimeouts: 3 },
  autoPlayDelayMs: 700,
  autoLoginReward: true,
  ai: { minDelayMs: 600, maxDelayMs: 1_800, beginnerExtraMs: 500 },
  skillWeights: { beginner: 20, intermediate: 50, expert: 30 },
  defaultBaseScore: 1,
  defaultHandsPerGame: 4,
  maxHandsPerGame: 16,
  restoreGraceMs: 60_000,
  unattendedActionsPerSecond: 400,
};

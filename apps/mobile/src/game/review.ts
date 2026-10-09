/**
 * Post-game review (复盘): for each of my discards in a replayed hand, compare
 * what I threw with the most efficient discard — fewest tiles from ready
 * (向听), then the most useful draws left (进张) — and flag the clear misses.
 */
import { rankDiscards } from '@mahjong/ai-play';
import { suitOf, viewFor, type Action, type HandState, type Seat, type Tile } from '@mahjong/engine';

export interface ReviewNote {
  /** Index of the replay step where the discard happened. */
  step: number;
  played: Tile;
  better: Tile;
  /** 'shanten': the discard moved the hand further from ready; 'acceptance': same distance, clearly fewer useful draws. */
  kind: 'shanten' | 'acceptance';
  playedAcceptance: number;
  betterAcceptance: number;
}

/** Fewer useful draws than this (and at least a quarter fewer) counts as a clear miss. */
const MIN_ACCEPTANCE_GAP = 4;

export function reviewHand(steps: readonly { state: HandState; action: Action | null }[], seat: Seat): ReviewNote[] {
  const notes: ReviewNote[] = [];
  for (let i = 1; i < steps.length; i++) {
    const action = steps[i].action;
    if (action?.type !== 'discard' || action.seat !== seat) continue;
    const view = viewFor(steps[i - 1].state, seat);
    const me = view.players[seat];
    const candidates = view.legal.discard ?? [];
    // Forced void-suit discards are not a choice worth reviewing.
    if (candidates.length < 2 || candidates.every((t) => suitOf(t) === me.voidSuit)) continue;
    const ranked = rankDiscards(view, candidates, 'beginner').sort((a, b) => a.shanten - b.shanten || b.acceptance - a.acceptance);
    const best = ranked[0];
    const played = ranked.find((r) => r.tile === action.tile);
    if (!played || played.tile === best.tile) continue;
    if (played.shanten > best.shanten) {
      notes.push({ step: i, played: played.tile, better: best.tile, kind: 'shanten', playedAcceptance: played.acceptance, betterAcceptance: best.acceptance });
    } else if (best.acceptance - played.acceptance >= MIN_ACCEPTANCE_GAP && played.acceptance <= best.acceptance * 0.75) {
      notes.push({ step: i, played: played.tile, better: best.tile, kind: 'acceptance', playedAcceptance: played.acceptance, betterAcceptance: best.acceptance });
    }
  }
  return notes;
}

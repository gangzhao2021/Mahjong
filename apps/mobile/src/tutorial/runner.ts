/** Pure tutorial mechanics: checking the player's move and letting opponents play. */
import { apply, isLegal, legalActions, SEATS, type GameEvent, type HandState } from '@mahjong/engine';
import { tutorialMove, type Intent, type LessonStep } from './lessons';

export interface Transition {
  state: HandState;
  events: GameEvent[];
}

export const playerCanAct = (s: HandState) => s.phase !== 'ended' && Object.keys(legalActions(s, 0)).length > 0;

/** The player's move for a step: null if it is not what the step asks for (or not legal). */
export function tryPlayerMove(state: HandState, step: LessonStep, intent: Intent): Transition | null {
  const action = { ...intent, seat: 0 } as Parameters<typeof apply>[1];
  if (!step.expect || !step.expect(intent, state) || !isLegal(state, action)) return null;
  return apply(state, action);
}

/** Opponents move one action at a time until the player has something to do. */
export function autoPlay(state: HandState, limit = 60): Transition[] {
  const steps: Transition[] = [];
  let s = state;
  while (s.phase !== 'ended' && !playerCanAct(s) && steps.length < limit) {
    const seat = SEATS.find((x) => x !== 0 && Object.keys(legalActions(s, x)).length > 0);
    if (seat === undefined) break;
    const move = tutorialMove(s, seat, legalActions(s, seat));
    if (!move) break;
    const t = apply(s, move);
    steps.push(t);
    s = t.state;
  }
  return steps;
}

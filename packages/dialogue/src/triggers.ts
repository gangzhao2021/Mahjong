/**
 * Turns engine events into conversation triggers (PRD §6.1). Uses only public
 * information: events are already redacted for the human seat, and the view
 * passed in is the human's own view.
 */
import { suitOf, type GameEvent, type HandView, type Seat } from '@mahjong/engine';
import type { Trigger } from './types';

export interface TriggerContext {
  handIndex: number;
  /** Engine action count after these events. */
  version: number;
  humanSeat: Seat;
  /** The human seat's view after the events (public info about everyone else). */
  view: HandView;
}

const BIG_WIN_FAN = 3;
const LATE_WALL = 30;

export function detectTriggers(events: readonly GameEvent[], ctx: TriggerContext): Trigger[] {
  const base = { version: ctx.version, handIndex: ctx.handIndex };
  const triggers: Trigger[] = [];
  const involvesHuman = (...seats: (Seat | undefined)[]) => seats.includes(ctx.humanSeat);

  for (const e of events) {
    switch (e.type) {
      case 'dingqueRevealed':
        triggers.push({ ...base, kind: 'dingque', importance: 'low' });
        break;
      case 'pong':
        triggers.push({ ...base, kind: 'pong', importance: 'low', subject: e.seat, object: e.from, tile: e.tile });
        break;
      case 'kong':
        triggers.push({
          ...base,
          kind: 'kong',
          importance: 'low',
          subject: e.seat,
          object: e.from,
          tile: e.tile ?? undefined,
        });
        break;
      case 'kongRobbed':
        triggers.push({ ...base, kind: 'robbedKong', importance: 'high', object: e.seat, tile: e.tile });
        break;
      case 'win': {
        const w = e.win;
        const big = w.fan >= BIG_WIN_FAN;
        const kind = big ? 'bigWin' : w.from === undefined ? 'win' : 'dealtIn';
        triggers.push({
          ...base,
          kind,
          importance: big || involvesHuman(w.seat, w.from) ? 'high' : 'low',
          subject: w.seat,
          object: w.from,
          tile: w.tile,
          fan: w.fan,
          patterns: w.patterns,
        });
        break;
      }
      case 'discard':
        if (e.seat === ctx.humanSeat && isDangerousDiscard(ctx.view, e.seat, e.tile)) {
          triggers.push({ ...base, kind: 'dangerousDiscard', importance: 'low', subject: e.seat, tile: e.tile });
        }
        break;
      case 'handEnd': {
        const huaZhu = e.result.drawSettlement?.huaZhu ?? [];
        if (huaZhu.length) {
          triggers.push({ ...base, kind: 'huaZhu', importance: 'low', subject: huaZhu[0] });
        }
        triggers.push({ ...base, kind: 'handEnd', importance: 'low' });
        break;
      }
    }
  }
  return triggers;
}

/**
 * Public-information heuristic for "you just threw a scary tile": late in the
 * hand, a tile in a suit some threatening opponent may still win on.
 */
export function isDangerousDiscard(view: HandView, seat: Seat, tile: number): boolean {
  if (view.wallCount > LATE_WALL) return false;
  return view.players.some(
    (p) => p.seat !== seat && !p.won && p.melds.length >= 2 && p.voidSuit !== suitOf(tile),
  );
}

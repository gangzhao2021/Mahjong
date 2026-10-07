/**
 * Seat controllers (PRD §41). The room treats every seat the same way: it
 * publishes a per-seat update and the controller answers through `submit`.
 * A future remote human seat in real multiplayer is just another controller.
 */
import { chooseAction, type Rng, type SkillLevel } from '@mahjong/ai-play';
import type { Action, GameEvent, HandView } from '@mahjong/engine';
import type { SeatInfo, ServerMessage, TableSnapshot } from '@mahjong/protocol';
import type { WebSocket } from 'ws';

export interface SeatUpdate {
  view: HandView;
  /** Events since the previous update, already redacted for this seat. */
  events: GameEvent[];
  snapshot: TableSnapshot;
  /** This seat has a decision to make. */
  mustAct: boolean;
}

export type Submit = (action: Action, version: number) => void;

export interface SeatController {
  readonly info: SeatInfo;
  update(update: SeatUpdate): void;
  dispose(): void;
}

export class AiSeat implements SeatController {
  private pending: { handle: NodeJS.Timeout; key: string } | null = null;
  private latest: HandView | null = null;

  constructor(
    readonly info: SeatInfo,
    readonly skill: SkillLevel,
    private readonly rng: Rng,
    private readonly thinkMs: (skill: SkillLevel) => number,
    private readonly submit: Submit,
  ) {}

  update({ view, mustAct }: SeatUpdate): void {
    this.latest = view;
    if (!mustAct) {
      this.cancel();
      return;
    }
    // While several seats answer the same claim, keep the timer already running
    // (other seats' answers bump the version, so decide from the latest view).
    const key = JSON.stringify([view.stage, view.legal]);
    if (this.pending?.key === key) return;
    this.cancel();
    const handle = setTimeout(() => {
      this.pending = null;
      const latest = this.latest!;
      const action = chooseAction(latest, this.skill, this.rng);
      if (action) this.submit(action, latest.version);
    }, this.thinkMs(this.skill));
    this.pending = { handle, key };
  }

  /** Re-plan immediately with a fresh delay (e.g. when fast-forward starts). */
  reset(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.pending) clearTimeout(this.pending.handle);
    this.pending = null;
  }

  dispose(): void {
    this.cancel();
  }
}

/** The local human. Decisions arrive over the socket; timers and 托管 live in the room. */
export class HumanSeat implements SeatController {
  private socket: WebSocket | null = null;

  constructor(readonly info: SeatInfo, readonly playerId: string) {}

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === this.socket.OPEN;
  }

  attach(socket: WebSocket): void {
    this.socket = socket;
  }

  detach(socket?: WebSocket): void {
    if (!socket || socket === this.socket) this.socket = null;
  }

  send(message: ServerMessage): void {
    if (this.connected) this.socket!.send(JSON.stringify(message));
  }

  update({ snapshot, events }: SeatUpdate): void {
    this.send({ type: 'table', table: snapshot, events });
  }

  dispose(): void {
    this.socket = null;
  }
}

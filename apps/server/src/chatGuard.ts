/** Per-player chat rate limits and violation tracking (PRD §7.1). In memory until Phase 3. */
import type { ChatRejection } from '@mahjong/protocol';
import type { ChatLimits } from './dialogueConfig';

interface PlayerChatState {
  sent: number[];
  violations: number[];
  suspendedUntil: number;
}

export class ChatGuard {
  private players = new Map<string, PlayerChatState>();

  constructor(
    private readonly limits: ChatLimits,
    private readonly now: () => number = Date.now,
  ) {}

  private state(playerId: string): PlayerChatState {
    let s = this.players.get(playerId);
    if (!s) this.players.set(playerId, (s = { sent: [], violations: [], suspendedUntil: 0 }));
    return s;
  }

  /** Checks whether the player may send now; records the attempt if allowed. */
  admit(playerId: string): ChatRejection | null {
    const s = this.state(playerId);
    const now = this.now();
    if (now < s.suspendedUntil) return 'suspended';
    s.sent = s.sent.filter((t) => now - t < 60_000);
    const last = s.sent[s.sent.length - 1] ?? -Infinity;
    if (now - last < this.limits.minIntervalMs || s.sent.length >= this.limits.perMinute) return 'rateLimited';
    s.sent.push(now);
    return null;
  }

  /** Records a blocked message; suspends chat after too many in the window. */
  violation(playerId: string): void {
    const s = this.state(playerId);
    const now = this.now();
    s.violations = s.violations.filter((t) => now - t < this.limits.violationWindowMs);
    s.violations.push(now);
    if (s.violations.length >= this.limits.violationsBeforeSuspension) {
      s.suspendedUntil = now + this.limits.suspensionMs;
      s.violations = [];
    }
  }

  isSuspended(playerId: string): boolean {
    return this.now() < this.state(playerId).suspendedUntil;
  }
}

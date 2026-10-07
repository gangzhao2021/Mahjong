/**
 * Stateless session tokens: HMAC-signed {playerId, tokenVersion, issuedAt}.
 * Bumping a player's token_version (logout everywhere, deletion, suspension)
 * invalidates every token issued before.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 90 * 24 * 3_600_000;

export interface SessionClaims {
  playerId: string;
  version: number;
  issuedAt: number;
}

export class SessionTokens {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  sign(playerId: string, version: number): string {
    const body = Buffer.from(JSON.stringify({ p: playerId, v: version, t: this.now() })).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  verify(token: unknown): SessionClaims | null {
    if (typeof token !== 'string' || token.length > 512) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { p, v, t } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (typeof p !== 'string' || typeof v !== 'number' || typeof t !== 'number') return null;
      if (this.now() - t > MAX_AGE_MS) return null;
      return { playerId: p, version: v, issuedAt: t };
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}

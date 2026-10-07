/**
 * The single admin account (PRD §28): username + password from the
 * environment (password stored only as a scrypt hash), TOTP two-factor,
 * optional IP allowlist, login lockout and idle-expiring sessions.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db';

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT = { N: 32768, r: 8, p: 1, keyLength: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238: SHA-1, 6 digits, 30 s steps)
// ---------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '')) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error('Invalid base32 secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 30_000);

export function totpUri(secret: string, account = 'admin', issuer = 'Mahjong Admin'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface AdminAuthConfig {
  username: string;
  passwordHash: string;
  totpSecret: string;
  /** Empty = any address. */
  ipAllowlist: string[];
  idleTimeoutMs: number;
}

export function adminConfigFromEnv(env: NodeJS.ProcessEnv): AdminAuthConfig | null {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_TOTP_SECRET) return null;
  return {
    username: env.ADMIN_USERNAME,
    passwordHash: env.ADMIN_PASSWORD_HASH,
    totpSecret: env.ADMIN_TOTP_SECRET,
    ipAllowlist: (env.ADMIN_IP_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    idleTimeoutMs: 8 * 3_600_000,
  };
}

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

export type LoginFailure = 'invalidCredentials' | 'lockedOut' | 'ipNotAllowed';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class AdminAuth {
  private failures = new Map<string, number[]>();
  private lockedUntil = new Map<string, number>();
  /** TOTP steps already used, so a code cannot be replayed. */
  private usedSteps = new Set<number>();

  constructor(
    private readonly db: Db,
    private readonly config: AdminAuthConfig,
    private readonly now: () => number = Date.now,
  ) {}

  ipAllowed(ip: string): boolean {
    const list = this.config.ipAllowlist;
    return list.length === 0 || list.includes(ip) || list.includes(ip.replace(/^::ffff:/, ''));
  }

  async login(ip: string, username: unknown, password: unknown, code: unknown): Promise<{ token: string } | { error: LoginFailure }> {
    if (!this.ipAllowed(ip)) return { error: 'ipNotAllowed' };
    const now = this.now();
    if ((this.lockedUntil.get(ip) ?? 0) > now) return { error: 'lockedOut' };

    const ok =
      typeof username === 'string' &&
      typeof password === 'string' &&
      typeof code === 'string' &&
      safeEqual(username, this.config.username) &&
      verifyPassword(password, this.config.passwordHash) &&
      this.checkTotp(code, now);
    if (!ok) {
      const recent = (this.failures.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
      recent.push(now);
      this.failures.set(ip, recent);
      if (recent.length >= MAX_FAILURES) {
        this.lockedUntil.set(ip, now + LOCKOUT_MS);
        this.failures.delete(ip);
      }
      return { error: 'invalidCredentials' };
    }

    this.failures.delete(ip);
    const token = randomBytes(32).toString('base64url');
    await this.db.query('INSERT INTO admin_sessions (token_hash, ip, created_at, last_seen_at) VALUES ($1, $2, $3, $3)', [hashToken(token), ip, new Date(now)]);
    return { token };
  }

  private checkTotp(code: string, now: number): boolean {
    const step = totpStep(now);
    for (const s of [step - 1, step, step + 1]) {
      if (!this.usedSteps.has(s) && safeEqual(code, totpCode(this.config.totpSecret, s))) {
        this.usedSteps.add(s);
        for (const old of this.usedSteps) if (old < step - 2) this.usedSteps.delete(old);
        return true;
      }
    }
    return false;
  }

  /** Validates a session and extends its idle timeout. */
  async check(token: string | undefined, ip: string): Promise<boolean> {
    if (!token || !this.ipAllowed(ip)) return false;
    const now = new Date(this.now());
    const cutoff = new Date(this.now() - this.config.idleTimeoutMs);
    const rows = await this.db.query('UPDATE admin_sessions SET last_seen_at = $2 WHERE token_hash = $1 AND last_seen_at > $3 RETURNING token_hash', [hashToken(token), now, cutoff]);
    return rows.length > 0;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)]);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

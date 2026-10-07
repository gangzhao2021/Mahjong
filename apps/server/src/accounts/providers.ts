/**
 * Third-party login verification. Every check happens server-side; the
 * client only forwards the token / code it got from the platform SDK.
 */
import { createHash, randomInt } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Db } from '../db/db';

export class LoginError extends Error {
  constructor(
    readonly code: 'invalidToken' | 'notConfigured' | 'invalidCode' | 'tooManyAttempts' | 'rateLimited' | 'invalidPhone' | 'providerError',
    message?: string,
  ) {
    super(message ?? code);
  }
}

// ---------------------------------------------------------------------------
// Sign in with Apple / Google: verify the ID token's signature, issuer, audience, expiry.
// ---------------------------------------------------------------------------

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyAppleIdToken(idToken: unknown, clientIds: string[], jwks: JWTVerifyGetKey = appleJwks): Promise<{ subject: string }> {
  if (!clientIds.length) throw new LoginError('notConfigured', 'APPLE_CLIENT_IDS is not set');
  if (typeof idToken !== 'string') throw new LoginError('invalidToken');
  try {
    const { payload } = await jwtVerify(idToken, jwks, { issuer: 'https://appleid.apple.com', audience: clientIds });
    if (!payload.sub) throw new Error('no subject');
    return { subject: payload.sub };
  } catch (error) {
    throw new LoginError('invalidToken', `Apple token rejected: ${(error as Error).message}`);
  }
}

export async function verifyGoogleIdToken(idToken: unknown, clientIds: string[], jwks: JWTVerifyGetKey = googleJwks): Promise<{ subject: string }> {
  if (!clientIds.length) throw new LoginError('notConfigured', 'GOOGLE_CLIENT_IDS is not set');
  if (typeof idToken !== 'string') throw new LoginError('invalidToken');
  try {
    const { payload } = await jwtVerify(idToken, jwks, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientIds });
    if (!payload.sub) throw new Error('no subject');
    return { subject: payload.sub };
  } catch (error) {
    throw new LoginError('invalidToken', `Google token rejected: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Apple token revocation — required by the App Store when an account is deleted.
// ---------------------------------------------------------------------------

export interface AppleKeys {
  teamId: string;
  keyId: string;
  /** The .p8 private key (PKCS#8 PEM). */
  privateKey: string;
  clientId: string;
}

export class AppleTokens {
  constructor(
    private readonly keys: AppleKeys,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async clientSecret(): Promise<string> {
    const key = await importPKCS8(this.keys.privateKey, 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.keys.keyId })
      .setIssuer(this.keys.teamId)
      .setSubject(this.keys.clientId)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }

  /** Exchanges the sign-in authorization code for a refresh token (stored for later revocation). */
  async exchange(authorizationCode: string): Promise<string | null> {
    const res = await this.fetchImpl('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.keys.clientId,
        client_secret: await this.clientSecret(),
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { refresh_token?: string };
    return body.refresh_token ?? null;
  }

  async revoke(refreshToken: string): Promise<boolean> {
    const res = await this.fetchImpl('https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.keys.clientId,
        client_secret: await this.clientSecret(),
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });
    return res.ok;
  }
}

// ---------------------------------------------------------------------------
// WeChat login (China build): exchange the app's OAuth code for openid / unionid.
// ---------------------------------------------------------------------------

export async function exchangeWechatCode(
  code: unknown,
  config: { appId: string; secret: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ subject: string }> {
  if (!config) throw new LoginError('notConfigured', 'WECHAT_APP_ID / WECHAT_APP_SECRET are not set');
  if (typeof code !== 'string' || !code) throw new LoginError('invalidCode');
  const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  url.search = new URLSearchParams({ appid: config.appId, secret: config.secret, code, grant_type: 'authorization_code' }).toString();
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  const body = (await res.json()) as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
  if (body.errcode || !body.openid) throw new LoginError('invalidCode', `WeChat: ${body.errmsg ?? 'no openid'}`);
  // unionid is stable across the publisher's apps; fall back to openid.
  return { subject: body.unionid ?? body.openid };
}

// ---------------------------------------------------------------------------
// Phone + SMS code login (China build).
// ---------------------------------------------------------------------------

export interface SmsSender {
  send(phone: string, code: string): Promise<void>;
}

/** Development sender: prints the code to the server log. Never use in production. */
export class ConsoleSmsSender implements SmsSender {
  async send(phone: string, code: string): Promise<void> {
    console.log(`[dev SMS] code for ${phone.slice(0, 3)}****${phone.slice(-4)}: ${code}`);
  }
}

const CODE_TTL_MS = 5 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;

export function normalizeChinaMobile(phone: unknown): string {
  const p = typeof phone === 'string' ? phone.replace(/[\s-]/g, '').replace(/^\+?86/, '') : '';
  if (!/^1[3-9]\d{9}$/.test(p)) throw new LoginError('invalidPhone');
  return p;
}

const hashCode = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest('hex');

export class SmsCodes {
  constructor(
    private readonly db: Db,
    private readonly sender: SmsSender,
    private readonly now: () => number = Date.now,
  ) {}

  async send(rawPhone: unknown): Promise<void> {
    const phone = normalizeChinaMobile(rawPhone);
    const rows = await this.db.query<{ sent_at: Date | string }>('SELECT sent_at FROM sms_codes WHERE phone = $1', [phone]);
    if (rows.length && this.now() - new Date(rows[0].sent_at).getTime() < RESEND_MS) throw new LoginError('rateLimited');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = new Date(this.now());
    await this.db.query(
      `INSERT INTO sms_codes (phone, code_hash, expires_at, attempts, sent_at) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0, sent_at = $4`,
      [phone, hashCode(phone, code), new Date(this.now() + CODE_TTL_MS), now],
    );
    await this.sender.send(phone, code);
  }

  /** Returns the normalized phone number if the code is right; codes are single-use. */
  async verify(rawPhone: unknown, code: unknown): Promise<string> {
    const phone = normalizeChinaMobile(rawPhone);
    const rows = await this.db.query<{ code_hash: string; expires_at: Date | string; attempts: number }>(
      'SELECT code_hash, expires_at, attempts FROM sms_codes WHERE phone = $1',
      [phone],
    );
    const row = rows[0];
    if (!row || new Date(row.expires_at).getTime() < this.now()) throw new LoginError('invalidCode');
    if (row.attempts >= MAX_ATTEMPTS) throw new LoginError('tooManyAttempts');
    if (typeof code !== 'string' || hashCode(phone, code) !== row.code_hash) {
      await this.db.query('UPDATE sms_codes SET attempts = attempts + 1 WHERE phone = $1', [phone]);
      throw new LoginError('invalidCode');
    }
    await this.db.query('DELETE FROM sms_codes WHERE phone = $1', [phone]);
    return phone;
  }
}

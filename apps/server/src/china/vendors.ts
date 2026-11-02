/**
 * Vendor integrations for the China build (Appendix D.2, D.5): SMS and text
 * moderation through Alibaba Cloud, and the national real-name system. Each is
 * switched on by environment variables (see .env.example).
 *
 * None of these has been called against the live service yet: they need the
 * operator's credentials. Test each with the vendor's test tools before launch.
 */
import type { ModerationKind, ModerationResult, Moderator } from '@mahjong/dialogue';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { SmsSender } from '../accounts/providers';
import type { RealNameVerifier } from './compliance';

type Env = Record<string, string | undefined>;
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Alibaba Cloud RPC requests (signature version 1.0, HMAC-SHA1)
// ---------------------------------------------------------------------------

/** RFC 3986, as Alibaba Cloud's signature requires. */
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function aliyunSignature(params: Record<string, string>, secret: string, method = 'POST'): string {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join('&');
  return createHmac('sha1', `${secret}&`).update(`${method}&${encode('/')}&${encode(query)}`).digest('base64');
}

export interface AliyunCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

async function aliyunRpc(baseUrl: string, credentials: AliyunCredentials, action: string, version: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const all: Record<string, string> = {
    ...params,
    Action: action,
    Version: version,
    Format: 'JSON',
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  all.Signature = aliyunSignature(all, credentials.accessKeySecret);
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(all).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return (await res.json()) as Record<string, unknown>;
}

export class AliyunSmsSender implements SmsSender {
  constructor(
    private readonly credentials: AliyunCredentials,
    private readonly signName: string,
    private readonly templateCode: string,
    private readonly baseUrl = 'https://dysmsapi.aliyuncs.com/',
  ) {}

  async send(phone: string, code: string): Promise<void> {
    const reply = await aliyunRpc(this.baseUrl, this.credentials, 'SendSms', '2017-05-25', {
      PhoneNumbers: phone,
      SignName: this.signName,
      TemplateCode: this.templateCode,
      TemplateParam: JSON.stringify({ code }),
    });
    if (reply.Code !== 'OK') throw new Error(`SMS failed: ${String(reply.Code)}`);
  }
}

/** Text moderation 2.0 (TextModeration). A vendor outage is `unavailable`, never held against the player. */
export class AliyunModerator implements Moderator {
  constructor(
    private readonly credentials: AliyunCredentials,
    private readonly baseUrl = 'https://green-cip.cn-shanghai.aliyuncs.com/',
  ) {}

  async check(text: string, kind: ModerationKind): Promise<ModerationResult> {
    try {
      const reply = await aliyunRpc(this.baseUrl, this.credentials, 'TextModeration', '2022-03-02', {
        Service: kind === 'nickname' ? 'nickname_detection' : 'chat_detection',
        ServiceParameters: JSON.stringify({ content: text }),
      });
      if (reply.Code !== 200) throw new Error(`code ${String(reply.Code)}`);
      return (reply.Data as { labels?: string } | undefined)?.labels ? { allowed: false, reason: 'vendor' } : { allowed: true };
    } catch (error) {
      console.error('Moderation service failed:', error instanceof Error ? error.message : error);
      return { allowed: false, reason: 'unavailable' };
    }
  }
}

// ---------------------------------------------------------------------------
// National anti-addiction real-name system (wlc.nppa.gov.cn)
//
// The address, headers and fields follow the published interface. The request
// signature and AES-128-GCM framing follow community integrations, because the
// official signing notes are only in the operator console: check them there.
// ---------------------------------------------------------------------------

export interface NppaConfig {
  appId: string;
  bizId: string;
  /** Hex key from the console. */
  secretKey: string;
  checkUrl?: string;
  queryUrl?: string;
}

const POLLS = 3;
const POLL_MS = 500;

export function nppaEncrypt(body: string, secretKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', Buffer.from(secretKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

export function nppaDecrypt(data: string, secretKey: string): string {
  const raw = Buffer.from(data, 'base64');
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(secretKey, 'hex'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
}

/** SHA-256 of: key, then header names and values sorted by name, then query names and values, then the raw body. */
export function nppaSign(secretKey: string, params: Record<string, string>, body: string): string {
  const joined = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHash('sha256').update(`${secretKey}${joined}${body}`).digest('hex');
}

export class NppaRealNameVerifier implements RealNameVerifier {
  constructor(private readonly config: NppaConfig) {}

  async verify(name: string, idNumber: string): Promise<boolean> {
    // `ai` identifies this check to the system; a hash, so the ID itself is not reused as an identifier.
    const ai = createHash('sha256').update(idNumber).digest('hex').slice(0, 32);
    const body = JSON.stringify({ data: nppaEncrypt(JSON.stringify({ ai, name, idNum: idNumber }), this.config.secretKey) });
    let status = await this.call(this.config.checkUrl ?? 'https://api.wlc.nppa.gov.cn/idcard/authentication/check', 'POST', {}, body);
    // 1 = still being verified: ask a few times, then treat as not verified so the player can retry.
    for (let i = 0; status === 1 && i < POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      status = await this.call(this.config.queryUrl ?? 'https://api2.wlc.nppa.gov.cn/idcard/authentication/query', 'GET', { ai }, '');
    }
    return status === 0;
  }

  private async call(url: string, method: string, query: Record<string, string>, body: string): Promise<number> {
    const headers = { appId: this.config.appId, bizId: this.config.bizId, timestamps: String(Date.now()) };
    const search = new URLSearchParams(query).toString();
    const res = await fetch(search ? `${url}?${search}` : url, {
      method,
      headers: { ...headers, sign: nppaSign(this.config.secretKey, { ...headers, ...query }, body), 'content-type': 'application/json; charset=utf-8' },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const reply = (await res.json()) as { errcode?: number; errmsg?: string; data?: { result?: { status?: number } } };
    if (reply.errcode !== 0) throw new Error(`Real-name system error ${reply.errcode}: ${reply.errmsg}`);
    return reply.data?.result?.status ?? 2;
  }
}

// ---------------------------------------------------------------------------
// Selection from the environment
// ---------------------------------------------------------------------------

function aliyunCredentials(env: Env): AliyunCredentials | null {
  return env.ALIYUN_ACCESS_KEY_ID && env.ALIYUN_ACCESS_KEY_SECRET ? { accessKeyId: env.ALIYUN_ACCESS_KEY_ID, accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET } : null;
}

export function smsSenderFromEnv(env: Env): SmsSender | null {
  const credentials = aliyunCredentials(env);
  return credentials && env.ALIYUN_SMS_SIGN_NAME && env.ALIYUN_SMS_TEMPLATE_CODE ? new AliyunSmsSender(credentials, env.ALIYUN_SMS_SIGN_NAME, env.ALIYUN_SMS_TEMPLATE_CODE, env.ALIYUN_SMS_URL) : null;
}

export function moderatorFromEnv(env: Env): Moderator | null {
  const credentials = aliyunCredentials(env);
  return credentials && env.MODERATION_PROVIDER === 'aliyun' ? new AliyunModerator(credentials, env.ALIYUN_MODERATION_URL) : null;
}

export function realNameFromEnv(env: Env): RealNameVerifier | null {
  return env.NPPA_APP_ID && env.NPPA_BIZ_ID && env.NPPA_SECRET_KEY
    ? new NppaRealNameVerifier({ appId: env.NPPA_APP_ID, bizId: env.NPPA_BIZ_ID, secretKey: env.NPPA_SECRET_KEY, checkUrl: env.NPPA_CHECK_URL, queryUrl: env.NPPA_QUERY_URL })
    : null;
}

/**
 * A production China server must not run on the development stand-ins: one logs
 * SMS codes and another accepts any well-formed ID. ALLOW_DEV_PROVIDERS=1 is for staging.
 */
export function missingChinaProviders(env: Env): string[] {
  if (env.NODE_ENV !== 'production' || env.ALLOW_DEV_PROVIDERS === '1') return [];
  const missing: string[] = [];
  if (!smsSenderFromEnv(env)) missing.push('SMS (ALIYUN_*)');
  if (!realNameFromEnv(env)) missing.push('real-name system (NPPA_*)');
  if (!moderatorFromEnv(env)) missing.push('content moderation (MODERATION_PROVIDER)');
  return missing;
}

/** Vendor adapters against local fake servers: what is sent, and how replies are read. The real services have not been called. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { aliyunSignature, AliyunModerator, AliyunSmsSender, missingChinaProviders, nppaDecrypt, nppaSign, NppaRealNameVerifier } from '../src/china/vendors';
import { createModerator, loadDialogueConfig } from '../src/dialogueConfig';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function fake(reply: (seen: Seen) => unknown): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body };
      seen.push(s);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply(s)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, seen };
}

const credentials = { accessKeyId: 'id', accessKeySecret: 'secret' };
const form = (body: string) => Object.fromEntries(new URLSearchParams(body));

function expectSigned(params: Record<string, string>) {
  const { Signature, ...rest } = params;
  expect(Signature).toBe(aliyunSignature(rest, credentials.accessKeySecret));
}

describe('Alibaba Cloud', () => {
  it('signs per RFC 3986, including characters encodeURIComponent leaves alone', () => {
    expect(aliyunSignature({ a: "(x)'!*" }, 's')).not.toBe(aliyunSignature({ a: 'x' }, 's'));
    expect(aliyunSignature({ b: '2', a: '1' }, 's')).toBe(aliyunSignature({ a: '1', b: '2' }, 's'));
  });

  it('sends the SMS code, and reports vendor errors', async () => {
    const ok = await fake(() => ({ Code: 'OK' }));
    await new AliyunSmsSender(credentials, '签名', 'SMS_1', ok.url).send('13800000000', '123456');
    const params = form(ok.seen[0].body);
    expect(params).toMatchObject({ Action: 'SendSms', PhoneNumbers: '13800000000', SignName: '签名', TemplateCode: 'SMS_1', TemplateParam: '{"code":"123456"}' });
    expectSigned(params);

    const bad = await fake(() => ({ Code: 'isv.BUSINESS_LIMIT_CONTROL' }));
    await expect(new AliyunSmsSender(credentials, '签名', 'SMS_1', bad.url).send('13800000000', '1')).rejects.toThrow('BUSINESS_LIMIT');
  });

  it('moderates text; an outage holds the text back but is not a violation', async () => {
    const pass = await fake(() => ({ Code: 200, Data: { labels: '' } }));
    expect(await new AliyunModerator(credentials, pass.url).check('你好', 'nickname')).toEqual({ allowed: true });
    expect(form(pass.seen[0].body)).toMatchObject({ Action: 'TextModeration', Service: 'nickname_detection' });
    expectSigned(form(pass.seen[0].body));

    const flagged = await fake(() => ({ Code: 200, Data: { labels: 'sexual_content' } }));
    expect(await new AliyunModerator(credentials, flagged.url).check('x', 'playerChat')).toEqual({ allowed: false, reason: 'vendor' });
    const down = await fake(() => ({ Code: 500 }));
    expect(await new AliyunModerator(credentials, down.url).check('x', 'aiLine')).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('runs the free local check first, and only in the China build', async () => {
    const vendor = await fake(() => ({ Code: 200, Data: { labels: '' } }));
    const env = { ALIYUN_ACCESS_KEY_ID: 'id', ALIYUN_ACCESS_KEY_SECRET: 'secret', MODERATION_PROVIDER: 'aliyun', ALIYUN_MODERATION_URL: vendor.url };
    const china = createModerator(loadDialogueConfig('china'), env);
    expect((await china.check('去死吧', 'playerChat')).reason).toBe('blocklist');
    expect(vendor.seen).toHaveLength(0);
    expect((await china.check('你好', 'playerChat')).allowed).toBe(true);
    expect(vendor.seen).toHaveLength(1);
    await createModerator(loadDialogueConfig('global'), env).check('你好', 'playerChat');
    expect(vendor.seen).toHaveLength(1);
  });
});

describe('national real-name system', () => {
  const key = '00112233445566778899aabbccddeeff';
  const config = (url: string) => ({ appId: 'app', bizId: 'biz', secretKey: key, checkUrl: url, queryUrl: `${url}query` });
  const result = (status: number) => ({ errcode: 0, errmsg: 'OK', data: { result: { status, pi: 'x' } } });

  it('encrypts the body and signs the request', async () => {
    const server = await fake(() => result(0));
    expect(await new NppaRealNameVerifier(config(server.url)).verify('张三', '110101199003071234')).toBe(true);
    const { headers, body } = server.seen[0];
    expect(headers).toMatchObject({ appid: 'app', bizid: 'biz' });
    const sent = JSON.parse(nppaDecrypt((JSON.parse(body) as { data: string }).data, key)) as { ai: string; name: string; idNum: string };
    expect(sent).toMatchObject({ name: '张三', idNum: '110101199003071234' });
    expect(sent.ai).toHaveLength(32);
    expect(body).not.toContain('110101199003071234');
    expect(headers.sign).toBe(nppaSign(key, { appId: 'app', bizId: 'biz', timestamps: headers.timestamps as string }, body));
  });

  it('asks again while verification is in progress; failure and errors do not verify', async () => {
    let calls = 0;
    const pending = await fake(() => result(++calls < 3 ? 1 : 0));
    expect(await new NppaRealNameVerifier(config(pending.url)).verify('张三', '110101199003071234')).toBe(true);
    expect(pending.seen[1].method).toBe('GET');
    expect(pending.seen[1].url).toMatch(/^\/query\?ai=[0-9a-f]{32}$/);

    const failed = await fake(() => result(2));
    expect(await new NppaRealNameVerifier(config(failed.url)).verify('张三', '110101199003071234')).toBe(false);
    const error = await fake(() => ({ errcode: 1011, errmsg: 'SYS REQ SIGN ERROR' }));
    await expect(new NppaRealNameVerifier(config(error.url)).verify('张三', '110101199003071234')).rejects.toThrow('1011');
  });
});

describe('production China servers', () => {
  it('refuse the development stand-ins unless staging says so', () => {
    expect(missingChinaProviders({ NODE_ENV: 'production' })).toHaveLength(3);
    expect(missingChinaProviders({ NODE_ENV: 'production', ALLOW_DEV_PROVIDERS: '1' })).toEqual([]);
    expect(missingChinaProviders({})).toEqual([]);
    expect(
      missingChinaProviders({ NODE_ENV: 'production', ALIYUN_ACCESS_KEY_ID: 'a', ALIYUN_ACCESS_KEY_SECRET: 'b', ALIYUN_SMS_SIGN_NAME: 'c', ALIYUN_SMS_TEMPLATE_CODE: 'd', MODERATION_PROVIDER: 'aliyun', NPPA_APP_ID: 'e', NPPA_BIZ_ID: 'f', NPPA_SECRET_KEY: 'g' }),
    ).toEqual([]);
  });
});

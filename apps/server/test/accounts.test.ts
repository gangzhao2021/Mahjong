import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';
import { exchangeWechatCode, LoginError, verifyAppleIdToken, type SmsSender } from '../src/accounts/providers';
import { SessionTokens } from '../src/accounts/tokens';
import { api, guestLogin, startServer } from './helpers';

class CapturingSms implements SmsSender {
  readonly sent: { phone: string; code: string }[] = [];
  async send(phone: string, code: string) {
    this.sent.push({ phone, code });
  }
}

describe('guest accounts', () => {
  it('creates an account with starting coins on first login, and finds it again', async () => {
    const server = await startServer();
    const first = await api(server, 'POST', '/auth/guest', { deviceId: 'device-aaaa-1' });
    expect(first.status).toBe(200);
    expect(first.body.account).toMatchObject({ balance: 20000, providers: ['guest'], isGuest: true });

    const again = await api(server, 'POST', '/auth/guest', { deviceId: 'device-aaaa-1' });
    expect(again.body.account.playerId).toBe(first.body.account.playerId);

    const me = await api(server, 'GET', '/account', undefined, first.body.token);
    expect(me.body.account.playerId).toBe(first.body.account.playerId);
    expect((await api(server, 'GET', '/account', undefined, 'forged.token')).status).toBe(401);

    const ledger = await api(server, 'GET', '/ledger', undefined, first.body.token);
    expect(ledger.body.entries).toMatchObject([{ type: 'startingCoins', amount: 20000, balanceAfter: 20000 }]);
  });

  it('rejects login methods not offered in the region', async () => {
    const global = await startServer();
    expect((await api(global, 'POST', '/auth/phone', { phone: '13800138000', code: '1' })).body).toEqual({ error: 'methodUnavailable' });
    const china = await startServer(undefined, { region: 'china' });
    expect((await api(china, 'POST', '/auth/google', { idToken: 'x' })).body).toEqual({ error: 'methodUnavailable' });
  });
});

describe('linking a guest to Apple / Google (PRD §19)', () => {
  it('upgrades the guest in place, keeping id and coins', async () => {
    const server = await startServer();
    const token = await guestLogin(server, 'device-link-1');
    const linked = await api(server, 'POST', '/account/link/apple', { identityToken: 'alice' }, token);
    expect(linked.status).toBe(200);
    expect(linked.body.account).toMatchObject({ providers: ['guest', 'apple'], isGuest: false, balance: 20000 });

    // Signing in with Apple on a new device lands in the same account.
    const apple = await api(server, 'POST', '/auth/apple', { identityToken: 'alice' });
    expect(apple.body.account.playerId).toBe(linked.body.account.playerId);
  });

  it('refuses to link an identity that already belongs to another account', async () => {
    const server = await startServer();
    await api(server, 'POST', '/auth/google', { idToken: 'bob' }); // bob's own account
    const guest = await guestLogin(server, 'device-link-2');
    const res = await api(server, 'POST', '/account/link/google', { idToken: 'bob' }, guest);
    expect(res).toEqual({ status: 409, body: { error: 'identityInUse' } });
  });
});

describe('phone login (China build)', () => {
  it('verifies an SMS code once, rate-limits resends and stores only a hash of the number', async () => {
    const sms = new CapturingSms();
    const server = await startServer(undefined, { region: 'china', sms });
    expect((await api(server, 'POST', '/auth/sms/send', { phone: '12345' })).body).toEqual({ error: 'invalidPhone' });
    expect((await api(server, 'POST', '/auth/sms/send', { phone: '+86 138-0013-8000' })).status).toBe(200);
    expect((await api(server, 'POST', '/auth/sms/send', { phone: '13800138000' })).body).toEqual({ error: 'rateLimited' });

    const code = sms.sent[0].code;
    expect((await api(server, 'POST', '/auth/phone', { phone: '13800138000', code: code === '000000' ? '111111' : '000000' })).body).toEqual({ error: 'invalidCode' });
    const ok = await api(server, 'POST', '/auth/phone', { phone: '13800138000', code });
    expect(ok.status).toBe(200);
    expect(ok.body.account).toMatchObject({ providers: ['phone'], realName: { required: true, verified: false } });
    // Single use.
    expect((await api(server, 'POST', '/auth/phone', { phone: '13800138000', code })).body).toEqual({ error: 'invalidCode' });

    const ids = await server.services.db.query<{ subject: string }>("SELECT subject FROM identities WHERE provider = 'phone'");
    expect(ids[0].subject).not.toContain('13800138000');
  });
});

describe('profile', () => {
  it('validates and moderates nicknames and avatars', async () => {
    const server = await startServer();
    const token = await guestLogin(server, 'device-profile');
    expect((await api(server, 'PATCH', '/account', { nickname: '雀神阿明', avatar: '🐼', banterLevel: 'mild' }, token)).body.account).toMatchObject({
      nickname: '雀神阿明',
      avatar: '🐼',
      banterLevel: 'mild',
    });
    expect((await api(server, 'PATCH', '/account', { nickname: '傻逼' }, token)).body).toEqual({ error: 'nicknameRejected' });
    expect((await api(server, 'PATCH', '/account', { nickname: 'x' }, token)).body).toEqual({ error: 'invalidNickname' });
    expect((await api(server, 'PATCH', '/account', { avatar: '<img>' }, token)).body).toEqual({ error: 'invalidAvatar' });
  });
});

describe('account deletion (PRD §19)', () => {
  it('removes the account, invalidates sessions and anonymizes the ledger', async () => {
    const server = await startServer();
    const token = await guestLogin(server, 'device-delete');
    const { body } = await api(server, 'GET', '/account', undefined, token);
    expect((await api(server, 'DELETE', '/account', undefined, token)).status).toBe(204);
    expect((await api(server, 'GET', '/account', undefined, token)).status).toBe(401);

    const db = server.services.db;
    expect(await db.query('SELECT 1 FROM players WHERE id = $1', [body.account.playerId])).toEqual([]);
    expect(await db.query('SELECT 1 FROM ledger WHERE player_id = $1', [body.account.playerId])).toEqual([]);
    expect((await db.query<{ player_id: string }>("SELECT player_id FROM ledger WHERE player_id LIKE 'deleted:%'")).length).toBe(1);

    // The same device starts over with a brand-new account.
    const fresh = await api(server, 'POST', '/auth/guest', { deviceId: 'device-delete' });
    expect(fresh.body.account.playerId).not.toBe(body.account.playerId);
  });
});

describe('suspension (PRD §31)', () => {
  it('blocks login until the suspension ends', async () => {
    let now = new Date('2026-10-07T10:00:00Z');
    const server = await startServer(undefined, { now: () => now });
    const token = await guestLogin(server, 'device-suspend');
    await server.services.db.query("UPDATE players SET status = 'suspended', suspended_until = $1", [new Date('2026-10-08T10:00:00Z')]);
    expect((await api(server, 'POST', '/auth/guest', { deviceId: 'device-suspend' })).body).toMatchObject({ error: 'suspended' });
    expect((await api(server, 'GET', '/account', undefined, token)).status).toBe(401);
    now = new Date('2026-10-09T00:00:00Z');
    expect((await api(server, 'POST', '/auth/guest', { deviceId: 'device-suspend' })).status).toBe(200);
  });
});

describe('identity token verification', () => {
  it('accepts a valid Apple ID token and rejects wrong audience or expiry', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
    const token = (aud: string, exp: string) =>
      new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://appleid.apple.com').setAudience(aud).setSubject('001.abc').setIssuedAt().setExpirationTime(exp).sign(privateKey);

    expect(await verifyAppleIdToken(await token('com.example.mahjong', '5m'), ['com.example.mahjong'], jwks)).toEqual({ subject: '001.abc' });
    await expect(verifyAppleIdToken(await token('com.evil.app', '5m'), ['com.example.mahjong'], jwks)).rejects.toBeInstanceOf(LoginError);
    await expect(verifyAppleIdToken(await token('com.example.mahjong', '-1m'), ['com.example.mahjong'], jwks)).rejects.toBeInstanceOf(LoginError);
    await expect(verifyAppleIdToken('x', [], jwks)).rejects.toMatchObject({ code: 'notConfigured' });
  });

  it('exchanges a WeChat code, preferring the unionid', async () => {
    const reply = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    const config = { appId: 'wx1', secret: 's' };
    expect(await exchangeWechatCode('c', config, reply({ openid: 'o1', unionid: 'u1' }))).toEqual({ subject: 'u1' });
    expect(await exchangeWechatCode('c', config, reply({ openid: 'o1' }))).toEqual({ subject: 'o1' });
    await expect(exchangeWechatCode('c', config, reply({ errcode: 40029, errmsg: 'invalid code' }))).rejects.toMatchObject({ code: 'invalidCode' });
  });

  it('session tokens cannot be forged or replayed after expiry', () => {
    let now = 0;
    const tokens = new SessionTokens('x'.repeat(32), () => now);
    const t = tokens.sign('p_1', 0);
    expect(tokens.verify(t)).toMatchObject({ playerId: 'p_1', version: 0 });
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'p_2', v: 0, t: 0 })).toString('base64url');
    expect(tokens.verify(`${forged}.${sig}`)).toBeNull();
    expect(tokens.verify(`${body}.${sig}x`)).toBeNull();
    now = 91 * 24 * 3_600_000;
    expect(tokens.verify(t)).toBeNull();
  });
});

describe('sign-in rate limit', () => {
  it('stops one address from creating accounts in bulk', async () => {
    const server = await startServer();
    for (let i = 0; i < 30; i++) expect((await api(server, 'POST', '/auth/guest', { deviceId: `bulk-device-${i}` })).status).toBe(200);
    const blocked = await api(server, 'POST', '/auth/guest', { deviceId: 'bulk-device-30' });
    expect(blocked).toMatchObject({ status: 429, body: { error: 'rateLimited' } });
  });
});

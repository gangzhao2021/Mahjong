import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/telemetry';
import { api, guestLogin, startServer } from './helpers';

describe('crash reports (PRD §50 Phase 6)', () => {
  it('groups the same error from different builds and lines together', () => {
    const a = fingerprint('TypeError: x is undefined', 'TypeError\n    at render (bundle.js?v=1:10:20)');
    const b = fingerprint('TypeError: x is undefined', 'TypeError\n    at render (bundle.js?v=2:11:5)');
    expect(a).toBe(b);
    expect(fingerprint('TypeError: y is undefined')).not.toBe(a);
  });

  it('accepts reports with or without a session, rejects junk, and rate-limits per IP', async () => {
    const server = await startServer();
    const token = await guestLogin(server, 'crash-device');
    const ok = await api(server, 'POST', '/telemetry/errors', { message: 'Error: boom', stack: 'at x (a.js:1:1)', platform: 'ios', appVersion: '1.0.0' }, token);
    expect(ok.status).toBe(202);
    expect((await api(server, 'POST', '/telemetry/errors', { message: 'Error: boom', stack: 'at x (a.js:9:9)' })).status).toBe(202);
    expect((await api(server, 'POST', '/telemetry/errors', { stack: 'no message' })).status).toBe(429);

    const groups = await server.services.crashes.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ message: 'Error: boom', count: 2, players: 1, platforms: ['ios'], versions: ['1.0.0'] });

    for (let i = 0; i < 18; i++) await api(server, 'POST', '/telemetry/errors', { message: `Error ${i}` });
    expect((await api(server, 'POST', '/telemetry/errors', { message: 'one too many' })).status).toBe(429);
  });
});

describe('legal pages (Appendix C / D.7)', () => {
  it('serves region-specific draft privacy policy, terms and SDK list', async () => {
    const global = await startServer();
    const china = await startServer(undefined, { region: 'china' });
    for (const name of ['privacy', 'terms', 'sdks']) {
      const res = await fetch(`${global.http}/legal/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('草案');
    }
    expect(await (await fetch(`${global.http}/legal/sdks`)).text()).toContain('Claude');
    const chinaSdks = await (await fetch(`${china.http}/legal/sdks`)).text();
    expect(chinaSdks).toContain('实名认证');
    expect(chinaSdks).not.toContain('Claude');
    expect(await (await fetch(`${china.http}/legal/privacy`)).text()).toContain('境内');
  });
});

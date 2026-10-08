import type { ServerMessage } from '@mahjong/protocol';
import { mkdtemp, mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHINA_MIN_LOG_DAYS, RetentionJob, retentionPolicy } from '../src/retention';
import { api, Client, FAST, guestLogin, isTable, startServer } from './helpers';

const DAY = 86_400_000;
const PATIENT = { ...FAST, timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000, discardMs: 60_000, claimMs: 60_000 } };

describe('login and chat logs (Appendix D.6)', () => {
  it('records logins and every table line, including AI lines', async () => {
    const server = await startServer(PATIENT);
    const client = await Client.connect(server);
    const welcome = await client.hello('log-player');
    client.send({ type: 'startGame', options: { private: { handsPerGame: 1, baseScore: 0 } } });
    await client.next(isTable);
    client.send({ type: 'chat', text: '大家好', target: 'table' });
    await client.next((m): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat' && m.entry.kind === 'ai', 15_000);
    await new Promise((r) => setTimeout(r, 100));

    const db = server.services.db;
    const logins = await db.query<{ method: string }>('SELECT method FROM login_events WHERE player_id = $1', [welcome.playerId]);
    expect(logins.map((l) => l.method)).toEqual(['guest']);
    const lines = await db.query<{ kind: string; text: string | null; speaker: string }>('SELECT kind, text, speaker FROM chat_log WHERE player_id = $1 ORDER BY id', [welcome.playerId]);
    expect(lines.some((l) => l.kind === 'player' && l.text === '大家好')).toBe(true);
    expect(lines.some((l) => l.kind === 'ai' && l.text && l.speaker)).toBe(true);
  });

  it('keeps China logs for at least 6 months whatever the configuration says', () => {
    expect(retentionPolicy('china', { RETENTION_CHAT_DAYS: '30', RETENTION_LOGIN_DAYS: '10' })).toMatchObject({ chatLogDays: CHINA_MIN_LOG_DAYS, loginLogDays: CHINA_MIN_LOG_DAYS });
    expect(retentionPolicy('global', { RETENTION_CHAT_DAYS: '30' }).chatLogDays).toBe(30);
    expect(retentionPolicy('global', {}).chatLogDays).toBe(90);
  });

  it('purges only what is past its retention period, including old hand log files', async () => {
    const server = await startServer();
    const db = server.services.db;
    const now = Date.now();
    const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
    for (const days of [10, 200]) {
      await db.query("INSERT INTO chat_log (player_id, game_id, seat, kind, speaker, text, created_at) VALUES ('p', 'g', 0, 'player', 'x', 'hi', $1)", [at(days)]);
      await db.query("INSERT INTO login_events (player_id, method, created_at) VALUES ('p', 'guest', $1)", [at(days)]);
      await db.query("INSERT INTO client_errors (fingerprint, message, created_at) VALUES ('f', 'e', $1)", [at(days)]);
    }
    await db.query("INSERT INTO moderation_events (kind, text, status, created_at) VALUES ('blockedPlayerMessage', 'x', 'open', $1), ('blockedPlayerMessage', 'y', 'resolved', $1)", [at(200)]);

    const dir = await mkdtemp(path.join(tmpdir(), 'mahjong-retention-'));
    await mkdir(path.join(dir, 'hands'));
    for (const [name, days] of [['old-0.json', 200], ['new-0.json', 5]] as const) {
      const file = path.join(dir, 'hands', name);
      await writeFile(file, '{}');
      await utimes(file, at(days), at(days));
    }

    const job = new RetentionJob(db, retentionPolicy('china', {}), dir, () => new Date(now));
    const counts = await job.runOnce();
    expect(counts).toMatchObject({ chatLog: 1, loginLog: 1, clientErrors: 1, moderation: 1, handLogs: 1 });
    expect(await db.query('SELECT 1 FROM chat_log')).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM moderation_events WHERE status = 'open'")).toHaveLength(1);
    expect(await readdir(path.join(dir, 'hands'))).toEqual(['new-0.json']);
  });

  it('deletes a player’s logs with the account in the global build, but keeps them in China', async () => {
    for (const region of ['global', 'china'] as const) {
      const server = await startServer(FAST, { region });
      const token = await guestLogin(server, `delete-${region}`);
      expect((await api(server, 'DELETE', '/account', undefined, token)).status).toBe(204);
      const left = await server.services.db.query('SELECT 1 FROM login_events');
      expect(left.length, region).toBe(region === 'china' ? 1 : 0);
    }
  });
});

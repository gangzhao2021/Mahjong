import type { TasksStatus } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { api, Client, FAST, gameOver, guestLogin, playAsBot, startServer } from './helpers';

describe('daily tasks and achievements', () => {
  it('counts finished hands, pays a finished task once, and pays an achievement once', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const token = await guestLogin(server, 'device-tasks');
    const client = await Client.connect(server);
    const { playerId: id } = await client.helloWithToken(token);
    playAsBot(client);
    client.send({ type: 'startGame', options: { private: { handsPerGame: 2, baseScore: 0 } } });
    await client.next(gameOver);
    await new Promise((r) => setTimeout(r, 300));

    const before = await api<TasksStatus>(server, 'GET', '/tasks', undefined, token);
    expect(before.body.daily.find((d) => d.id === 'playHands')).toMatchObject({ progress: 2, target: 4, claimed: false });
    // Not finished yet.
    expect((await api(server, 'POST', '/tasks/claim', { kind: 'daily', id: 'playHands' }, token)).status).toBe(409);

    // Finish it as if two more hands were played.
    await server.services.db.query("UPDATE player_tasks SET progress = 4 WHERE player_id = $1 AND task_id = 'playHands'", [id]);
    const balance = await server.services.wallet.balance(id);
    const claimed = await api<{ amount: number; tasks: TasksStatus }>(server, 'POST', '/tasks/claim', { kind: 'daily', id: 'playHands' }, token);
    expect(claimed.status).toBe(200);
    expect(claimed.body.amount).toBe(200);
    expect(await server.services.wallet.balance(id)).toBe(balance + 200);
    expect((await api(server, 'POST', '/tasks/claim', { kind: 'daily', id: 'playHands' }, token)).status).toBe(409);

    // Achievements: unearned ones cannot be claimed; earned ones pay once.
    expect((await api(server, 'POST', '/tasks/claim', { kind: 'achievement', id: 'wins50' }, token)).status).toBe(409);
    await server.services.db.query("INSERT INTO player_achievements (player_id, achievement_id) VALUES ($1, 'qiDui') ON CONFLICT DO NOTHING", [id]);
    const ach = await api<{ amount: number }>(server, 'POST', '/tasks/claim', { kind: 'achievement', id: 'qiDui' }, token);
    expect(ach.body.amount).toBe(800);
    expect((await api(server, 'POST', '/tasks/claim', { kind: 'achievement', id: 'qiDui' }, token)).status).toBe(409);
    expect((await api(server, 'POST', '/tasks/claim', { kind: 'nonsense', id: 'x' }, token)).status).toBe(400);
  });
});

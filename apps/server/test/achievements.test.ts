import type { AchievementsStatus, ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { api, Client, FAST, gameOver, guestLogin, playAsBot, startServer } from './helpers';

describe('achievements and the login reward', () => {
  it('pays earned achievements automatically and only once', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const token = await guestLogin(server, 'device-achievements');
    const client = await Client.connect(server);
    const { playerId: id } = await client.helloWithToken(token);
    playAsBot(client);
    client.send({ type: 'startGame', options: { private: { handsPerGame: 2, baseScore: 0 } } });
    await client.next(gameOver);
    // Let the end-of-hand work (memory, achievements, payouts) finish.
    await Promise.all([...server.lobby.settling]);

    // Anything earned during the game was paid without a claim.
    const status = await api<AchievementsStatus>(server, 'GET', '/achievements', undefined, token);
    for (const a of status.body.achievements) if (a.unlockedAt !== null) expect(a.claimed).toBe(true);
    // Nothing earned, nothing to claim; a manual claim only pays what is earned and unpaid, once.
    expect((await api(server, 'POST', '/achievements/claim', { id: 'wins50' }, token)).status).toBe(409);
    await server.services.db.query("INSERT INTO player_achievements (player_id, achievement_id) VALUES ($1, 'qiDui') ON CONFLICT DO NOTHING", [id]);
    const balance = await server.services.wallet.balance(id);
    const paid = await api<{ amount: number }>(server, 'POST', '/achievements/claim', { id: 'qiDui' }, token);
    expect(paid.body.amount).toBe(800);
    expect(await server.services.wallet.balance(id)).toBe(balance + 800);
    expect((await api(server, 'POST', '/achievements/claim', { id: 'qiDui' }, token)).status).toBe(409);
    expect((await api(server, 'POST', '/achievements/claim', {}, token)).status).toBe(400);
  });

  it('pays the login reward on the first connection of the day, without a button', async () => {
    const server = await startServer({ ...FAST, autoLoginReward: true });
    const token = await guestLogin(server, 'device-login-reward');
    const first = await Client.connect(server);
    const welcome = await first.helloWithToken(token);
    const reward = await first.next((m): m is Extract<ServerMessage, { type: 'rewards' }> => m.type === 'rewards');
    expect(reward.items).toEqual([{ kind: 'login', id: 'login', amount: expect.any(Number) }]);
    expect(reward.balance).toBe(20000 + reward.items[0].amount);
    expect(welcome.account.reward.claimable).toBe(false);

    // A second connection the same day gets nothing more.
    const second = await Client.connect(server);
    await second.helloWithToken(token);
    await new Promise((r) => setTimeout(r, 200));
    expect(second.messages.some((m) => m.type === 'rewards')).toBe(false);
  });
});

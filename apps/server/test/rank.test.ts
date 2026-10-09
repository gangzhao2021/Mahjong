import type { AccountSummary, ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { isRanked, placement, rankAfter, rankInfo } from '../src/economy/rank';
import { api, Client, FAST, gameOver, guestLogin, playAsBot, startServer } from './helpers';

describe('rank rules', () => {
  it('places by final totals, ties sharing the better place', () => {
    expect(placement([10, -5, -5, 0], 0)).toBe(1);
    expect(placement([10, -5, -5, 0], 1)).toBe(3);
    expect(placement([10, -5, -5, 0], 2)).toBe(3);
  });

  it('scales by stakes and never drops below the tier reached', () => {
    expect(rankAfter(0, 1, 'low')).toBe(40);
    expect(rankAfter(0, 1, 'high')).toBe(80);
    expect(rankAfter(0, 4, 'low')).toBe(0);
    expect(rankAfter(310, 4, 'mid')).toBe(300);
    expect(rankInfo(310)).toEqual({ tier: 'adept', points: 310, tierMin: 300, nextAt: 800 });
    expect(rankInfo(5000).nextAt).toBeNull();
  });

  it('only counts public tables that settle coins', () => {
    expect(isRanked({ kind: 'public', tableId: 'low', name: '', baseScore: 10, multiplier: 1 })).toBe(true);
    expect(isRanked({ kind: 'public', tableId: 'practice', name: '', baseScore: 0, multiplier: 0 })).toBe(false);
    expect(isRanked({ kind: 'private', name: '', baseScore: 10, multiplier: 1 })).toBe(false);
  });
});

describe('ranked games', () => {
  it('reports the rank change at the end of a public game and shows it on the account', async () => {
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, discardMs: 5_000, claimMs: 5_000, swapMs: 5_000, dingqueMs: 5_000 } });
    const token = await guestLogin(server, 'device-rank');
    const client = await Client.connect(server);
    await client.helloWithToken(token);
    playAsBot(client);
    client.send({ type: 'startGame', options: { tableId: 'low' } });
    await client.next(gameOver);
    const msg = await client.next((m): m is Extract<ServerMessage, { type: 'rank' }> => m.type === 'rank');
    expect(msg.result.place).toBeGreaterThanOrEqual(1);
    expect(msg.result.after.points).toBe(msg.result.before.points + msg.result.change);

    const account = await api<{ account: AccountSummary }>(server, 'GET', '/account', undefined, token);
    expect(account.body.account.rank.points).toBe(msg.result.after.points);
  });
});

import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { Client, FAST, isTable, startServer } from './helpers';

const CJK = /[一-鿿]/;
const aiChat = (m: ServerMessage): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat' && m.entry.kind === 'ai' && !!m.entry.text;

describe('English tables', () => {
  it('uses English character names, chat catalog and AI lines for an English player', async () => {
    // The human seat waits, so the table has time to talk.
    const server = await startServer({ ...FAST, timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000, discardMs: 60_000, claimMs: 60_000 } });
    const client = await Client.connect(server);
    const welcome = await client.hello('english-player', 'en');
    expect(welcome.catalog.quickPhrases.every((q) => !CJK.test(q.text))).toBe(true);
    expect(welcome.catalog.stickers.every((s) => !CJK.test(s.label))).toBe(true);

    client.send({ type: 'startGame', options: { private: { handsPerGame: 1, baseScore: 0 } } });
    const table = (await client.next(isTable)).table;
    for (const seat of table.seats.filter((s) => !s.isHuman)) {
      expect(seat.name).not.toMatch(CJK);
      expect(seat.personality).not.toMatch(CJK);
    }
    client.send({ type: 'quickPhrase', id: 'nice' });
    const mine = await client.next((m): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat' && m.entry.kind === 'quickPhrase');
    expect(mine.entry.text).toBe('Nicely played!');
    const reply = await client.next(aiChat, 15_000);
    expect(reply.entry.text).not.toMatch(CJK);
  });

  it('keeps the China build in Chinese whatever the client asks for', async () => {
    const server = await startServer(FAST, { region: 'china' });
    const client = await Client.connect(server);
    const welcome = await client.hello('china-en', 'en');
    expect(welcome.catalog.quickPhrases.some((q) => CJK.test(q.text))).toBe(true);
  });

  it('serves English legal pages for the global build only', async () => {
    const global = await startServer();
    const china = await startServer(FAST, { region: 'china' });
    const en = await (await fetch(`${global.http}/legal/privacy?lang=en`)).text();
    expect(en).toContain('Privacy Policy');
    expect(en).toContain('[DRAFT]');
    expect(await (await fetch(`${china.http}/legal/privacy?lang=en`)).text()).toContain('隐私政策');
  });
});

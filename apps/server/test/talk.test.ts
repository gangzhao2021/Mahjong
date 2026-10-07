import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_QUICK_PHRASES, LocalModerator, type DialogueReply, type DialogueRequest, type Speaker } from '@mahjong/dialogue';
import { createRng, DEFAULT_RULESET, createHand, viewFor, type Seat } from '@mahjong/engine';
import type { ChatEntry, ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
import { createLlmProvider, loadDialogueConfig } from '../src/dialogueConfig';
import { AnthropicLlm } from '../src/llm/anthropic';
import type { LlmProvider } from '../src/llm/provider';
import { TableTalk } from '../src/talk';
import { Client, FAST, isTable, startServer } from './helpers';

class FakeLlm implements LlmProvider {
  readonly name = 'fake';
  readonly requests: DialogueRequest[] = [];
  constructor(private readonly reply: (req: DialogueRequest) => DialogueReply | null = () => ({ text: '你好呀', target: '0', sticker: 'none' })) {}
  async generate(req: DialogueRequest): Promise<DialogueReply | null> {
    this.requests.push(req);
    return this.reply(req);
  }
}

type ChatMsg = Extract<ServerMessage, { type: 'chat' }>;
type Rejected = Extract<ServerMessage, { type: 'chatRejected' }>;
const isChat = (pred: (e: ChatEntry) => boolean) => (m: ServerMessage): m is ChatMsg => m.type === 'chat' && pred(m.entry);
const isRejected = (m: ServerMessage): m is Rejected => m.type === 'chatRejected';

/** AIs think slowly here so the table stays still while we chat. */
const CALM = { ...FAST, timers: { ...FAST.timers, swapMs: 60_000, dingqueMs: 60_000 }, ai: { minDelayMs: 60_000, maxDelayMs: 60_001, beginnerExtraMs: 0 } };

async function joinGame(llm: LlmProvider, device = 'device-chat-1', dialogue = loadDialogueConfig('global')) {
  const server = await startServer(CALM, { llm, dialogue });
  const client = await Client.connect(server);
  const welcome = await client.hello(device);
  client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 1 } } });
  const table = await client.next(isTable);
  return { server, client, welcome, table };
}

describe('AI characters', () => {
  it('seats persistent characters from the roster with their personality', async () => {
    const { table, welcome } = await joinGame(new FakeLlm());
    const ai = table.table.seats.filter((s) => !s.isHuman);
    expect(ai).toHaveLength(3);
    for (const s of ai) expect(s.personality).toBeTruthy();
    expect(welcome.banterLevel).toBe('spicy');
    expect(welcome.catalog.quickPhrases).toEqual(DEFAULT_QUICK_PHRASES.map(({ id, text }) => ({ id, text })));
    expect(welcome.catalog.stickers.length).toBeGreaterThan(5);
  });
});

describe('player chat (PRD §7.1)', () => {
  it('reaches the addressed character, who answers through the LLM', async () => {
    const llm = new FakeLlm();
    const { client } = await joinGame(llm);
    client.send({ type: 'chat', text: '老板你今天手气怎么样？', target: 2 });

    const echo = await client.next(isChat((e) => e.kind === 'player'));
    expect(echo.entry).toMatchObject({ seat: 0, text: '老板你今天手气怎么样？', target: 2 });
    const reply = await client.next(isChat((e) => e.kind === 'ai' && e.seat === 2 && e.text === '你好呀'));
    expect(reply.entry.target).toBe(0);

    const req = llm.requests.find((r) => r.user.includes('<player_message>'))!;
    expect(req.tier).toBe('highValue');
    expect(req.user).toContain('老板你今天手气怎么样？');
    expect(req.user + req.system).not.toMatch(/[1-9][万条筒]/); // no tiles of any hand
  });

  it('blocks abusive messages before anyone sees them, then suspends repeat offenders', async () => {
    const llm = new FakeLlm();
    const dialogue = loadDialogueConfig('global');
    dialogue.chat = { ...dialogue.chat, minIntervalMs: 0, perMinute: 100, violationsBeforeSuspension: 3 };
    const { client } = await joinGame(llm, 'device-chat-2', dialogue);

    for (let i = 0; i < 2; i++) {
      client.send({ type: 'chat', text: '去死吧' });
      expect((await client.next(isRejected)).reason).toBe('blocked');
    }
    client.send({ type: 'chat', text: '你 去 死' });
    expect((await client.next(isRejected)).reason).toBe('suspended');
    client.send({ type: 'chat', text: '你好' });
    expect((await client.next(isRejected)).reason).toBe('suspended');

    expect(client.messages.some((m) => m.type === 'chat' && m.entry.kind === 'player')).toBe(false);
    expect(llm.requests.some((r) => r.user.includes('去死'))).toBe(false);
  });

  it('rate-limits rapid messages', async () => {
    const { client } = await joinGame(new FakeLlm(), 'device-chat-3');
    client.send({ type: 'chat', text: '第一句' });
    client.send({ type: 'chat', text: '第二句' });
    expect((await client.next(isRejected)).reason).toBe('rateLimited');
  });

  it('quick phrases and stickers are shown at the table', async () => {
    const dialogue = loadDialogueConfig('global');
    dialogue.chat = { ...dialogue.chat, minIntervalMs: 0 };
    const { client } = await joinGame(new FakeLlm(), 'device-chat-4', dialogue);
    client.send({ type: 'quickPhrase', id: 'hurry' });
    expect((await client.next(isChat((e) => e.kind === 'quickPhrase'))).entry.text).toBe(DEFAULT_QUICK_PHRASES[0].text);
    client.send({ type: 'sticker', id: 'laugh' });
    expect((await client.next(isChat((e) => e.kind === 'sticker'))).entry.sticker).toBe('laugh');
  });

  it('"quiet" banter answers with templates only — no LLM calls', async () => {
    const llm = new FakeLlm();
    const server = await startServer(CALM, { llm });
    const client = await Client.connect(server);
    await client.hello('device-quiet');
    client.send({ type: 'setBanter', level: 'quiet' });
    await client.next((m): m is Extract<ServerMessage, { type: 'banter' }> => m.type === 'banter');
    client.send({ type: 'startGame', options: { private: { baseScore: 0, handsPerGame: 1 } } });
    await client.next(isTable);
    client.send({ type: 'chat', text: '你们好', target: 1 });
    await client.next(isChat((e) => e.kind === 'ai' && e.seat === 1));
    expect(llm.requests).toHaveLength(0);

    // The setting is remembered for the player.
    const again = await Client.connect(server);
    expect((await again.hello('device-quiet')).banterLevel).toBe('quiet');
  });
});

describe('TableTalk', () => {
  it('drops an LLM line that arrives after its moment has passed (PRD §6.4)', async () => {
    let release!: (r: DialogueReply) => void;
    const slow: LlmProvider = { name: 'slow', generate: () => new Promise((r) => (release = r)) };
    let version = 0;
    const hand = createHand({ ruleSet: DEFAULT_RULESET, baseScore: 1, seed: 1, dealer: 0 });
    const emitted: ChatEntry[] = [];
    const speakers: Speaker[] = ([1, 2, 3] as Seat[]).map((seat) => ({
      seat,
      character: { id: `c${seat}`, name: `C${seat}`, avatar: '🙂', personalityId: 'p', weight: 1, enabled: true },
      personality: {
        id: 'p', name: 'p', description: '', systemPrompt: '', conversationStyle: '',
        trashTalk: 0.5, talkFrequency: 0, bluffTendency: 0, stickerTendency: 0, stickers: [], weight: 1, enabled: true,
      },
    }));
    const talk = new TableTalk({
      speakers,
      humanSeat: 0,
      settings: loadDialogueConfig('global').settings,
      idleEveryDiscards: 100,
      llm: slow,
      moderator: new LocalModerator(),
      rng: createRng(1),
      level: () => 'spicy',
      nameOf: (s) => `P${s}`,
      viewFor: (s) => viewFor(hand, s),
      version: () => version,
      handIndex: () => 0,
      emit: (e) => emitted.push(e),
    });
    talk.onPlayerChat('在吗？', 1);
    expect(emitted.map((e) => e.kind)).toEqual(['player']);
    version += 20; // the game moved on
    release({ text: '在的', target: '0', sticker: 'none' });
    await Promise.all([...talk.pending]);
    await new Promise((r) => setTimeout(r, 50));
    expect(emitted.map((e) => e.kind)).toEqual(['player']);
    talk.dispose();
  });
});

describe('Claude provider request shape', () => {
  function stubClient(result: unknown) {
    const calls: { params: Record<string, unknown>; options: unknown }[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>, options: unknown) => {
            calls.push({ params, options });
            if (result instanceof Error) throw result;
            return result;
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }
  const req = (tier: DialogueRequest['tier']): DialogueRequest => ({ tier, system: 'SYSTEM', user: 'USER' });
  const ok = { stop_reason: 'end_turn', parsed_output: { text: '好', target: 'table', sticker: 'none' } };

  it('routine lines use the small model with a cached system prompt', async () => {
    const { client, calls } = stubClient(ok);
    const llm = new AnthropicLlm({ routine: 'claude-haiku-4-5', highValue: 'claude-opus-5-5' }, 5000, client);
    expect(await llm.generate(req('routine'))).toEqual(ok.parsed_output);
    const p = calls[0].params;
    expect(p.model).toBe('claude-haiku-4-5');
    expect(p.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(p).not.toHaveProperty('fallbacks');
    expect((p.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(calls[0].options).toEqual({ timeout: 5000 });
  });

  it('high-value lines use the larger model at low effort with refusal fallbacks', async () => {
    const { client, calls } = stubClient(ok);
    const llm = new AnthropicLlm({ routine: 'claude-haiku-4-5', highValue: 'claude-opus-5-5' }, 5000, client);
    await llm.generate(req('highValue'));
    const p = calls[0].params;
    expect(p.model).toBe('claude-opus-5-5');
    expect((p.output_config as Record<string, unknown>).effort).toBe('low');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('a refusal yields no line', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', parsed_output: null });
    expect(await new AnthropicLlm({ routine: 'a', highValue: 'b' }, 1000, client).generate(req('routine'))).toBeNull();
  });

  it('bad credentials disable the provider instead of retrying every line', async () => {
    const error = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
    const { client, calls } = stubClient(error);
    const llm = new AnthropicLlm({ routine: 'a', highValue: 'b' }, 1000, client);
    expect(await llm.generate(req('routine'))).toBeNull();
    expect(await llm.generate(req('routine'))).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('regional config (Appendix D.4)', () => {
  it('the China build defaults to mild banter and caps trash talk', () => {
    const china = loadDialogueConfig('china');
    expect(china.defaultBanter).toBe('mild');
    expect(china.settings.trashTalkIntensity).toBeLessThanOrEqual(0.4);
    expect(loadDialogueConfig('global').defaultBanter).toBe('spicy');
  });

  it('falls back to template-only dialogue when no provider can be configured', () => {
    expect(createLlmProvider(loadDialogueConfig('china'), {}).name).toBe('none');
    expect(createLlmProvider(loadDialogueConfig('global'), { LLM_PROVIDER: 'none' }).name).toBe('none');
    expect(createLlmProvider(loadDialogueConfig('china'), { LLM_API_KEY: 'k' }).name).toBe('openai-compatible');
  });
});

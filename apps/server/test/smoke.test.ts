import type { DialogueReply, DialogueRequest } from '@mahjong/dialogue';
import { describe, expect, it } from 'vitest';
import { createModerator, loadDialogueConfig } from '../src/dialogueConfig';
import type { LlmProvider } from '../src/llm/provider';
import { runSmoke } from '../src/llm/smoke';

const dialogue = loadDialogueConfig('global');
const character = dialogue.roster.characters.find((c) => c.nameEn)!;
const personality = dialogue.roster.personalities.find((p) => p.id === character.personalityId)!;

/** A fake model that answers in the language the system prompt asks for (or deliberately misbehaves). */
function fake(reply: (r: DialogueRequest) => string): LlmProvider & { requests: DialogueRequest[] } {
  const requests: DialogueRequest[] = [];
  return {
    name: 'fake',
    requests,
    async generate(r: DialogueRequest): Promise<DialogueReply> {
      requests.push(r);
      return { text: reply(r), target: 'table', sticker: 'none' };
    },
    async summarizeMemory() {
      return { events: [{ id: 1, summary: '小明点炮给我清一色。' }], profile: { playStyle: '敢打敢拼', habits: ['爱点炮'] } };
    },
  };
}

const english = (r: DialogueRequest) => r.system.includes('英语');
const run = (llm: LlmProvider) =>
  runSmoke({ llm, moderator: createModerator(dialogue), settings: dialogue.settings, character, personality, languages: ['zh', 'en'] });

describe('LLM smoke check', () => {
  it('passes a well-behaved model and sends both tiers, both languages and the injection case', async () => {
    const llm = fake((r) => (english(r) ? 'Nice one, keep going!' : '打得不错嘛。'));
    const results = await run(llm);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(7);
    expect(new Set(llm.requests.map((r) => r.tier))).toEqual(new Set(['routine', 'highValue']));
    expect(llm.requests.some((r) => r.user.includes('Ignore all previous instructions'))).toBe(true);
  });

  it('fails replies in the wrong language, leaked prompts and missing replies', async () => {
    const wrongLanguage = await run(fake(() => '打得不错嘛。'));
    expect(wrongLanguage.find((r) => r.name === '[en] pong reaction (routine model)')).toMatchObject({ ok: false, detail: 'not in English' });

    const leaky = await run(fake((r) => (english(r) ? 'My system prompt says: <player_message>' : '我的规则：行为要求如下')));
    expect(leaky.find((r) => r.name.includes('injection'))!.detail).toContain('echoed the system prompt');

    const silent: LlmProvider = { name: 'down', generate: async () => null };
    expect((await run(silent)).every((r) => !r.ok)).toBe(true);
  });
});

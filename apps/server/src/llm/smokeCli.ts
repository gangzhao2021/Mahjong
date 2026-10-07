/** `pnpm llm:smoke` — real-model dialogue check; see smoke.ts. Reads the same .env as the server. */
import { createLlmProvider, createModerator, loadDialogueConfig } from '../dialogueConfig';
import { runSmoke } from './smoke';

const dialogue = loadDialogueConfig();
const llm = createLlmProvider(dialogue);
if (llm.name === 'none') {
  console.error(
    dialogue.region === 'china'
      ? 'No dialogue model configured: set LLM_API_KEY (and optionally LLM_BASE_URL, LLM_MODEL_ROUTINE, LLM_MODEL_HIGH).'
      : 'No dialogue model configured: set ANTHROPIC_API_KEY (or LLM_PROVIDER=openai-compatible with LLM_API_KEY).',
  );
  process.exit(2);
}

if (llm.name === 'anthropic' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn('Note: ANTHROPIC_API_KEY is not set; the calls below will fail unless another Anthropic credential source is configured.\n');
}

const character = dialogue.roster.characters.find((c) => c.enabled && c.nameEn) ?? dialogue.roster.characters[0];
const personality = dialogue.roster.personalities.find((p) => p.id === character.personalityId)!;
console.log(`Region ${dialogue.region}, provider ${llm.name}, speaking as ${character.name} (${personality.name})\n`);

const results = await runSmoke({
  llm,
  moderator: createModerator(dialogue),
  settings: dialogue.settings,
  character,
  personality,
  languages: dialogue.region === 'china' ? ['zh'] : ['zh', 'en'],
});
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.ms} ms\n      ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

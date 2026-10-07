/**
 * Loads Phase 2 conversation config from apps/server/config/*.json (moves to
 * the admin dashboard in Phase 5) and picks the LLM provider for the region.
 */
import {
  DEFAULT_BLOCKLIST,
  DEFAULT_QUICK_PHRASES,
  LocalModerator,
  validateRoster,
  type BanterLevel,
  type Character,
  type DialogueSettings,
  type Moderator,
  type Personality,
  type QuickPhrase,
  type Roster,
} from '@mahjong/dialogue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicLlm } from './llm/anthropic';
import { OpenAiCompatibleLlm } from './llm/openaiCompatible';
import { BudgetedLlm, NoLlm, type LlmProvider } from './llm/provider';

export type Region = 'global' | 'china';

export interface ChatLimits {
  maxLength: number;
  minIntervalMs: number;
  perMinute: number;
  violationsBeforeSuspension: number;
  violationWindowMs: number;
  suspensionMs: number;
}

export interface DialogueConfig {
  region: Region;
  roster: Roster;
  settings: DialogueSettings;
  idleEveryDiscards: number;
  chat: ChatLimits;
  quickPhrases: QuickPhrase[];
  defaultBanter: BanterLevel;
  llm: { routineModel: string; highValueModel: string; timeoutMs: number; dailyRequestCap: number };
  blocklist: string[];
}

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(CONFIG_DIR, file), 'utf8')) as T;
}

export function loadDialogueConfig(region: Region = (process.env.REGION as Region) ?? 'global'): DialogueConfig {
  const roster: Roster = {
    personalities: readJson<Personality[]>('personalities.json'),
    characters: readJson<Character[]>('characters.json'),
  };
  const problems = validateRoster(roster);
  if (problems.length) throw new Error(`Invalid AI roster:\n${problems.join('\n')}`);

  const file = readJson<{
    settings: DialogueSettings;
    idleEveryDiscards: number;
    chat: ChatLimits;
    llm: DialogueConfig['llm'];
    extraBlocklist: string[];
    quickPhrases?: QuickPhrase[];
  }>('dialogue.json');

  const settings = regionalSettings(file.settings, region);
  return {
    region,
    roster,
    settings,
    idleEveryDiscards: file.idleEveryDiscards,
    chat: file.chat,
    quickPhrases: file.quickPhrases ?? DEFAULT_QUICK_PHRASES,
    defaultBanter: region === 'china' ? 'mild' : 'spicy',
    llm: file.llm,
    blocklist: [...DEFAULT_BLOCKLIST, ...file.extraBlocklist],
  };
}

/** Appendix D.4: toned-down banter in the China build, whatever the admin sets. */
export function regionalSettings(settings: DialogueSettings, region: Region): DialogueSettings {
  if (region !== 'china') return { ...settings };
  return {
    ...settings,
    trashTalkIntensity: Math.min(settings.trashTalkIntensity, 0.4),
    sarcasmIntensity: Math.min(settings.sarcasmIntensity, 0.4),
  };
}

/**
 * LLM_PROVIDER = anthropic | openai-compatible | none. Defaults: Claude for the
 * global build, the domestic OpenAI-compatible endpoint for China, and
 * template-only dialogue when the provider cannot be configured.
 */
export function createLlmProvider(config: DialogueConfig, env = process.env): LlmProvider {
  const choice = env.LLM_PROVIDER ?? (config.region === 'china' ? 'openai-compatible' : 'anthropic');
  let provider: LlmProvider;
  try {
    if (choice === 'anthropic') {
      provider = new AnthropicLlm(
        { routine: env.LLM_MODEL_ROUTINE ?? config.llm.routineModel, highValue: env.LLM_MODEL_HIGH ?? config.llm.highValueModel },
        config.llm.timeoutMs,
      );
    } else if (choice === 'openai-compatible') {
      if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is not set');
      provider = new OpenAiCompatibleLlm({
        baseUrl: env.LLM_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: env.LLM_API_KEY,
        routineModel: env.LLM_MODEL_ROUTINE ?? 'qwen-turbo',
        highValueModel: env.LLM_MODEL_HIGH ?? 'qwen-plus',
        timeoutMs: config.llm.timeoutMs,
      });
    } else {
      provider = new NoLlm();
    }
  } catch (error) {
    console.warn(`LLM provider "${choice}" unavailable (${error instanceof Error ? error.message : error}); AI will use template lines.`);
    provider = new NoLlm();
  }
  return provider.name === 'none' ? provider : new BudgetedLlm(provider, config.llm.dailyRequestCap);
}

export function createModerator(config: DialogueConfig): Moderator {
  // Vendor moderation (Appendix D.5) chains after the local blocklist once selected.
  return new LocalModerator(config.blocklist, config.chat.maxLength);
}

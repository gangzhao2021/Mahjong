/**
 * Admin-editable configuration (PRD §34–§38). Values live in the `settings`
 * table and override the JSON files, which only seed the defaults. Saving a
 * value validates it, stores it and applies it at once: new games and claims
 * use it immediately; games already running keep what they started with.
 */
import { validateRoster, type Character, type DialogueSettings, type Personality, type QuickPhrase } from '@mahjong/dialogue';
import type { SkillLevel } from '@mahjong/ai-play';
import type { ServerConfig } from '../config';
import type { Db } from '../db/db';
import { regionalSettings, type ChatLimits, type DialogueConfig, type Region } from '../dialogueConfig';
import { validateEconomy, type EconomyConfig } from '../economy/config';
import type { LlmProvider, LlmSettings } from '../llm/provider';

export interface LibraryEntry {
  value: string;
  enabled: boolean;
}

export interface ConfigValues {
  economy: EconomyConfig;
  dialogueSettings: DialogueSettings;
  quickPhrases: QuickPhrase[];
  chatLimits: ChatLimits;
  skillWeights: Record<SkillLevel, number>;
  llm: LlmSettings;
  personalities: Personality[];
  characters: Character[];
  /** Names and avatars to pick from when creating characters (PRD §9). */
  nameLibrary: LibraryEntry[];
  avatarLibrary: LibraryEntry[];
}

export type ConfigKey = keyof ConfigValues;
export const CONFIG_KEYS: readonly ConfigKey[] = [
  'economy',
  'dialogueSettings',
  'quickPhrases',
  'chatLimits',
  'skillWeights',
  'llm',
  'personalities',
  'characters',
  'nameLibrary',
  'avatarLibrary',
];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

export interface LiveTargets {
  region: Region;
  economy: EconomyConfig;
  dialogue: DialogueConfig;
  server: ServerConfig;
  llm: LlmProvider;
}

const RATIO_KEYS: (keyof DialogueSettings)[] = [
  'conversationFrequency',
  'proactiveFrequency',
  'stickerFrequency',
  'bluffIntensity',
  'trashTalkIntensity',
  'sarcasmIntensity',
  'aiReplyChance',
];

export class LiveConfig {
  /** The dialogue settings as the admin set them (before regional caps). */
  private rawDialogueSettings: DialogueSettings;
  private libraries: { nameLibrary: LibraryEntry[]; avatarLibrary: LibraryEntry[] };

  constructor(
    private readonly db: Db,
    private readonly t: LiveTargets,
  ) {
    this.rawDialogueSettings = { ...t.dialogue.settings };
    this.libraries = {
      nameLibrary: [...new Set(t.dialogue.roster.characters.map((c) => c.name))].map((value) => ({ value, enabled: true })),
      avatarLibrary: [...new Set(t.dialogue.roster.characters.map((c) => c.avatar))].map((value) => ({ value, enabled: true })),
    };
  }

  /** Applies stored overrides on top of the file defaults (call once at boot). */
  async load(): Promise<void> {
    const rows = await this.db.query<{ key: ConfigKey; value: unknown }>('SELECT key, value FROM settings');
    for (const row of rows) {
      if (!CONFIG_KEYS.includes(row.key)) continue;
      const problems = this.validate(row.key, row.value);
      if (problems.length) {
        console.error(`Ignoring invalid stored setting "${row.key}": ${problems.join('; ')}`);
        continue;
      }
      this.apply(row.key, row.value);
    }
  }

  get<K extends ConfigKey>(key: K): ConfigValues[K] {
    const t = this.t;
    const values: ConfigValues = {
      economy: t.economy,
      dialogueSettings: this.rawDialogueSettings,
      quickPhrases: t.dialogue.quickPhrases,
      chatLimits: t.dialogue.chat,
      skillWeights: t.server.skillWeights,
      llm: t.dialogue.llm,
      personalities: t.dialogue.roster.personalities,
      characters: t.dialogue.roster.characters,
      nameLibrary: this.libraries.nameLibrary,
      avatarLibrary: this.libraries.avatarLibrary,
    };
    return structuredClone(values[key]);
  }

  /** Validates, stores and applies a value; throws ConfigError if it is invalid. */
  async set<K extends ConfigKey>(key: K, value: ConfigValues[K]): Promise<void> {
    const problems = this.validate(key, value);
    if (problems.length) throw new ConfigError(problems);
    await this.db.query(
      'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()',
      [key, JSON.stringify(value)],
    );
    this.apply(key, structuredClone(value));
  }

  /** Validates personalities and characters together (they reference each other). */
  async setRoster(personalities: Personality[], characters: Character[]): Promise<void> {
    const problems = this.validateRoster(personalities, characters);
    if (problems.length) throw new ConfigError(problems);
    await this.db.tx(async (q) => {
      for (const [key, value] of [['personalities', personalities], ['characters', characters]] as const) {
        await q.query(
          'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()',
          [key, JSON.stringify(value)],
        );
      }
    });
    this.t.dialogue.roster.personalities = structuredClone(personalities);
    this.t.dialogue.roster.characters = structuredClone(characters);
  }

  private apply(key: ConfigKey, value: unknown): void {
    const t = this.t;
    switch (key) {
      case 'economy':
        // Mutate in place: services hold references to this object.
        Object.assign(t.economy, value);
        break;
      case 'dialogueSettings':
        this.rawDialogueSettings = { ...(value as DialogueSettings) };
        t.dialogue.settings = regionalSettings(value as DialogueSettings, t.region);
        break;
      case 'quickPhrases':
        // In place: the lobby's chat catalog shares this array.
        t.dialogue.quickPhrases.splice(0, t.dialogue.quickPhrases.length, ...(value as QuickPhrase[]));
        break;
      case 'chatLimits':
        Object.assign(t.dialogue.chat, value);
        break;
      case 'skillWeights':
        Object.assign(t.server.skillWeights, value);
        break;
      case 'llm':
        t.dialogue.llm = { ...t.dialogue.llm, ...(value as LlmSettings) };
        t.llm.configure?.(value as LlmSettings);
        break;
      case 'personalities':
        t.dialogue.roster.personalities = value as Personality[];
        break;
      case 'characters':
        t.dialogue.roster.characters = value as Character[];
        break;
      case 'nameLibrary':
      case 'avatarLibrary':
        this.libraries[key] = value as LibraryEntry[];
        break;
    }
  }

  private validate(key: ConfigKey, value: unknown): string[] {
    if (value === null || typeof value !== 'object') return ['value must be an object or list'];
    switch (key) {
      case 'economy':
        return validateEconomy(value as EconomyConfig);
      case 'dialogueSettings': {
        const s = value as DialogueSettings;
        const problems = RATIO_KEYS.filter((k) => !(typeof s[k] === 'number' && s[k] >= 0 && s[k] <= 1)).map((k) => `${k} must be 0–1`);
        for (const k of ['maxSpeakersPerTrigger', 'seatCooldownMs', 'tableCooldownMs', 'relevanceWindowActions', 'llmPerHand'] as const) {
          if (!Number.isInteger(s[k]) || s[k] < 0) problems.push(`${k} must be a non-negative integer`);
        }
        return problems;
      }
      case 'quickPhrases': {
        const list = value as QuickPhrase[];
        if (!Array.isArray(list) || list.length > 20) return ['quickPhrases must be a list of at most 20'];
        const problems = list.filter((q) => typeof q.id !== 'string' || !q.id || typeof q.text !== 'string' || !q.text.trim() || [...q.text].length > 30).map((q) => `invalid quick phrase ${JSON.stringify(q)}`);
        if (new Set(list.map((q) => q.id)).size !== list.length) problems.push('duplicate quick phrase ids');
        return problems;
      }
      case 'chatLimits': {
        const c = value as ChatLimits;
        return (Object.keys(c) as (keyof ChatLimits)[]).length === 6 && Object.values(c).every((n) => Number.isInteger(n) && n >= 0) && c.maxLength > 0
          ? []
          : ['chatLimits: all six limits must be non-negative integers, maxLength > 0'];
      }
      case 'skillWeights': {
        const w = value as Record<string, number>;
        const keys = ['beginner', 'intermediate', 'expert'];
        if (!keys.every((k) => typeof w[k] === 'number' && w[k] >= 0)) return ['skill weights must be non-negative numbers'];
        return keys.some((k) => w[k] > 0) ? [] : ['at least one skill weight must be positive'];
      }
      case 'llm': {
        const l = value as LlmSettings;
        return typeof l.routineModel === 'string' && l.routineModel && typeof l.highValueModel === 'string' && l.highValueModel && Number.isInteger(l.dailyRequestCap) && l.dailyRequestCap >= 0
          ? []
          : ['llm: routineModel, highValueModel and a non-negative dailyRequestCap are required'];
      }
      case 'personalities':
        return this.validateRoster(value as Personality[], this.t.dialogue.roster.characters);
      case 'characters':
        return this.validateRoster(this.t.dialogue.roster.personalities, value as Character[]);
      case 'nameLibrary':
      case 'avatarLibrary': {
        const list = value as LibraryEntry[];
        return Array.isArray(list) && list.every((e) => typeof e.value === 'string' && e.value.trim() && typeof e.enabled === 'boolean') ? [] : [`${key} entries need a value and enabled flag`];
      }
    }
  }

  private validateRoster(personalities: Personality[], characters: Character[]): string[] {
    if (!Array.isArray(personalities) || !Array.isArray(characters)) return ['roster must be lists'];
    const problems = validateRoster({ personalities, characters });
    for (const p of personalities) {
      if (!p.id || !p.name?.trim()) problems.push('every personality needs an id and a name');
      if (!Array.isArray(p.stickers)) problems.push(`${p.id}: stickers must be a list`);
    }
    for (const c of characters) if (!c.id || !c.name?.trim() || !c.avatar?.trim()) problems.push('every character needs an id, name and avatar');
    // Games need three distinct, selectable characters.
    const usable = characters.filter((c) => c.enabled && c.weight > 0 && personalities.some((p) => p.id === c.personalityId && p.enabled && p.weight > 0));
    if (usable.length < 3) problems.push('at least 3 enabled characters with enabled personalities are required');
    return problems;
  }
}


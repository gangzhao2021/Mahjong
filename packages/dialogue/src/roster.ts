import type { Character, Personality } from './types';

export type Rng = () => number;

export interface Roster {
  personalities: Personality[];
  characters: Character[];
}

/** Picks one item; weights are arbitrary non-negative numbers normalized to probabilities (PRD §4.2, §37). */
export function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: Rng): T {
  const candidates = items.filter((i) => weightOf(i) > 0);
  const total = candidates.reduce((a, i) => a + weightOf(i), 0);
  if (total <= 0) throw new Error('Nothing to pick: all weights are zero');
  let r = rng() * total;
  for (const item of candidates) {
    if ((r -= weightOf(item)) < 0) return item;
  }
  return candidates[candidates.length - 1];
}

/**
 * Selects distinct characters for a table (PRD §37): pick a personality by its
 * weight among personalities that still have an available enabled character,
 * then a character of that personality by character weight.
 */
export function selectCharacters(roster: Roster, count: number, rng: Rng): { character: Character; personality: Personality }[] {
  const personalities = new Map(roster.personalities.filter((p) => p.enabled && p.weight > 0).map((p) => [p.id, p]));
  const available = roster.characters.filter((c) => c.enabled && c.weight > 0 && personalities.has(c.personalityId));
  const chosen: { character: Character; personality: Personality }[] = [];

  while (chosen.length < count) {
    const remaining = available.filter((c) => !chosen.some((x) => x.character.id === c.id));
    const ids = new Set(remaining.map((c) => c.personalityId));
    if (!ids.size) throw new Error(`Roster has only ${chosen.length} usable characters, need ${count}`);
    const personality = pickWeighted([...ids].map((id) => personalities.get(id)!), (p) => p.weight, rng);
    const character = pickWeighted(
      remaining.filter((c) => c.personalityId === personality.id),
      (c) => c.weight,
      rng,
    );
    chosen.push({ character, personality });
  }
  return chosen;
}

/** Validates a roster loaded from config; returns human-readable problems. */
export function validateRoster(roster: Roster): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of roster.personalities) {
    if (ids.has(p.id)) problems.push(`Duplicate personality id ${p.id}`);
    ids.add(p.id);
    for (const key of ['trashTalk', 'talkFrequency', 'bluffTendency', 'stickerTendency'] as const) {
      if (!(p[key] >= 0 && p[key] <= 1)) problems.push(`${p.id}.${key} must be between 0 and 1`);
    }
    if (!(p.weight >= 0)) problems.push(`${p.id}.weight must be >= 0`);
  }
  const charIds = new Set<string>();
  for (const c of roster.characters) {
    if (charIds.has(c.id)) problems.push(`Duplicate character id ${c.id}`);
    charIds.add(c.id);
    if (!ids.has(c.personalityId)) problems.push(`Character ${c.id} has unknown personality ${c.personalityId}`);
  }
  return problems;
}

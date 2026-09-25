// Seed prompt library for SVG Benchmark.
// The prompts were harvested from the existing on-disk benchmarks into
// ./data/prompts.json (see tools/harvest). They ship with the app so the
// Batch Run feature always has a canonical set of prompts to iterate, even on
// a fresh data root. Each seed carries the same `slug` its benchmark folder
// uses, so batch submissions land in the right benchmark.

// Prompt sets keep the harder animated briefs apart from the still-image
// originals: Batch runs one set at a time and every batch submission records
// which set it came from. A prompt without `set` is core, which covers the
// user's own saved benchmarks.
export const PROMPT_SETS = Object.freeze([
  { id: 'core', label: 'Core', icon: 'fa-layer-group', hint: 'The original still-image prompts' },
  { id: 'animated', label: 'Animated', icon: 'fa-film', hint: 'Harder briefs: each animates a core prompt with numbered motion requirements' },
]);

export function promptSetOf(prompt) {
  return prompt?.set || 'core';
}

export function promptSetInfo(id) {
  return PROMPT_SETS.find(s => s.id === id) || PROMPT_SETS[0];
}

// Each seed file loads on its own, so a missing animated file never costs the
// core prompts.
const SEED_FILES = Object.freeze([
  { url: './data/prompts.json', set: 'core' },
  { url: './data/prompts-animated.json', set: 'animated' },
]);

let seedsCache = null;

export const PROMPT_CATEGORIES = Object.freeze([
  { id: 'animals', label: 'Animals', icon: 'fa-paw' },
  { id: 'nature', label: 'Nature', icon: 'fa-leaf' },
  { id: 'objects', label: 'Objects', icon: 'fa-cube' },
  { id: 'technology', label: 'Technology', icon: 'fa-microchip' },
  { id: 'places', label: 'Places', icon: 'fa-landmark' },
  { id: 'symbols', label: 'Symbols & Graphics', icon: 'fa-shapes' },
  { id: 'general', label: 'Other', icon: 'fa-wand-magic-sparkles' },
]);

const CATEGORY_PATTERNS = Object.freeze([
  ['animals', /\b(chameleon|corgi|elephant|flamingo|frog|hedgehog|honeybee|hummingbird|koala|butterfly|owl|panda|seahorse|whale|wolf|jellyfish|phoenix)\b/i],
  ['nature', /\b(bonsai|cactus|mountain|oak leaf|aurora|botanical|flower|tree|forest|landscape)\b/i],
  ['technology', /\b(circuit|cyberpunk|drone|robot|satellite|vr headset|wind turbine|dashboard)\b/i],
  ['places', /\b(eiffel|lighthouse|space needle|city|transit map|dominica|jamaican flag)\b/i],
  ['symbols', /\b(diamond|heart|medal|trophy|flag|icon|emblem|stained glass)\b/i],
]);

export function categoryInfo(categoryId) {
  return PROMPT_CATEGORIES.find(item => item.id === categoryId)
    || PROMPT_CATEGORIES[PROMPT_CATEGORIES.length - 1];
}

export function inferPromptCategory(item = {}) {
  if (item.category && item.category !== 'general') return item.category;
  const searchable = `${item.title || ''} ${item.prompt || ''}`;
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(searchable))?.[0] || 'objects';
}

export function normalizePrompt(item = {}) {
  return {
    ...item,
    category: inferPromptCategory(item),
    difficulty: item.difficulty || 'moderate',
    tags: Array.isArray(item.tags) ? item.tags : [],
    source: item.source || 'seed',
    set: promptSetOf(item),
  };
}

export async function loadSeedPrompts() {
  if (seedsCache) return seedsCache;
  const lists = await Promise.all(SEED_FILES.map(async (file) => {
    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.prompts || []).map(p => normalizePrompt({ ...p, set: p.set || file.set, source: 'seed' }));
    } catch (e) {
      console.warn(`[promptLibrary] failed to load seed prompts from ${file.url}:`, e?.message || e);
      return [];
    }
  }));
  seedsCache = lists.flat();
  return seedsCache;
}

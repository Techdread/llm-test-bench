// Seed prompt library for SVG Benchmark.
// The prompts were harvested from the existing on-disk benchmarks into
// ./data/prompts.json (see tools/harvest). They ship with the app so the
// Batch Run feature always has a canonical set of prompts to iterate, even on
// a fresh data root. Each seed carries the same `slug` its benchmark folder
// uses, so batch submissions land in the right benchmark.

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
  };
}

export async function loadSeedPrompts() {
  if (seedsCache) return seedsCache;
  try {
    const res = await fetch('./data/prompts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    seedsCache = (data.prompts || []).map(p => normalizePrompt({ ...p, source: 'seed' }));
  } catch (e) {
    console.warn('[promptLibrary] failed to load seed prompts:', e?.message || e);
    seedsCache = [];
  }
  return seedsCache;
}

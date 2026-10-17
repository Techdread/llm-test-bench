export const FALLBACK_PROMPT_CATEGORIES = Object.freeze([
  { id: 'vr', title: 'VR · Quest 3', icon: 'fa-vr-cardboard', order: 5 },
  { id: 'action', title: 'Action', icon: 'fa-person-running', order: 10 },
  { id: 'shooter', title: 'Shooters', icon: 'fa-crosshairs', order: 20 },
  { id: 'platformer', title: 'Platformers', icon: 'fa-stairs', order: 30 },
  { id: 'rpg', title: 'RPG', icon: 'fa-hat-wizard', order: 40 },
  { id: 'strategy', title: 'Strategy & Cards', icon: 'fa-chess-knight', order: 50 },
  { id: 'simulation', title: 'Simulation', icon: 'fa-city', order: 60 },
  { id: 'puzzle', title: 'Puzzle', icon: 'fa-puzzle-piece', order: 70 },
  { id: 'racing', title: 'Racing', icon: 'fa-flag-checkered', order: 80 },
  { id: 'fighting', title: 'Fighting', icon: 'fa-hand-fist', order: 90 },
  { id: 'adventure', title: 'Adventure', icon: 'fa-compass', order: 100 },
  { id: 'sports', title: 'Sports', icon: 'fa-futbol', order: 110 },
  { id: 'uncategorized', title: 'Uncategorized', icon: 'fa-box-archive', order: 999 },
]);

export const FALLBACK_PROMPT_COLLECTIONS = Object.freeze([
  { id: 'arcade-classics', title: 'Arcade Classics', order: 10 },
  { id: 'home-computer', title: 'Home Computer', order: 20 },
  { id: 'console-classics', title: 'Console Classics', order: 30 },
  { id: 'pc-classics', title: 'PC Classics', order: 40 },
  { id: 'modern-indie', title: 'Modern Indie', order: 50 },
  { id: 'forge-originals', title: 'Forge Originals', order: 55 },
  { id: 'quest-vr', title: 'Quest 3 Browser VR', order: 60 },
  { id: 'custom', title: 'Custom', order: 900 },
]);

const CATEGORY_RULES = [
  ['vr', ['vr', 'webxr', 'quest-3']],
  ['racing', ['racing']],
  ['fighting', ['fighting']],
  ['puzzle', ['puzzle']],
  ['rpg', ['rpg', 'arpg', 'jrpg']],
  ['strategy', ['strategy', 'deckbuilder', 'cards', 'turn-based', 'unit-ai']],
  ['simulation', ['simulation', 'colony', 'management', 'sandbox', 'city-builder', 'life-sim']],
  ['platformer', ['platformer', 'precision', 'cinematic', 'run-and-gun']],
  ['shooter', ['shooter', 'shmup', 'fixed-shooter', 'bullet-hell', 'bullet-heaven', 'twin-stick', 'fps']],
  ['sports', ['sports', 'football', 'golf', 'tennis']],
  ['adventure', ['adventure', 'narrative', 'point-and-click', 'space', 'exploration']],
  ['action', ['action', 'beat-em-up', 'roguelite', 'maze', 'grid']],
];

let taxonomyCache = null;

function cleanId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanId).filter(Boolean))];
}

export function inferPromptCategory(prompt = {}) {
  const tags = new Set((prompt.tags || []).map(cleanId));
  const text = `${prompt.title || ''} ${prompt.prompt || ''}`.toLowerCase();
  for (const [category, needles] of CATEGORY_RULES) {
    if (needles.some(needle => tags.has(needle))) return category;
  }
  if (/shoot|gun|bullet|space invader/.test(text)) return 'shooter';
  if (/platform|jump/.test(text)) return 'platformer';
  return 'uncategorized';
}

export function inferPromptCollections(prompt = {}) {
  if (inferPromptCategory(prompt) === 'vr' || cleanId(prompt.category) === 'vr') return ['quest-vr'];
  const era = String(prompt.era || '').toLowerCase();
  if (era.startsWith('arcade')) return ['arcade-classics'];
  if (era.startsWith('home')) return ['home-computer'];
  if (era.startsWith('console')) return ['console-classics'];
  if (era.startsWith('pc')) return ['pc-classics'];
  if (era.includes('modern') || era.includes('indie')) return ['modern-indie'];
  if (era === 'custom') return ['custom'];
  return [];
}

export function inferPromptSubcategory(prompt = {}) {
  const broad = new Set([
    'arcade', 'modern', 'home-computer', 'action', '3d', '2d',
    inferPromptCategory(prompt),
  ]);
  return (prompt.tags || []).map(cleanId).find(tag => tag && !broad.has(tag)) || '';
}

export function normalizePromptTaxonomy(prompt = {}) {
  return {
    category: cleanId(prompt.category) || inferPromptCategory(prompt),
    subcategory: cleanId(prompt.subcategory) || inferPromptSubcategory(prompt),
    collections: uniqueIds(prompt.collections?.length ? prompt.collections : inferPromptCollections(prompt)),
  };
}

function normalizeRegistryItems(items, fallback) {
  const valid = (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const id = cleanId(item?.id);
    if (!id) return [];
    return [{
      id,
      title: String(item.title || id),
      icon: item.icon ? cleanId(item.icon) : null,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index * 10,
    }];
  });
  return (valid.length ? valid : fallback).slice().sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function normalizePromptTaxonomyRegistry(value = {}) {
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    categories: normalizeRegistryItems(value.categories, FALLBACK_PROMPT_CATEGORIES),
    collections: normalizeRegistryItems(value.collections, FALLBACK_PROMPT_COLLECTIONS),
  };
}

export async function loadPromptTaxonomyRegistry() {
  if (taxonomyCache) return taxonomyCache;
  try {
    const response = await fetch('./data/categories.json');
    if (!response.ok) throw new Error(`taxonomy load failed (${response.status})`);
    taxonomyCache = normalizePromptTaxonomyRegistry(await response.json());
  } catch {
    taxonomyCache = normalizePromptTaxonomyRegistry();
  }
  return taxonomyCache;
}

export function promptFacetValues(prompts = []) {
  const collect = key => [...new Set(prompts.flatMap(prompt => Array.isArray(prompt[key])
    ? prompt[key]
    : [prompt[key]]).map(cleanId).filter(Boolean))].sort();
  return {
    categories: collect('category'),
    collections: collect('collections'),
    stacks: [...new Set(prompts.map(prompt => String(prompt.targetStack || 'web').toLowerCase()))].sort(),
    tags: [...new Set(prompts.flatMap(prompt => prompt.tags || []).map(cleanId).filter(Boolean))].sort(),
    // Which provisioned libraries actually appear, so the filter never offers a
    // library no prompt in the library uses.
    libraries: [...new Set(prompts.flatMap(prompt => prompt.libraries || []).map(cleanId).filter(Boolean))].sort(),
  };
}

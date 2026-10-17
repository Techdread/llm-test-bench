// VR Forge taxonomy. A brief's `kind` (game / simulation / app) is the primary
// axis; mixed reality is separated because a passthrough project is a different
// thing to build and to judge.
export const FALLBACK_PROMPT_CATEGORIES = Object.freeze([
  { id: 'game', title: 'Games', icon: 'fa-gamepad', order: 10 },
  { id: 'simulation', title: 'Simulations', icon: 'fa-atom', order: 20 },
  { id: 'app', title: 'Apps & tools', icon: 'fa-screwdriver-wrench', order: 30 },
  { id: 'mixed-reality', title: 'Mixed reality', icon: 'fa-cube', order: 40 },
  { id: 'uncategorized', title: 'Uncategorised', icon: 'fa-box-archive', order: 999 },
]);

export const FALLBACK_PROMPT_COLLECTIONS = Object.freeze([
  { id: 'quest-vr', title: 'Quest 3', order: 10 },
  { id: 'room-scale', title: 'Room scale', order: 20 },
  { id: 'seated', title: 'Seated', order: 30 },
  { id: 'hands', title: 'Hand tracking', order: 40 },
  { id: 'custom', title: 'Custom', order: 900 },
]);

// Inference only runs on a brief that declares no category of its own. The
// session mode wins over any tag: a passthrough project is mixed reality
// whatever else it is about.
const CATEGORY_RULES = [
  ['mixed-reality', ['mixed-reality', 'passthrough', 'ar', 'immersive-ar', 'planes']],
  ['simulation', ['simulation', 'physics', 'deterministic', 'particles', 'astronomy', 'education']],
  ['game', ['game', 'action', 'rhythm', 'shooter', 'puzzle', 'sport', 'arcade']],
  ['app', ['app', 'tool', 'productivity', 'dataviz', 'creative', 'ui', 'instrument']],
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
  if (/passthrough|mixed reality|immersive-ar/.test(text)) return 'mixed-reality';
  if (/simulat|solver|integrator|orbit/.test(text)) return 'simulation';
  if (/score|player|enemy|level|play/.test(text)) return 'game';
  return 'uncategorized';
}

export function inferPromptCollections(prompt = {}) {
  // Collections describe how a brief is played, which is the axis a VR user
  // actually browses by: what does this ask of my room and my hands?
  const collections = ['quest-vr'];
  const locomotion = cleanId(prompt.interaction?.locomotion);
  const tags = new Set((prompt.tags || []).map(cleanId));
  if (locomotion === 'roomscale' || tags.has('room-scale')) collections.push('room-scale');
  if (locomotion === 'seated' || prompt.comfort?.seatedSupported || tags.has('seated')) collections.push('seated');
  if (cleanId(prompt.interaction?.hands) === 'required' || tags.has('hand-tracking')) collections.push('hands');
  return collections;
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

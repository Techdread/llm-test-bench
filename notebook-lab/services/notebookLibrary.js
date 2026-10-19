// DOM-free notebook-library indexing, filtering, and preference helpers.

export const LIBRARY_PREFS_KEY = 'notebook-lab-library-prefs';
export const LIBRARY_FAVOURITES_KEY = 'notebook-lab-library-favourites';
export const LIBRARY_RECENTS_KEY = 'notebook-lab-library-recents';
export const MAX_RECENTS = 30;

export const DEFAULT_LIBRARY_PREFS = Object.freeze({
  view: 'all',
  query: '',
  language: 'all',
  sort: 'relevance',
});

const TYPE_LABELS = {
  tutorial: 'Tutorial',
  example: 'Example',
  saved: 'My notebook',
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function titleFromCategory(id) {
  return String(id || 'Other')
    .split(/[-/]/g)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export function normaliseCategories(categories = [], examples = []) {
  const configured = new Map(safeArray(categories).map(category => [category.id, category]));
  const ids = new Set(safeArray(examples).map(example => example.category).filter(Boolean));
  for (const id of ids) {
    if (!configured.has(id)) configured.set(id, { id, label: titleFromCategory(id), icon: 'fa-shapes' });
  }
  return [...configured.values()]
    .filter(category => ids.has(category.id))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.label.localeCompare(b.label));
}

export function createLibraryItems({ saved = [], tutorials = [], examples = [] } = {}) {
  const tutorialItems = safeArray(tutorials).map((item, index) => ({
    ...item,
    key: `tutorial:${item.file}`,
    type: 'tutorial',
    typeLabel: TYPE_LABELS.tutorial,
    order: index,
    langs: safeArray(item.langs),
    searchText: [item.title, item.description, 'tutorial learn'].filter(Boolean).join(' ').toLowerCase(),
  }));
  const exampleItems = safeArray(examples).map((item, index) => ({
    ...item,
    key: `example:${item.file}`,
    type: 'example',
    typeLabel: TYPE_LABELS.example,
    order: index,
    langs: safeArray(item.langs),
    searchText: [
      item.title, item.description, item.category,
      ...safeArray(item.langs), ...safeArray(item.features), ...safeArray(item.tags),
    ].filter(Boolean).join(' ').toLowerCase(),
  }));
  const savedItems = safeArray(saved).map((item, index) => {
    const entry = typeof item === 'string' ? { id: item, title: item } : item;
    return {
      ...entry,
      key: `saved:${entry.id}`,
      type: 'saved',
      typeLabel: TYPE_LABELS.saved,
      order: index,
      langs: safeArray(entry.langs),
      description: entry.description || `Saved notebook · ${entry.id}`,
      searchText: [entry.title, entry.id, entry.description, ...safeArray(entry.tags)].filter(Boolean).join(' ').toLowerCase(),
    };
  });
  return [...tutorialItems, ...exampleItems, ...savedItems];
}

export function countLibraryItems(items = []) {
  const counts = { all: items.length, tutorials: 0, examples: 0, saved: 0, categories: {} };
  for (const item of items) {
    if (item.type === 'tutorial') counts.tutorials += 1;
    if (item.type === 'example') {
      counts.examples += 1;
      counts.categories[item.category] = (counts.categories[item.category] || 0) + 1;
    }
    if (item.type === 'saved') counts.saved += 1;
  }
  return counts;
}

function matchesView(item, view, favouriteKeys, recentKeys) {
  if (view === 'all') return true;
  if (view === 'tutorials') return item.type === 'tutorial';
  if (view === 'examples') return item.type === 'example';
  if (view === 'saved') return item.type === 'saved';
  if (view === 'favourites') return favouriteKeys.has(item.key);
  if (view === 'recent') return recentKeys.has(item.key);
  if (view.startsWith('category:')) return item.type === 'example' && item.category === view.slice(9);
  return true;
}

function queryScore(item, tokens) {
  if (!tokens.length) return 0;
  const title = String(item.title || '').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!item.searchText.includes(token)) return -1;
    if (title === token) score += 10;
    else if (title.startsWith(token)) score += 6;
    else if (title.includes(token)) score += 3;
    else score += 1;
  }
  return score;
}

export function filterLibraryItems(items = [], options = {}) {
  const view = options.view || DEFAULT_LIBRARY_PREFS.view;
  const language = options.language || DEFAULT_LIBRARY_PREFS.language;
  const sort = options.sort || DEFAULT_LIBRARY_PREFS.sort;
  const tokens = String(options.query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const favouriteKeys = new Set(safeArray(options.favourites));
  const recentOrder = new Map(safeArray(options.recents).map((entry, index) => [
    typeof entry === 'string' ? entry : entry.key,
    index,
  ]));
  const recentKeys = new Set(recentOrder.keys());

  const matches = [];
  for (const item of items) {
    if (!matchesView(item, view, favouriteKeys, recentKeys)) continue;
    if (language !== 'all' && !item.langs.includes(language)) continue;
    const score = queryScore(item, tokens);
    if (score < 0) continue;
    matches.push({ item, score });
  }

  matches.sort((a, b) => {
    if (view === 'recent') return (recentOrder.get(a.item.key) ?? 999) - (recentOrder.get(b.item.key) ?? 999);
    if (sort === 'title') return String(a.item.title).localeCompare(String(b.item.title));
    if (sort === 'newest') {
      const dateOrder = String(b.item.updatedAt || b.item.addedAt || '').localeCompare(String(a.item.updatedAt || a.item.addedAt || ''));
      if (dateOrder) return dateOrder;
    }
    if (tokens.length && b.score !== a.score) return b.score - a.score;
    if (a.item.type !== b.item.type) return ['tutorial', 'example', 'saved'].indexOf(a.item.type) - ['tutorial', 'example', 'saved'].indexOf(b.item.type);
    return a.item.order - b.item.order;
  });
  return matches.map(match => match.item);
}

export function collectLanguages(items = []) {
  return [...new Set(items.flatMap(item => safeArray(item.langs)))].sort();
}

export function loadJsonPreference(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function recordRecent(recents = [], key, now = new Date().toISOString()) {
  return [{ key, openedAt: now }, ...safeArray(recents).filter(entry => (typeof entry === 'string' ? entry : entry.key) !== key)]
    .slice(0, MAX_RECENTS);
}

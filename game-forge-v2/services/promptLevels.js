// Prompt levels: the same library game at three depths.
//
//   Sketch      the library prompt itself (data/library.json)
//   Brief       ~12 numbered, visible requirements for one finished slice
//   Design doc  a full design document with a build order and acceptance tests
//
// Brief and Design doc are written in data/levels/<game>.<level>.md and listed
// in data/levels/index.json, pointing back to the library game by `basedOn`.
// They describe an original world in the game's genre, so they carry their own
// title and id and build into their own run folders.

export const PROMPT_LEVELS = Object.freeze([
  Object.freeze({ id: 'sketch', label: 'Sketch', hint: 'The short library prompt.' }),
  Object.freeze({ id: 'brief', label: 'Brief', hint: 'About a dozen numbered requirements for one finished slice of the game, with art, sound and controls.' }),
  Object.freeze({ id: 'design', label: 'Design doc', hint: 'A full design document: every number, all the content, a build order and acceptance tests.' }),
]);

const LEVEL_IDS = new Set(PROMPT_LEVELS.map(level => level.id));
const LEVEL_ORDER = new Map(PROMPT_LEVELS.map((level, index) => [level.id, index]));

function levelsBase() {
  return new URL('../data/levels/', import.meta.url);
}

/** Valid entries only: a level other than sketch, an id, a base game and a file. */
export function normalizeLevelIndex(value) {
  const entries = Array.isArray(value?.levels) ? value.levels : [];
  const seen = new Set();
  return entries.flatMap(entry => {
    const level = String(entry?.level || '');
    const id = String(entry?.id || '').trim();
    const basedOn = String(entry?.basedOn || '').trim();
    const file = String(entry?.file || '').trim();
    if (!LEVEL_IDS.has(level) || level === 'sketch' || !id || !basedOn || !file || seen.has(id)) return [];
    seen.add(id);
    return [{
      id, level, basedOn, file,
      title: String(entry.title || ''),
      inspiredBy: String(entry.inspiredBy || ''),
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      watchFor: String(entry.watchFor || ''),
    }];
  });
}

/**
 * A level as a buildable library prompt: the base game's era, stack, category
 * and libraries, with the level's own id, title, text and watch-for.
 */
export function levelPrompt(base, entry, text) {
  return {
    ...base,
    id: entry.id,
    title: entry.title || base.title,
    prompt: String(text || ''),
    watchFor: entry.watchFor || base.watchFor || '',
    tags: [...new Set([...(base.tags || []), ...entry.tags])],
    level: entry.level,
    basedOn: base.id,
    inspiredBy: entry.inspiredBy || base.title,
    source: 'seed',
    promptVersion: 1,
    derivation: null,
  };
}

/**
 * Every level of a base game, oldest first: the sketch (the base itself),
 * then whichever of brief and design exist.
 * @param {Object} base library prompt
 * @param {Map<string, Object[]>} byBase level prompts grouped by basedOn
 */
export function levelsFor(base, byBase) {
  const extra = byBase?.get(base?.id) || [];
  if (!extra.length) return [];
  return [{ ...base, level: 'sketch' }, ...extra]
    .sort((a, b) => LEVEL_ORDER.get(a.level) - LEVEL_ORDER.get(b.level));
}

/**
 * Loads the level index and every level's text, attached to the library
 * games they are based on. Never throws: a missing index means no levels.
 * @returns {Promise<Map<string, Object[]>>} basedOn → level prompts
 */
export async function loadPromptLevels(seeds, { fetchImpl = globalThis.fetch, base = levelsBase() } = {}) {
  const byBase = new Map();
  try {
    const res = await fetchImpl(new URL('index.json', base));
    if (!res.ok) return byBase;
    const entries = normalizeLevelIndex(await res.json());
    const seedById = new Map((seeds || []).map(seed => [seed.id, seed]));
    await Promise.all(entries.map(async entry => {
      const seed = seedById.get(entry.basedOn);
      if (!seed) return;
      const file = await fetchImpl(new URL(entry.file, base));
      if (!file.ok) return;
      const prompt = levelPrompt(seed, entry, await file.text());
      if (!byBase.has(seed.id)) byBase.set(seed.id, []);
      byBase.get(seed.id).push(prompt);
    }));
  } catch {
    return byBase;
  }
  return byBase;
}

/** The fenced ```maze blocks in a prompt, each as an array of rows. */
export function mazesInPrompt(text) {
  const mazes = [];
  const pattern = /```maze\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    mazes.push(match[1].replace(/\n$/, '').split('\n'));
  }
  return mazes;
}

/** The fenced ```level blocks in a prompt (sector maps), parsed. */
export function levelMapsInPrompt(text) {
  const levels = [];
  const pattern = /```level\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) levels.push(JSON.parse(match[1]));
  return levels;
}

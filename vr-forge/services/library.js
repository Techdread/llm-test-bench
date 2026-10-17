// Versioned, portable prompt library. Repository seeds remain immutable; user
// prompts, prompt versions, and visibility state live in the connected data
// root under vr-forge/library/prompt-library.json. Legacy localStorage is
// migrated on first successful disk access and remains a no-root fallback.

import { ensureAppNamespace } from '../../shared/services/data-root-manager.js';
import { normalizeLibraryIds } from './projectLibraries.js';
import { normalizePromptTaxonomy } from './promptCategories.js';
import { slugify } from './runStore.js';

const USER_KEY = 'vr-forge-user-prompts';
const DELETED_KEY = 'vr-forge-deleted-seeds';
const LIBRARY_DIR = 'library';
const LIBRARY_FILE = 'prompt-library.json';
export const PROMPT_LIBRARY_SCHEMA_VERSION = 2;

let seedsCache = null;

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(tag => String(tag).trim().toLowerCase()).filter(Boolean))];
}

export async function loadSeeds() {
  if (seedsCache) return seedsCache;
  const response = await fetch('./data/library.json');
  if (!response.ok) throw new Error(`Prompt seed library failed to load (${response.status})`);
  const data = await response.json();
  seedsCache = (data.prompts || []).map(prompt => {
    const normalized = { ...prompt, tags: normalizeTags(prompt.tags) };
    return {
      ...normalized, ...normalizePromptTaxonomy(normalized),
      promptVersion: Number(prompt.promptVersion) || 1,
      source: 'seed',
    };
  });
  return seedsCache;
}

function emptyDocument() {
  return {
    schemaVersion: PROMPT_LIBRARY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    migratedAt: null,
    prompts: [],
    hiddenSeedIds: [],
  };
}

function readLegacy() {
  let prompts = [];
  let hiddenSeedIds = [];
  try { prompts = JSON.parse(localStorage.getItem(USER_KEY) || '[]') || []; } catch { /* empty */ }
  try { hiddenSeedIds = JSON.parse(localStorage.getItem(DELETED_KEY) || '[]') || []; } catch { /* empty */ }
  return { prompts, hiddenSeedIds };
}

function legacyDocument() {
  const legacy = readLegacy();
  const document = emptyDocument();
  document.hiddenSeedIds = [...new Set(legacy.hiddenSeedIds.map(String))];
  document.prompts = legacy.prompts.map(prompt => {
    const timestamp = prompt.createdAt || new Date().toISOString();
    return {
      id: prompt.id || `user-${slugify(prompt.title)}-${Date.now().toString(36)}`,
      currentVersion: Number(prompt.promptVersion) || 1,
      hidden: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      versions: [{
        version: Number(prompt.promptVersion) || 1,
        createdAt: timestamp,
        title: prompt.title,
        prompt: prompt.prompt,
        era: prompt.era || 'Custom',
        targetStack: prompt.targetStack || 'web',
        libraries: normalizeLibraryIds(prompt.libraries),
        tags: normalizeTags(prompt.tags),
        ...normalizePromptTaxonomy(prompt),
        watchFor: prompt.watchFor || '',
        authoring: prompt.authoring && typeof prompt.authoring === 'object'
          ? { ...prompt.authoring }
          : { source: 'human' },
        derivation: prompt.derivation && typeof prompt.derivation === 'object'
          ? { ...prompt.derivation }
          : null,
      }],
    };
  });
  return document;
}

export function normalizePromptLibraryDocument(value) {
  const document = emptyDocument();
  if (!value || typeof value !== 'object') return document;
  document.updatedAt = value.updatedAt || document.updatedAt;
  document.migratedAt = value.migratedAt || null;
  document.hiddenSeedIds = [...new Set((value.hiddenSeedIds || []).map(String))];
  document.prompts = (value.prompts || []).flatMap(record => {
    if (!record?.id || !Array.isArray(record.versions) || !record.versions.length) return [];
    const versions = record.versions
      .filter(version => version && Number(version.version) > 0)
      .map(version => ({
        version: Number(version.version),
        createdAt: version.createdAt || new Date().toISOString(),
        title: String(version.title || 'Untitled'),
        prompt: String(version.prompt || ''),
        era: String(version.era || 'Custom'),
        targetStack: String(version.targetStack || 'web'),
        libraries: normalizeLibraryIds(version.libraries),
        tags: normalizeTags(version.tags),
        ...normalizePromptTaxonomy(version),
        watchFor: String(version.watchFor || ''),
        authoring: version.authoring && typeof version.authoring === 'object'
          ? { ...version.authoring }
          : { source: 'human' },
        derivation: version.derivation && typeof version.derivation === 'object'
          ? { ...version.derivation }
          : null,
      }))
      .sort((a, b) => a.version - b.version);
    if (!versions.length) return [];
    return [{
      id: String(record.id),
      currentVersion: versions.some(version => version.version === Number(record.currentVersion))
        ? Number(record.currentVersion)
        : versions.at(-1).version,
      hidden: !!record.hidden,
      createdAt: record.createdAt || versions[0].createdAt,
      updatedAt: record.updatedAt || versions.at(-1).createdAt,
      versions,
    }];
  });
  return document;
}

async function diskHandles({ create = false } = {}) {
  const appRoot = await ensureAppNamespace('vr-forge');
  const directory = await appRoot.getDirectoryHandle(LIBRARY_DIR, { create });
  const file = await directory.getFileHandle(LIBRARY_FILE, { create });
  return { directory, file };
}

async function writeDisk(document) {
  document.updatedAt = new Date().toISOString();
  const { file } = await diskHandles({ create: true });
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(document, null, 2));
  await writer.close();
  return document;
}

export async function loadPromptLibrary() {
  try {
    const { file } = await diskHandles();
    const document = normalizePromptLibraryDocument(JSON.parse(await (await file.getFile()).text()));
    return { document, storage: 'data-root' };
  } catch (error) {
    if (!/No data root|not found|NotFound/i.test(`${error?.name || ''} ${error?.message || ''}`)) {
      console.warn('prompt library read failed; using legacy fallback', error);
    }
    const migrated = legacyDocument();
    try {
      if (readLegacy().prompts.length || readLegacy().hiddenSeedIds.length) {
        migrated.migratedAt = new Date().toISOString();
      }
      await writeDisk(migrated);
      return { document: migrated, storage: 'data-root' };
    } catch {
      return { document: migrated, storage: 'local-fallback' };
    }
  }
}

async function saveDocument(document, storage) {
  const normalized = normalizePromptLibraryDocument(document);
  if (storage === 'data-root') return writeDisk(normalized);
  // Compatibility fallback until the user connects a data root.
  const current = normalized.prompts.filter(record => !record.hidden).map(record => {
    const version = record.versions.find(item => item.version === record.currentVersion) || record.versions.at(-1);
    return { id: record.id, ...version, promptVersion: version.version };
  });
  localStorage.setItem(USER_KEY, JSON.stringify(current));
  localStorage.setItem(DELETED_KEY, JSON.stringify(normalized.hiddenSeedIds));
  return normalized;
}

function currentPrompt(record) {
  const version = record.versions.find(item => item.version === record.currentVersion) || record.versions.at(-1);
  return {
    id: record.id,
    ...version,
    promptVersion: version.version,
    source: 'user',
  };
}

export async function getAllPrompts() {
  const [seeds, library] = await Promise.all([loadSeeds(), loadPromptLibrary()]);
  const hiddenSeeds = new Set(library.document.hiddenSeedIds);
  // A user record carrying a seed's id SUPERSEDES that seed — it holds the
  // curated text as version 1 plus the author's edits on top — so the seed must
  // not also render, or an edited prompt would appear twice.
  const adopted = new Set(library.document.prompts.map(record => record.id));
  const user = library.document.prompts.filter(record => !record.hidden).map(currentPrompt);
  return [
    ...seeds.filter(seed => !hiddenSeeds.has(seed.id) && !adopted.has(seed.id)),
    ...user,
  ];
}

/**
 * The id of the variant of `baseId` pinned to `laneId` (spec 327).
 *
 * Deterministic on purpose: re-sweeping a cell must find the prompt it made
 * last time and add a version to it, never create a second prompt.
 */
export function variantPromptId(baseId, laneId) {
  return `variant-${slugify(baseId)}--${slugify(laneId)}`;
}

/**
 * The runs folder a prompt builds into.
 *
 * Variants get their own folder per lane. `slugify` caps at 48 characters, so a
 * long-named game would otherwise truncate every one of its lanes down to the
 * same string and pour every lane's runs into one folder — the lane is appended
 * after the cap rather than before it.
 */
export function promptGameSlug(prompt) {
  const laneId = prompt?.derivation?.laneId;
  if (!laneId) return slugify(prompt?.id || prompt?.title);
  const base = slugify(prompt.derivation.parentPromptId || prompt.id || prompt.title);
  return `${base.slice(0, 40)}--${slugify(laneId)}`;
}

export async function addUserPrompt({
  title, prompt, era = 'Custom', targetStack = 'web', tags = [], watchFor = '',
  libraries = [],
  category = '', subcategory = '', collections = [],
  authoring = { source: 'human' },
  derivation = null,
}) {
  const library = await loadPromptLibrary();
  const createdAt = new Date().toISOString();
  const id = `user-${slugify(title)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  tags = normalizeTags(tags);
  const version = {
    version: 1, createdAt, title, prompt, era, targetStack,
    libraries: normalizeLibraryIds(libraries), tags, watchFor, authoring, derivation,
    ...normalizePromptTaxonomy({ title, prompt, era, tags, category, subcategory, collections }),
  };
  library.document.prompts.push({
    id, currentVersion: 1, hidden: false, createdAt, updatedAt: createdAt,
    versions: [version],
  });
  await saveDocument(library.document, library.storage);
  return { id, ...version, promptVersion: 1, source: 'user' };
}

/**
 * Write one variant sweep cell (spec 327).
 *
 * Keyed on the deterministic variant id, so re-sweeping the same (prompt, lane)
 * pair appends a version to the prompt that is already there. The earlier text
 * stays readable, which is the same bargain the rest of the library makes: a
 * rewrite is a new version, never an overwrite.
 *
 * Returns the saved prompt plus `created` — false when it added a version.
 */
export async function upsertVariantPrompt({
  baseId, laneId,
  title, prompt, era = 'Custom', targetStack = 'web', tags = [], watchFor = '',
  libraries = [],
  category = '', subcategory = '', collections = [],
  authoring = { source: 'human' },
  derivation = null,
}) {
  if (!baseId || !laneId) throw new Error('A variant needs both a base prompt and a lane.');
  const id = variantPromptId(baseId, laneId);
  const library = await loadPromptLibrary();
  const existing = library.document.prompts.find(record => record.id === id);
  const createdAt = new Date().toISOString();
  const taxonomy = normalizePromptTaxonomy({
    title, prompt, era, tags: normalizeTags(tags), category, subcategory, collections,
  });
  const version = {
    version: existing ? Math.max(...existing.versions.map(item => item.version)) + 1 : 1,
    createdAt, title, prompt, era, targetStack,
    libraries: normalizeLibraryIds(libraries), tags: normalizeTags(tags), watchFor,
    authoring, derivation, ...taxonomy,
  };
  if (existing) {
    existing.versions.push(version);
    existing.currentVersion = version.version;
    // A re-sweep is also how a hidden variant comes back.
    existing.hidden = false;
    existing.updatedAt = createdAt;
  } else {
    library.document.prompts.push({
      id, currentVersion: 1, hidden: false, createdAt, updatedAt: createdAt,
      versions: [version],
    });
  }
  await saveDocument(library.document, library.storage);
  return {
    id, ...version, promptVersion: version.version, source: 'user', created: !existing,
  };
}

/**
 * How many runs each prompt has, keyed by prompt id.
 *
 * `games` is `listGames()` output — directory counts only, so this stays cheap
 * enough to call for the whole library. Each entry reports the prompt's own runs
 * separately from those of the variants derived off it, because they live in
 * different folders and adding them together would make the number a guess.
 */
export function promptRunCounts(prompts = [], games = []) {
  const bySlug = new Map(games.map(game => [game.slug, game.runs || 0]));
  const counts = new Map();
  for (const prompt of prompts) {
    counts.set(prompt.id, { own: bySlug.get(promptGameSlug(prompt)) || 0, lanes: 0, laneCount: 0 });
  }
  for (const prompt of prompts) {
    if (!isVariantPrompt(prompt)) continue;
    const parent = counts.get(prompt.derivation.parentPromptId);
    if (!parent) continue;
    parent.lanes += counts.get(prompt.id).own;
    parent.laneCount += 1;
  }
  return counts;
}

export function isVariantPrompt(prompt) {
  return Boolean(prompt?.derivation?.laneId && prompt?.derivation?.parentPromptId);
}

/** Split prompts into base rows and the variants hanging off each of them. */
export function groupPromptVariants(prompts = []) {
  const bases = prompts.filter(prompt => !isVariantPrompt(prompt));
  const baseIds = new Set(bases.map(prompt => prompt.id));
  const variantsByParent = new Map();
  const orphans = [];
  for (const prompt of prompts.filter(isVariantPrompt)) {
    const parentId = prompt.derivation.parentPromptId;
    if (!baseIds.has(parentId)) { orphans.push(prompt); continue; }
    variantsByParent.set(parentId, [...(variantsByParent.get(parentId) || []), prompt]);
  }
  // A variant whose parent has been hidden must stay reachable, so it becomes a
  // row of its own rather than vanishing along with its parent.
  return { bases: [...bases, ...orphans], variantsByParent };
}

/**
 * Copy a curated seed into the user layer, unedited, as its version 1.
 *
 * This is what makes a seed editable without ever rewriting `data/library.json`:
 * the curated text becomes a readable first version and the author's change
 * lands on top of it. The repository file is untouched and the original wording
 * stays recoverable from the version list forever.
 */
function recordFromSeed(seed) {
  const createdAt = new Date().toISOString();
  return {
    id: seed.id,
    currentVersion: 1,
    hidden: false,
    createdAt,
    updatedAt: createdAt,
    versions: [{
      version: 1,
      createdAt,
      title: seed.title,
      prompt: seed.prompt,
      era: seed.era || 'Custom',
      targetStack: seed.targetStack || 'web',
      libraries: normalizeLibraryIds(seed.libraries),
      tags: normalizeTags(seed.tags),
      ...normalizePromptTaxonomy(seed),
      watchFor: seed.watchFor || '',
      authoring: { source: 'curated' },
      derivation: null,
    }],
  };
}

/**
 * Save an edit to ANY prompt — curated or custom — as a new version.
 *
 * Curated seeds are adopted into the user layer on first edit (see
 * `recordFromSeed`), so "seeds are immutable" keeps its literal meaning while
 * the author can still change anything they can see.
 */
export async function savePromptEdit(prompt, changes) {
  const id = prompt?.id;
  if (!id) throw new Error('A prompt needs an id before it can be edited.');
  const library = await loadPromptLibrary();
  if (!library.document.prompts.some(item => item.id === id)) {
    if (prompt.source !== 'seed') throw new Error(`Unknown prompt: ${id}`);
    library.document.prompts.push(recordFromSeed(prompt));
    await saveDocument(library.document, library.storage);
  }
  return updateUserPrompt(id, changes);
}

export async function updateUserPrompt(id, changes) {
  const library = await loadPromptLibrary();
  const record = library.document.prompts.find(item => item.id === id);
  if (!record) throw new Error(`Unknown custom prompt: ${id}`);
  const current = currentPrompt(record);
  const versionNumber = Math.max(...record.versions.map(version => version.version)) + 1;
  const next = {
    version: versionNumber,
    createdAt: new Date().toISOString(),
    title: changes.title ?? current.title,
    prompt: changes.prompt ?? current.prompt,
    era: changes.era ?? current.era,
    targetStack: changes.targetStack ?? current.targetStack,
    libraries: normalizeLibraryIds(changes.libraries ?? current.libraries),
    tags: normalizeTags(changes.tags ?? current.tags),
    ...normalizePromptTaxonomy({
      ...current,
      ...changes,
      tags: normalizeTags(changes.tags ?? current.tags),
      era: changes.era ?? current.era,
    }),
    watchFor: changes.watchFor ?? current.watchFor,
    authoring: changes.authoring ?? { source: 'human' },
    derivation: changes.derivation ?? current.derivation ?? null,
  };
  record.versions.push(next);
  record.currentVersion = versionNumber;
  record.hidden = false;
  record.updatedAt = next.createdAt;
  await saveDocument(library.document, library.storage);
  return { id, ...next, promptVersion: versionNumber, source: 'user' };
}

/**
 * Everything currently hidden, newest first, so it can be put back.
 *
 * Hiding is one click with no confirmation, and until this existed there was no
 * way back to a mis-clicked prompt even though its versions were still on disk.
 * Seeds and user prompts hide through different mechanisms, so both are listed.
 */
export async function listHiddenPrompts() {
  const [seeds, library] = await Promise.all([loadSeeds(), loadPromptLibrary()]);
  const hiddenSeeds = new Set(library.document.hiddenSeedIds);
  const adopted = new Set(library.document.prompts.map(record => record.id));
  return [
    ...library.document.prompts
      .filter(record => record.hidden)
      .map(record => ({ ...currentPrompt(record), hiddenKind: 'user' })),
    ...seeds
      .filter(seed => hiddenSeeds.has(seed.id) && !adopted.has(seed.id))
      .map(seed => ({ ...seed, hiddenKind: 'seed' })),
  ].sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

/** Undo a soft delete, for either a hidden user prompt or a hidden seed. */
export async function restorePrompt(id) {
  const library = await loadPromptLibrary();
  const record = library.document.prompts.find(item => item.id === id);
  if (record) record.hidden = false;
  library.document.hiddenSeedIds = library.document.hiddenSeedIds.filter(seedId => seedId !== id);
  await saveDocument(library.document, library.storage);
}

export async function softDelete(id) {
  const library = await loadPromptLibrary();
  const record = library.document.prompts.find(item => item.id === id);
  if (record) record.hidden = true;
  else if (!library.document.hiddenSeedIds.includes(id)) library.document.hiddenSeedIds.push(id);
  await saveDocument(library.document, library.storage);
}

export async function exportPromptLibrary() {
  const { document } = await loadPromptLibrary();
  return {
    kind: 'game-forge-prompt-library',
    schemaVersion: PROMPT_LIBRARY_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    library: document,
  };
}

export async function importPromptLibrary(payload) {
  if (payload?.kind !== 'game-forge-prompt-library') throw new Error('Not a VR Forge prompt-library export.');
  const incoming = normalizePromptLibraryDocument(payload.library);
  const current = await loadPromptLibrary();
  const byId = new Map(current.document.prompts.map(record => [record.id, record]));
  for (const record of incoming.prompts) {
    const existing = byId.get(record.id);
    if (!existing) {
      current.document.prompts.push(record);
      byId.set(record.id, record);
      continue;
    }
    const versions = new Map(existing.versions.map(version => [version.version, version]));
    for (const version of record.versions) if (!versions.has(version.version)) existing.versions.push(version);
    existing.versions.sort((a, b) => a.version - b.version);
    existing.currentVersion = Math.max(existing.currentVersion, record.currentVersion);
    existing.hidden = existing.hidden && record.hidden;
    existing.updatedAt = new Date().toISOString();
  }
  current.document.hiddenSeedIds = [...new Set([
    ...current.document.hiddenSeedIds, ...incoming.hiddenSeedIds,
  ])];
  await saveDocument(current.document, current.storage);
  return getAllPrompts();
}

export function downloadPromptLibrary(payload, filename = 'game-forge-prompt-library.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function allTags(prompts) {
  const set = new Set();
  for (const prompt of prompts) normalizeTags(prompt.tags).forEach(tag => set.add(tag));
  return [...set].sort();
}

export function filterPrompts(prompts, {
  query = '', tag = null, era = null, category = null, collection = null, stack = null,
  library = null, kind = null,
} = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTag = tag ? String(tag).trim().toLowerCase() : null;
  const normalizedLibrary = library ? String(library).trim().toLowerCase() : null;
  return prompts.filter(prompt => {
    // `kind` separates originals from the lane variants derived off them.
    if (kind === 'variant' && !isVariantPrompt(prompt)) return false;
    if (kind === 'base' && isVariantPrompt(prompt)) return false;
    if (normalizedLibrary && !normalizeLibraryIds(prompt.libraries).includes(normalizedLibrary)) return false;
    if (normalizedTag && !normalizeTags(prompt.tags).includes(normalizedTag)) return false;
    if (era && prompt.era !== era) return false;
    if (category && prompt.category !== category) return false;
    if (collection && !(prompt.collections || []).includes(collection)) return false;
    if (stack && String(prompt.targetStack || 'web').toLowerCase() !== stack) return false;
    if (!normalizedQuery) return true;
    return `${prompt.title} ${prompt.prompt} ${(prompt.tags || []).join(' ')} ${prompt.era} ${prompt.category || ''} ${prompt.subcategory || ''} ${(prompt.collections || []).join(' ')}`
      .toLowerCase().includes(normalizedQuery);
  });
}

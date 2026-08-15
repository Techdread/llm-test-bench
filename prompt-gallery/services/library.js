// Prompt Library service.
// Two layers, never mixed on disk:
//   - Curated seeds shipped with the app at ./data/library.json (read-only).
//   - The user's library at {appRoot}/_library/library.json — additions,
//     edits (stored as overrides for seeds), hidden seeds, and trashed
//     prompts. App updates can change the seeds but never touch this file.
// Prompt edits keep prior text in a revisions array; removals are soft
// (seeds are hidden, user prompts go to trash) so no prompt text is ever lost.
import * as fs from '../../shared/services/fs.js';

export const CATEGORIES = [
  { id: 'threejs', label: 'Three.js', icon: 'fa-cube' },
  { id: 'p5js', label: 'p5.js', icon: 'fa-paintbrush' },
  { id: 'html-js', label: 'HTML / JavaScript', icon: 'fa-code' },
  { id: 'shader', label: 'Shader', icon: 'fa-fire' },
  { id: 'games-graphics', label: 'Games & Graphics', icon: 'fa-gamepad' },
];

export function categoryLabel(id) {
  return CATEGORIES.find(c => c.id === id)?.label || id || 'Uncategorized';
}

export function categoryIcon(id) {
  return CATEGORIES.find(c => c.id === id)?.icon || 'fa-lightbulb';
}

const LIBRARY_DIR = '_library';
const LIBRARY_FILE = 'library.json';

/** Canonical generation-folder slug for a library prompt title. */
export function slugify(title) {
  return String(title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Seeds ──────────────────────────────────────────────────────────

let seedsCache = null;

export async function loadSeeds() {
  if (seedsCache) return seedsCache;
  try {
    const res = await fetch('./data/library.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    seedsCache = (data.prompts || []).map(p => ({ ...p, source: 'curated' }));
  } catch (e) {
    console.warn('[library] failed to load seed prompts:', e?.message || e);
    seedsCache = [];
  }
  return seedsCache;
}

// ── User library file ──────────────────────────────────────────────

function emptyUserLibrary() {
  return { version: 1, prompts: [], seedOverrides: {}, hiddenSeedIds: [], trash: [] };
}

export async function loadUserLibrary(rootHandle) {
  if (!rootHandle) return emptyUserLibrary();
  try {
    const text = await fs.readFile(rootHandle, LIBRARY_DIR, LIBRARY_FILE);
    const data = JSON.parse(text);
    return { ...emptyUserLibrary(), ...data };
  } catch (e) {
    return emptyUserLibrary();
  }
}

async function saveUserLibrary(rootHandle, data) {
  if (!rootHandle) throw new Error('Connect a directory first');
  await fs.saveFile(rootHandle, LIBRARY_DIR, LIBRARY_FILE, JSON.stringify(data, null, 2));
}

// ── Merged library ─────────────────────────────────────────────────

/**
 * Seeds with user overrides applied and hidden seeds removed, followed by
 * the user's own prompts. Each entry carries source: 'curated' | 'user'.
 */
export async function getLibrary(rootHandle) {
  const [seeds, user] = await Promise.all([loadSeeds(), loadUserLibrary(rootHandle)]);
  const merged = [];
  for (const seed of seeds) {
    if (user.hiddenSeedIds.includes(seed.id)) continue;
    const override = user.seedOverrides[seed.id];
    merged.push(override ? { ...seed, ...override, id: seed.id, source: 'curated' } : seed);
  }
  for (const p of user.prompts) {
    merged.push({ ...p, source: 'user' });
  }
  return merged;
}

export async function addPrompt(rootHandle, data) {
  const user = await loadUserLibrary(rootHandle);
  const entry = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: data.title || 'Untitled',
    category: data.category || 'html-js',
    tags: data.tags || [],
    prompt: data.prompt || '',
    notes: data.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revisions: [],
    importedFrom: data.importedFrom || undefined,
  };
  user.prompts.push(entry);
  await saveUserLibrary(rootHandle, user);
  return entry;
}

/**
 * Update a prompt. Seed edits are stored as overrides (the shipped seed file
 * is never written). If the prompt text changes, the previous title/text is
 * pushed onto a revisions list so nothing is overwritten destructively.
 */
export async function updatePrompt(rootHandle, id, changes) {
  const user = await loadUserLibrary(rootHandle);
  const seeds = await loadSeeds();
  const seed = seeds.find(s => s.id === id);

  if (seed) {
    const current = { ...seed, ...(user.seedOverrides[id] || {}) };
    const revisions = current.revisions || [];
    if (changes.prompt !== undefined && normalizeText(changes.prompt) !== normalizeText(current.prompt)) {
      revisions.push({ title: current.title, prompt: current.prompt, replacedAt: new Date().toISOString() });
    }
    user.seedOverrides[id] = {
      ...(user.seedOverrides[id] || {}),
      ...changes,
      revisions,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const entry = user.prompts.find(p => p.id === id);
    if (!entry) throw new Error(`Prompt not found: ${id}`);
    if (changes.prompt !== undefined && normalizeText(changes.prompt) !== normalizeText(entry.prompt)) {
      entry.revisions = entry.revisions || [];
      entry.revisions.push({ title: entry.title, prompt: entry.prompt, replacedAt: new Date().toISOString() });
    }
    Object.assign(entry, changes, { updatedAt: new Date().toISOString() });
  }
  await saveUserLibrary(rootHandle, user);
}

/**
 * Soft-remove: seeds are hidden (restorable by editing _library/library.json),
 * user prompts move to the trash array in the same file. Nothing is deleted.
 */
export async function removePrompt(rootHandle, id) {
  const user = await loadUserLibrary(rootHandle);
  const seeds = await loadSeeds();
  if (seeds.some(s => s.id === id)) {
    if (!user.hiddenSeedIds.includes(id)) user.hiddenSeedIds.push(id);
  } else {
    const idx = user.prompts.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Prompt not found: ${id}`);
    const [entry] = user.prompts.splice(idx, 1);
    user.trash.push({ ...entry, trashedAt: new Date().toISOString() });
  }
  await saveUserLibrary(rootHandle, user);
}

// ── Run stats (linking library prompts to saved generations) ───────

/**
 * Generations whose folder matches the prompt's slug (exactly, or with the
 * "-2"/"-3" suffix saveGeneration appends when prompts diverge).
 */
export function statsForPrompt(generations, prompt) {
  const slug = slugify(prompt.title);
  const matching = (generations || []).filter(g => {
    const folder = g.folderId || g.id;
    if (folder === slug) return true;
    if (folder.startsWith(slug + '-')) {
      return /^\d+$/.test(folder.slice(slug.length + 1));
    }
    return false;
  });
  if (matching.length === 0) return { runs: 0, models: 0, bestRating: 0, lastRunAt: '' };
  const models = new Set();
  let bestRating = 0;
  let lastRunAt = '';
  for (const g of matching) {
    const m = g.metadata || {};
    if (m.model) models.add(m.model);
    if ((m.rating || 0) > bestRating) bestRating = m.rating || 0;
    if ((m.createdAt || '') > lastRunAt) lastRunAt = m.createdAt || '';
  }
  return { runs: matching.length, models: models.size, bestRating, lastRunAt };
}

// ── Import scanning ────────────────────────────────────────────────

function guessCategory(promptText) {
  const t = normalizeText(promptText);
  if (/three\.?js/.test(t)) return 'threejs';
  if (/p5\.?js|p5 sketch/.test(t)) return 'p5js';
  if (/shader|glsl|webgl|raymarch/.test(t)) return 'shader';
  if (/\bgame\b|arcade|platformer|puzzle/.test(t)) return 'games-graphics';
  return 'html-js';
}

/**
 * Candidate prompts from Three Prompt Lab's bundled library (same-origin
 * fetch — read-only, that app is untouched).
 */
export async function scanThreePromptLab() {
  try {
    const res = await fetch('../three-prompt-lab/data/prompts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data || []).map(p => ({
      key: `lab:${p.id}`,
      title: p.title || 'Untitled',
      category: 'threejs',
      tags: [
        ...(p.taxonomy?.domain || []),
        ...(p.taxonomy?.style || []),
      ].slice(0, 6),
      prompt: p.prompt || '',
      notes: [
        p.notes?.whyInteresting || '',
        (p.notes?.commonFailures || []).length
          ? 'Watch for: ' + p.notes.commonFailures.join('; ') + '.'
          : '',
      ].filter(Boolean).join(' '),
      sourceLabel: 'Three Prompt Lab',
      importedFrom: `three-prompt-lab:${p.id}`,
    })).filter(item => item.prompt);
  } catch (e) {
    console.warn('[library] Three Prompt Lab scan failed:', e?.message || e);
    return [];
  }
}

/**
 * Candidate prompts from saved generations: one per folder with a prompt.md,
 * deduplicated by prompt text. Folders starting with "_" are reserved.
 */
export async function scanGenerationPrompts(rootHandle) {
  if (!rootHandle) return [];
  const items = [];
  const seenTexts = new Set();
  for await (const [name, handle] of rootHandle) {
    if (handle.kind !== 'directory' || name.startsWith('_')) continue;
    let promptText = '';
    try {
      const pf = await handle.getFileHandle('prompt.md');
      promptText = await (await pf.getFile()).text();
    } catch (e) { continue; }
    if (!promptText.trim()) continue;
    const norm = normalizeText(promptText);
    if (seenTexts.has(norm)) continue;
    seenTexts.add(norm);
    items.push({
      key: `gen:${name}`,
      title: name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: guessCategory(promptText),
      tags: [],
      prompt: promptText.trim(),
      notes: '',
      sourceLabel: `Saved generation: ${name}`,
      importedFrom: `generation:${name}`,
    });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

/** Mark candidates already present in the library (by normalized prompt text). */
export function markAlreadyInLibrary(items, libraryPrompts) {
  const existing = new Set(libraryPrompts.map(p => normalizeText(p.prompt)));
  return items.map(item => ({
    ...item,
    alreadyInLibrary: existing.has(normalizeText(item.prompt)),
  }));
}

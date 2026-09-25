// File-system replacement for localStorage.
//
// Each app stores its preferences in <root>/<appId>/config/settings.json so
// the data root is fully portable: copy the folder to another machine, pick
// it once, and every setting is intact. The browser holds only the directory
// handle (in IDB); nothing else.
//
// The path-based primitives at the bottom (loadAt / saveAt / migrateLegacyAt)
// are also used by suite-prefs.js for cross-app state at <root>/_suite/<area>.json.
// Any callsite that needs to read/write a JSON file under the data root can
// reach for them rather than reimplementing the open / read / atomic-write
// dance.

import { getRoot } from './data-root-manager.js';
import { describeLoss, backupName } from './config-loss.js';

const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const APP_SETTINGS_FILE = 'settings.json';
const APP_CONFIG_DIR = 'config';

// In-memory cache keyed by the full path string. Populated on successful
// disk read and overwritten on every save; only seeded with `{}` when the
// file genuinely doesn't exist yet.
const cache = new Map();
const saveQueues = new Map();

/** Empty for migration purposes: nothing there worth keeping. */
function isEmptyValue(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function validateAppId(appId) {
  if (typeof appId !== 'string' || !APP_ID_RE.test(appId)) {
    throw new Error(`Invalid appId: ${appId}`);
  }
}

function appConfigPath(appId) {
  validateAppId(appId);
  return `${appId}/${APP_CONFIG_DIR}/${APP_SETTINGS_FILE}`;
}

// Walk a `'a/b/c.json'` path under the data root, creating intermediate
// directories as needed. Returns `{ dir, fileName }` or null when no root.
async function resolvePath(path) {
  const root = await getRoot();
  if (!root) return null;
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) throw new Error('Empty path');
  const fileName = parts.pop();
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return { dir, fileName };
}

// `status` separates "nothing there yet" from "there IS something there and I
// could not read it" — the difference between a safe first write and one that
// would destroy the file. Callers that only want the data use readJsonFile.
async function readJsonDetailed(dir, fileName) {
  let text = '';
  try {
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    text = await file.text();
  } catch (e) {
    if (e && e.name === 'NotFoundError') return { data: {}, text: '', status: 'missing' };
    throw e;
  }
  if (!text.trim()) return { data: {}, text, status: 'missing' };
  try {
    return { data: JSON.parse(text), text, status: 'ok' };
  } catch (e) {
    console.warn(`[app-config] ${fileName} corrupted, treating as empty:`, e.message);
    return { data: {}, text, status: 'corrupt' };
  }
}

async function readJsonFile(dir, fileName) {
  return (await readJsonDetailed(dir, fileName)).data;
}

/**
 * Keep the file that is about to be replaced, as a sibling `.bak`. Used when a
 * write would remove data or when the old file could not be parsed, so a
 * destructive save is always recoverable. Best-effort: a failed backup is
 * reported but never blocks the write.
 */
async function keepPrevious(dir, fileName, text, why) {
  if (!text) return null;
  try {
    const name = backupName(fileName);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    console.warn(`[app-config] ${fileName}: ${why} — previous version kept as ${name}`);
    return name;
  } catch (e) {
    console.error(`[app-config] ${fileName}: could not keep a backup before ${why}:`, e);
    return null;
  }
}

// Atomic-ish write: tmp file → target file → cleanup tmp. The File System
// Access API has no rename, so corruption risk is bounded to the swap step.
async function writeAtomic(dir, fileName, text) {
  if (dir._atomicWrites) {
    // The server data root already replaces the file atomically.
    const handle = await dir.getFileHandle(fileName, { create: true });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return;
  }
  const tmpName = `${fileName}.tmp`;
  const tmp = await dir.getFileHandle(tmpName, { create: true });
  let w = await tmp.createWritable();
  await w.write(text);
  await w.close();
  const target = await dir.getFileHandle(fileName, { create: true });
  w = await target.createWritable();
  await w.write(text);
  await w.close();
  try { await dir.removeEntry(tmpName); } catch { /* best-effort cleanup */ }
}

// === Path-based primitives ===
// These are the building blocks; per-app and per-suite helpers are thin
// wrappers below.

/**
 * Read a JSON file under the data root. Returns the parsed object, or `{}`
 * when the file doesn't exist or no root is connected.
 *
 * Defaults are intentionally NOT applied — callers merging multiple sources
 * (e.g. localStorage scratch + disk in app-prefs) need to distinguish
 * "field present on disk" from "field missing, fall back to default".
 */
export async function loadAt(path) {
  return (await loadAtDetailed(path)).data;
}

/**
 * loadAt plus how the read went: `ok` (parsed from disk), `missing` (no file
 * yet), `corrupt` (unparseable), `no-root` (nothing connected) or `error` (the
 * file is there but unreadable). Callers that decide whether it is safe to
 * WRITE need this: `{}` from an error means "unknown", not "empty".
 */
export async function loadAtDetailed(path) {
  if (cache.has(path)) return { data: { ...cache.get(path) }, status: 'ok' };
  let resolved;
  try {
    resolved = await resolvePath(path);
  } catch (e) {
    // No data root to reach (no handle, no IndexedDB, permission withdrawn).
    // Nothing can be written either, so this is "not connected", not "the file
    // is unreadable" — only the latter has to block writes.
    return { data: {}, status: 'no-root', error: e };
  }
  if (!resolved) return { data: {}, status: 'no-root' };
  let read;
  try {
    read = await readJsonDetailed(resolved.dir, resolved.fileName);
  } catch (e) {
    console.error(`[app-config] loadAt(${path}) failed:`, e);
    return { data: {}, status: 'error', error: e };
  }
  if (read.status !== 'corrupt') cache.set(path, read.data);
  return { data: { ...read.data }, status: read.status };
}

/**
 * Shallow-merge `partial` into the JSON file at `path`. Returns the new
 * full object, or null when no root is connected. Atomic-ish via a
 * sibling .tmp file.
 */
export async function saveAt(path, partial) {
  const previous = saveQueues.get(path) || Promise.resolve();
  const nextSave = previous
    .catch(() => {})
    .then(() => saveAtNow(path, partial));
  saveQueues.set(path, nextSave);
  nextSave.finally(() => {
    if (saveQueues.get(path) === nextSave) saveQueues.delete(path);
  }).catch(() => {});
  return nextSave;
}

async function saveAtNow(path, partial) {
  const resolved = await resolvePath(path);
  if (!resolved) return null;
  let previous;
  try {
    previous = await readJsonDetailed(resolved.dir, resolved.fileName);
  } catch (e) {
    // The file exists but could not be read. Writing now would replace
    // settings we cannot see with only the fields this caller happens to
    // hold, so the save is refused instead.
    throw new Error(`Refusing to overwrite ${path}: it exists but could not be read (${e.message})`);
  }
  const current = previous.data;
  const next = { ...current, ...partial };
  const losses = describeLoss(current, next);
  if (previous.status === 'corrupt') {
    await keepPrevious(resolved.dir, resolved.fileName, previous.text, 'the stored file could not be parsed');
  } else if (losses.length) {
    await keepPrevious(resolved.dir, resolved.fileName, previous.text, `this write drops data (${losses.join('; ')})`);
  }
  await writeAtomic(resolved.dir, resolved.fileName, JSON.stringify(next, null, 2));
  cache.set(path, next);
  return next;
}

/**
 * Decode a value read from the localStorage scratch.
 *
 * The scratch stores plain strings raw ('dark', 'BSA-…') and everything else
 * JSON-encoded, so a value that looks structured is parsed back. Migrating
 * without this wrote a whole list to disk AS A STRING; the reader then saw
 * "not an array", treated the area as empty, and the next save replaced it —
 * which is how an ensemble was lost.
 */
export function decodeScratchValue(raw) {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  if (raw.length > 0 && (raw[0] === '[' || raw[0] === '{')) {
    try { return JSON.parse(raw); } catch { /* keep the raw string */ }
  }
  return raw;
}

/**
 * One-shot localStorage → file migration for the JSON file at `path`.
 * For each `keyMap` entry whose LS key is set, the LS value is written to
 * disk if the corresponding field is missing, then the LS key is removed.
 * No-op when no root is connected; safe to call repeatedly.
 */
export async function migrateLegacyAt(path, keyMap) {
  if (!keyMap || typeof keyMap !== 'object') return;
  const found = {};
  for (const [field, lsKey] of Object.entries(keyMap)) {
    try {
      const v = localStorage.getItem(lsKey);
      if (v !== null) found[field] = decodeScratchValue(v);
    } catch { /* private mode */ }
  }
  if (!Object.keys(found).length) return;

  const resolved = await resolvePath(path);
  if (!resolved) return; // no root yet; try again next reconnect

  // DISK wins where it has a value; the scratch only fills the gaps.
  //
  // It used to be the other way round, on the assumption that the scratch is
  // this browser's own, newer copy. That is false the moment a data root is
  // shared: the Quest's first visit carried an empty scratch and wrote it
  // straight over the desktop's ensembles, OpenRouter key and provider
  // defaults. A per-device leftover must never outrank the shared file.
  let current = {};
  try {
    current = (await readJsonDetailed(resolved.dir, resolved.fileName)).data;
  } catch (e) {
    console.error(`[app-config] migrateLegacyAt(${path}) read step failed:`, e);
    return; // unreadable: migrating now could destroy what is there
  }
  const gaps = {};
  for (const [field, value] of Object.entries(found)) {
    if (isEmptyValue(current[field])) gaps[field] = value;
  }
  if (!Object.keys(gaps).length) {
    // Disk already answers for every field: the scratch has nothing to add and
    // is rewritten from the hydrated snapshot, so the legacy keys can go.
    for (const lsKey of Object.values(keyMap)) {
      try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
    }
    return;
  }
  const persisted = await saveAt(path, gaps);
  if (persisted === null) return; // disk write failed (no root) — keep LS

  // Disk now matches LS; drop the legacy keys.
  for (const lsKey of Object.values(keyMap)) {
    try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
  }
}

/**
 * One-shot migration of a JSON-encoded localStorage value into a single
 * field of the JSON file at `path`. Reads `lsKey`, JSON-parses it, writes
 * the parsed value into `field`, and deletes the LS key on confirmed disk
 * write. Used for legacy LS blobs (arrays / objects) that the simple
 * string migration in migrateLegacyAt can't handle.
 *
 * Returns true on a successful migration; false if the LS key was absent,
 * the JSON failed to parse, or no root was connected (LS preserved for
 * the next attempt).
 */
export async function migrateJsonFieldAt(path, field, lsKey) {
  let raw;
  try { raw = localStorage.getItem(lsKey); } catch { return false; }
  if (raw === null) return false;

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    console.warn(`[app-config] migrateJsonFieldAt(${path}.${field}) — bad JSON in ${lsKey}:`, e.message);
    return false;
  }

  // As in migrateLegacyAt: a per-device scratch fills a gap, it never
  // overwrites what the (possibly shared) file already holds.
  const existing = await loadAtDetailed(path);
  if (existing.status === 'error') return false;
  if (!isEmptyValue(existing.data?.[field])) {
    try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
    return false;
  }
  const persisted = await saveAt(path, { [field]: parsed });
  if (persisted !== null) {
    try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
    return true;
  }
  return false;
}

// === Per-app convenience wrappers ===

/** Path of an app's settings file under the data root. Exported so app-prefs
 *  can compose path-based primitives without redoing the validation. */
export function appSettingsPath(appId) {
  return appConfigPath(appId);
}

/** Read `<root>/<appId>/config/settings.json`. */
export async function loadConfig(appId) {
  return loadAt(appConfigPath(appId));
}

/** Shallow-merge into `<root>/<appId>/config/settings.json`. */
export async function saveConfig(appId, partial) {
  return saveAt(appConfigPath(appId), partial);
}

/** Migrate legacy localStorage keys into `<root>/<appId>/config/settings.json`. */
export async function migrateFromLocalStorage(appId, keyMap) {
  return migrateLegacyAt(appConfigPath(appId), keyMap);
}

/** Drop the in-memory cache. Pass an appId to clear a single app, a path
 *  to clear a single file, or no argument to clear everything. */
export function invalidateConfigCache(appIdOrPath) {
  if (appIdOrPath === undefined) {
    cache.clear();
    return;
  }
  // Distinguish a literal path (contains '/') from an appId.
  const path = appIdOrPath.includes('/') ? appIdOrPath : appConfigPath(appIdOrPath);
  cache.delete(path);
}

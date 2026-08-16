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

const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const APP_SETTINGS_FILE = 'settings.json';
const APP_CONFIG_DIR = 'config';

// In-memory cache keyed by the full path string. Populated on successful
// disk read and overwritten on every save; only seeded with `{}` when the
// file genuinely doesn't exist yet.
const cache = new Map();
const saveQueues = new Map();

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

async function readJsonFile(dir, fileName) {
  try {
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    if (e && e.name === 'NotFoundError') return {};
    if (e instanceof SyntaxError) {
      console.warn(`[app-config] ${fileName} corrupted, treating as empty:`, e.message);
      return {};
    }
    throw e;
  }
}

// Atomic-ish write: tmp file → target file → cleanup tmp. The File System
// Access API has no rename, so corruption risk is bounded to the swap step.
async function writeAtomic(dir, fileName, text) {
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
  if (cache.has(path)) return { ...cache.get(path) };
  const resolved = await resolvePath(path);
  if (!resolved) return {};
  let persisted;
  try {
    persisted = await readJsonFile(resolved.dir, resolved.fileName);
  } catch (e) {
    console.error(`[app-config] loadAt(${path}) failed:`, e);
    return {};
  }
  cache.set(path, persisted);
  return { ...persisted };
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
  let current;
  try {
    current = await readJsonFile(resolved.dir, resolved.fileName);
  } catch (e) {
    console.error(`[app-config] saveAt(${path}) read step failed:`, e);
    current = {};
  }
  const next = { ...current, ...partial };
  await writeAtomic(resolved.dir, resolved.fileName, JSON.stringify(next, null, 2));
  cache.set(path, next);
  return next;
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
      if (v !== null) found[field] = v;
    } catch { /* private mode */ }
  }
  if (!Object.keys(found).length) return;

  const resolved = await resolvePath(path);
  if (!resolved) return; // no root yet; try again next reconnect

  // LS wins on disagreement. The localStorage scratch is kept in lockstep
  // by setSuite/setPref's writeLegacyScratch, so when populated it is
  // always at least as recent as disk. Always writing through means a
  // stale disk (e.g. left over from a fixed bug) gets corrected on the
  // next hydrate instead of permanently shadowing the user's good state.
  const persisted = await saveAt(path, found);
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

  // LS wins on disagreement. The localStorage scratch is kept in lockstep
  // by setSuite/setPref's writeLegacyScratch, so when populated it is
  // always at least as recent as disk. Always writing through means a
  // stale disk (e.g. left over from a fixed bug) gets corrected on the
  // next hydrate instead of permanently shadowing the user's good state.
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

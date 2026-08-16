// Suite-level analogue of app-prefs.
//
// Holds cross-app state — API keys, the provider list, the global theme pack,
// wan2gp node configuration, etc. — at <root>/_suite/<area>.json. Same
// FOUC-free boot pattern as app-prefs: synchronous snapshot from a localStorage
// scratch + defaults for first paint, then async hydrate against disk on mount,
// then disk-authoritative thereafter.
//
// Each "area" is a separate file. Areas have no uniform legacy-key convention
// (cf. app-prefs's `${appId}-theme` default), so callers always pass an
// explicit legacyKeys map describing which localStorage keys to migrate from.

import { loadAt, saveAt, migrateLegacyAt, migrateJsonFieldAt } from './app-config.js';
export { saveAt as saveSuiteAt };

const AREA_RE = /^[a-z0-9][a-z0-9-]*$/;
const SUITE_DIR = '_suite';

const snapshots = new Map();      // area -> snapshot object
const subscribers = new Map();    // area -> Set<callback>
const legacyKeyMaps = new Map();  // area -> { field: lsKey }

function validateArea(area) {
  if (typeof area !== 'string' || !AREA_RE.test(area)) {
    throw new Error(`Invalid suite area: ${area}`);
  }
}

function pathFor(area) {
  validateArea(area);
  return `${SUITE_DIR}/${area}.json`;
}

// Merge into the existing map rather than replacing — multiple shared
// services may register keys for the same area (e.g. brave-search and
// openrouter both write to '_suite/api-keys.json').
function rememberLegacyKeys(area, lk) {
  if (!lk || typeof lk !== 'object') return;
  const prev = legacyKeyMaps.get(area) || {};
  legacyKeyMaps.set(area, { ...prev, ...lk });
}

function decodeLegacyValue(raw) {
  // Plain strings (e.g. 'dark', 'BSA-xxx') are kept as-is; values that look
  // structured (start with '[' or '{') are JSON-parsed so array/object
  // fields like a providers list round-trip through localStorage scratch.
  if (raw === null || raw === undefined) return undefined;
  if (raw.length > 0 && (raw[0] === '[' || raw[0] === '{')) {
    try { return JSON.parse(raw); } catch { /* fall through to raw */ }
  }
  return raw;
}

function readLegacy(legacyKeys) {
  const out = {};
  if (!legacyKeys) return out;
  for (const [field, lsKey] of Object.entries(legacyKeys)) {
    try {
      const v = localStorage.getItem(lsKey);
      if (v !== null) out[field] = decodeLegacyValue(v);
    } catch { /* private mode */ }
  }
  return out;
}

function notify(area) {
  const subs = subscribers.get(area);
  if (!subs) return;
  const snap = snapshots.get(area);
  for (const cb of subs) {
    try { cb(snap); } catch (e) { console.error('[suite-prefs] subscriber threw:', e); }
  }
}

/**
 * Synchronous snapshot for a suite area. Safe inside a useState lazy
 * initializer. Pre-hydrate, returns `{ ...defaults, ...legacyLS }`.
 *
 * @param {string} area
 * @param {{defaults?: object, legacyKeys?: Record<string,string>}} [opts]
 */
export function suite(area, { defaults = {}, legacyKeys } = {}) {
  validateArea(area);
  if (legacyKeys) rememberLegacyKeys(area, legacyKeys);
  // Layer this caller's defaults under the existing snapshot, then this
  // caller's localStorage readthrough on top. Multiple modules sharing the
  // same area (e.g. openrouter.js and brave-search.js both writing to
  // 'api-keys') each get their fields seeded; without this merge a later
  // import's defaults/legacyKeys would be silently dropped.
  const fresh = readLegacy(legacyKeys);
  const existing = snapshots.get(area) || {};
  const next = { ...defaults, ...existing, ...fresh };
  snapshots.set(area, next);
  return next;
}

/**
 * Hydrate the snapshot from <root>/_suite/<area>.json, migrating any legacy
 * localStorage keys in the process. Idempotent — safe to call again after
 * the user reconnects a root.
 */
export async function hydrateSuite(area, { defaults = {}, legacyKeys } = {}) {
  validateArea(area);
  if (legacyKeys) rememberLegacyKeys(area, legacyKeys);
  const path = pathFor(area);

  if (legacyKeys) {
    try {
      await migrateLegacyAt(path, legacyKeys);
    } catch (e) {
      console.error(`[suite-prefs] migrateLegacyAt(${path}) failed:`, e);
    }
  }

  let disk = {};
  try {
    disk = await loadAt(path);
  } catch (e) {
    console.error(`[suite-prefs] loadAt(${path}) failed:`, e);
  }

  const previous = snapshots.get(area) || {};
  const next = { ...defaults, ...previous, ...disk };
  snapshots.set(area, next);
  writeLegacySnapshot(area, next);
  notify(area);
  return next;
}

// Synchronous LS scratch write. For string fields we store the value raw
// (matching the legacy LS shape so existing migrate/decoder paths work).
// For non-string fields we JSON.stringify so arrays/objects also survive
// reload-without-root; readLegacy decodes by sniffing the first character.
function writeLegacyScratch(area, partial) {
  const lk = legacyKeyMaps.get(area);
  if (!lk) return;
  for (const [field, value] of Object.entries(partial)) {
    const key = lk[field];
    if (!key) continue;
    let encoded;
    if (typeof value === 'string') {
      encoded = value;
    } else if (value === null || value === undefined) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      continue;
    } else {
      try { encoded = JSON.stringify(value); } catch { continue; }
    }
    try { localStorage.setItem(key, encoded); } catch { /* private mode */ }
  }
}

function writeLegacySnapshot(area, snapshot) {
  const lk = legacyKeyMaps.get(area);
  if (!lk || !snapshot || typeof snapshot !== 'object') return;
  const partial = {};
  for (const field of Object.keys(lk)) {
    if (snapshot[field] !== undefined) partial[field] = snapshot[field];
  }
  writeLegacyScratch(area, partial);
}

function handleStorageEvent(event) {
  if (!event?.key) return;
  for (const [area, lk] of legacyKeyMaps.entries()) {
    for (const [field, lsKey] of Object.entries(lk)) {
      if (lsKey !== event.key) continue;
      const current = snapshots.get(area) || {};
      const decoded = decodeLegacyValue(event.newValue);
      const next = { ...current, [field]: decoded === undefined ? '' : decoded };
      snapshots.set(area, next);
      notify(area);
    }
  }
}

try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', handleStorageEvent);
  }
} catch { /* non-browser tests */ }

/** Update one field in a suite area. Snapshot updates synchronously, disk
 *  write happens in the background, LS scratch keeps the value across
 *  reload-without-root. */
export async function setSuite(area, field, value) {
  validateArea(area);
  const current = snapshots.get(area) || {};
  const next = { ...current, [field]: value };
  snapshots.set(area, next);
  notify(area);
  writeLegacyScratch(area, { [field]: value });
  try {
    await saveAt(pathFor(area), { [field]: value });
  } catch (e) {
    console.error(`[suite-prefs] saveAt(${area}.${field}) failed:`, e);
  }
  return next;
}

/** Bulk update — write multiple fields in one disk transaction. */
export async function setSuiteFields(area, partial) {
  validateArea(area);
  const current = snapshots.get(area) || {};
  const next = { ...current, ...partial };
  snapshots.set(area, next);
  notify(area);
  writeLegacyScratch(area, partial);
  try {
    await saveAt(pathFor(area), partial);
  } catch (e) {
    console.error(`[suite-prefs] saveAt(${area}) bulk failed:`, e);
  }
  return next;
}

/** Subscribe to snapshot changes for a suite area. Returns an unsubscribe. */
export function subscribeSuite(area, cb) {
  validateArea(area);
  let set = subscribers.get(area);
  if (!set) {
    set = new Set();
    subscribers.set(area, set);
  }
  set.add(cb);
  return () => { set.delete(cb); };
}

/** Synchronous read of a single field from the cached snapshot, useful in
 *  imperative shared services (e.g. `getOpenRouterKey()` in openrouter.js). */
export function getSuiteField(area, field, fallback) {
  validateArea(area);
  const snap = snapshots.get(area);
  if (!snap) return fallback;
  return snap[field] !== undefined ? snap[field] : fallback;
}

/**
 * One-shot migration of a JSON-encoded localStorage value into a suite area
 * field. Reads `lsKey`, JSON-parses, writes the parsed value to disk under
 * `area.field`, and deletes the LS key on confirmed disk write. Used by
 * shared services whose legacy storage held an array or object rather than
 * a plain string (where the regular legacyKeys map suffices).
 *
 * Returns true if the migration ran and the disk write succeeded; false if
 * the LS key was absent, the JSON failed to parse, or no root was connected
 * (in which case the LS key is preserved for the next attempt).
 */
export async function migrateJsonField(area, field, lsKey) {
  validateArea(area);
  return migrateJsonFieldAt(pathFor(area), field, lsKey);
}

/** Drop cached snapshots/subscribers. Used by tests. */
export function _resetSuitePrefs() {
  snapshots.clear();
  subscribers.clear();
  legacyKeyMaps.clear();
}

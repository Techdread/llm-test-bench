// Ergonomic wrapper over app-config.js for the universal app-preferences
// pattern (theme + provider + model + a handful of app-specific scalars).
//
// Why this exists:
//   The audit showed ~50 apps using the same shape: a few keys named
//   `${APP_ID}-theme`, `${APP_ID}-provider`, `${APP_ID}-model`, often plus
//   one or two app-specific scalars. Reimplementing the same useState +
//   useEffect dance per app is the bulk of the localStorage footprint.
//
// Boot flow (FOUC-free):
//   1. App calls `prefs(APP_ID, { defaults })` synchronously inside a
//      useState lazy initializer. Pre-hydrate, this returns
//      `{ ...defaults, ...legacyLocalStorage }` so the very first paint
//      matches the user's last preferences from before the migration.
//   2. App calls `hydrateAppPrefs(APP_ID, { defaults })` in an effect.
//      This loads <root>/<appId>/config/settings.json, migrates any
//      legacy localStorage keys to disk, deletes the LS keys, refreshes
//      the in-memory snapshot, and notifies subscribers.
//   3. Subsequent `prefs(...)` calls return the hydrated snapshot.
//      `setPref(...)` writes through to disk and notifies subscribers.
//
// When no root is connected the hydrate is a no-op and the snapshot keeps
// whatever the synchronous LS readthrough produced. Callers can re-invoke
// hydrate after the user reconnects; everything lands on disk then.

import {
  loadConfig,
  saveConfig,
  migrateFromLocalStorage,
  migrateJsonFieldAt,
  appSettingsPath,
} from './app-config.js';

// In-memory snapshot per appId. Survives root reconnects; cleared via
// _resetAppPrefs in tests.
const snapshots = new Map();
const subscribers = new Map(); // appId -> Set<callback>
const legacyKeyMaps = new Map(); // appId -> { field: lsKey } for LS scratch / migration

function rememberLegacyKeys(appId, lk) {
  if (lk && typeof lk === 'object') legacyKeyMaps.set(appId, { ...lk });
}

function notify(appId) {
  const subs = subscribers.get(appId);
  if (!subs) return;
  const snap = snapshots.get(appId);
  for (const cb of subs) {
    try { cb(snap); } catch (e) { console.error('[app-prefs] subscriber threw:', e); }
  }
}

function decodeLegacyValue(raw) {
  // Plain strings stay strings; values that look structured ('['/'{') are
  // JSON-parsed so array/object fields round-trip through the LS scratch.
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
    } catch { /* private mode / storage disabled */ }
  }
  return out;
}

/**
 * Default legacy localStorage key map for the universal trio. Pass APP_ID
 * and you get `{ theme: '<id>-theme', provider: '<id>-provider', model: '<id>-model' }`.
 *
 * Apps that diverged from the convention (e.g. `code-arena` uses
 * `code-arena-or-model` for the OpenRouter model id) should pass an
 * explicit `legacyKeys` map to prefs/hydrate.
 */
export function defaultLegacyKeys(appId) {
  return {
    theme: `${appId}-theme`,
    provider: `${appId}-provider`,
    model: `${appId}-model`,
  };
}

/**
 * Synchronous snapshot — safe to call inside a useState lazy initializer.
 *
 * Pre-hydrate: returns `{ ...defaults, ...legacyLS }`. The first paint
 * therefore matches the user's pre-migration preferences, no FOUC.
 * Post-hydrate: returns the cached snapshot from disk.
 *
 * @param {string} appId
 * @param {{defaults?: object, legacyKeys?: Record<string,string>}} [opts]
 */
export function prefs(appId, { defaults = {}, legacyKeys } = {}) {
  const lk = legacyKeys || defaultLegacyKeys(appId);
  rememberLegacyKeys(appId, lk);
  // Merge into the existing snapshot rather than short-circuiting — multiple
  // modules calling prefs(APP_ID) with different fields/legacyKeys all need
  // their values seeded.
  const fresh = readLegacy(lk);
  const existing = snapshots.get(appId) || {};
  const next = { ...defaults, ...existing, ...fresh };
  snapshots.set(appId, next);
  return next;
}

/**
 * Hydrate the snapshot from disk and migrate legacy localStorage keys.
 * Call once at app boot, and again after the user reconnects a root
 * (the first call is a no-op while no root is available).
 *
 * Idempotent in the same session; safe to call repeatedly.
 *
 * @param {string} appId
 * @param {{defaults?: object, legacyKeys?: Record<string,string>}} [opts]
 * @returns {Promise<object>} the hydrated snapshot
 */
export async function hydrateAppPrefs(appId, { defaults = {}, legacyKeys } = {}) {
  const lk = legacyKeys || defaultLegacyKeys(appId);
  rememberLegacyKeys(appId, lk);

  // Best-effort migration. No-op when no root; legacy keys stay until
  // the next call (e.g. after the user picks a directory).
  try {
    await migrateFromLocalStorage(appId, lk);
  } catch (e) {
    console.error(`[app-prefs] migrateFromLocalStorage(${appId}) failed:`, e);
  }

  // loadConfig returns persisted-only data (or {} if no file / no root).
  // That lets us merge `disk` over `previous` without clobbering the LS
  // scratch values that prefs() captured at boot.
  let disk = {};
  try {
    disk = await loadConfig(appId);
  } catch (e) {
    console.error(`[app-prefs] loadConfig(${appId}) failed:`, e);
  }

  const previous = snapshots.get(appId) || {};
  const next = { ...defaults, ...previous, ...disk };
  snapshots.set(appId, next);
  notify(appId);
  return next;
}

/**
 * Update a single preference. Snapshot updates synchronously and subscribers
 * fire immediately; the disk write happens in the background. Returns the
 * new snapshot.
 *
 * For known string fields (those listed in the legacyKeys map) we also write
 * synchronously to localStorage as a scratch fallback. This lets the value
 * survive a reload even before the user has reconnected the data root —
 * the next hydrate-with-root will migrate the LS value to disk and clear it.
 */
export async function setPref(appId, field, value) {
  const current = snapshots.get(appId) || {};
  const next = { ...current, [field]: value };
  snapshots.set(appId, next);
  notify(appId);
  writeLegacyScratch(appId, { [field]: value });
  try {
    await saveConfig(appId, { [field]: value });
  } catch (e) {
    console.error(`[app-prefs] saveConfig(${appId}.${field}) failed:`, e);
  }
  return next;
}

/**
 * Bulk update — write multiple fields in one disk transaction. Same
 * semantics as setPref otherwise.
 */
export async function setPrefs(appId, partial) {
  const current = snapshots.get(appId) || {};
  const next = { ...current, ...partial };
  snapshots.set(appId, next);
  notify(appId);
  writeLegacyScratch(appId, partial);
  try {
    await saveConfig(appId, partial);
  } catch (e) {
    console.error(`[app-prefs] saveConfig(${appId}) bulk failed:`, e);
  }
  return next;
}

// Synchronous LS scratch write for any partial whose field has a registered
// legacy key. Skips non-string values for now; if/when an app needs richer
// fallback we can JSON-encode here and decode in readLegacy.
// Synchronous LS scratch write — strings raw, structured values JSON-encoded
// so they round-trip through reload-without-root. readLegacy decodes by
// sniffing the first character of the stored value.
function writeLegacyScratch(appId, partial) {
  const lk = legacyKeyMaps.get(appId);
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

/**
 * Subscribe to snapshot changes. Callback fires after every hydrate and
 * every setPref/setPrefs. Returns an unsubscribe function.
 */
export function subscribeAppPrefs(appId, cb) {
  let set = subscribers.get(appId);
  if (!set) {
    set = new Set();
    subscribers.set(appId, set);
  }
  set.add(cb);
  return () => { set.delete(cb); };
}

/**
 * One-shot migration of a JSON-encoded localStorage value into a single
 * field of an app's settings.json. For legacy blobs (arrays/objects) that
 * the string migration in migrateFromLocalStorage can't represent.
 */
export async function migrateAppJsonField(appId, field, lsKey) {
  return migrateJsonFieldAt(appSettingsPath(appId), field, lsKey);
}

/** Drop cached snapshots/subscribers. Used by tests; rarely useful in prod. */
export function _resetAppPrefs() {
  snapshots.clear();
  subscribers.clear();
  legacyKeyMaps.clear();
}

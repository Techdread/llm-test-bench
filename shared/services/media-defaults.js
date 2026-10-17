// Media-services defaults store.
//
// Layered storage: per-app overrides win over global defaults.
//   <root>/_suite/media-defaults.json        — global defaults (edited in media-settings)
//   <root>/<appId>/config/settings.json      — per-app overrides under the
//                                              `mediaDefaults` field, edited in-app
//
// Lookup order in `getDefault(svc, key, fallback, { appId })`:
//   1. per-app blob (if appId given)
//   2. global blob
//   3. fallback (passed by the caller)

import {
  suite,
  hydrateSuite,
  setSuite,
  getSuiteField,
  migrateJsonField,
} from './suite-prefs.js';
import {
  prefs,
  hydrateAppPrefs,
  setPref,
  migrateAppJsonField,
} from './app-prefs.js';

export const SERVICES = ['textToImage', 'imageEdit', 'textToVideo', 'imageToVideo', 'textToSpeech', 'voiceCloneTTS', 'musicGeneration'];

const GLOBAL_AREA = 'media-defaults';
const FIELD_BLOB = 'blob';
const LEGACY_GLOBAL_KEY = 'devtools-hub-media-defaults';
const APP_FIELD = 'mediaDefaults';

function legacyAppKey(appId) {
  return `${appId}-media-defaults`;
}

// Seed and hydrate the global suite area on import. Per-app blobs are
// migrated lazily inside getAppDefaults so we don't pre-touch every
// possible appId. The legacyKeys registration lets edits survive reload
// even before the data root is connected.
const GLOBAL_LEGACY = { [FIELD_BLOB]: LEGACY_GLOBAL_KEY };
suite(GLOBAL_AREA, { defaults: { [FIELD_BLOB]: {} }, legacyKeys: GLOBAL_LEGACY });
(async () => {
  await migrateJsonField(GLOBAL_AREA, FIELD_BLOB, LEGACY_GLOBAL_KEY);
  await hydrateSuite(GLOBAL_AREA, { defaults: { [FIELD_BLOB]: {} }, legacyKeys: GLOBAL_LEGACY });
})();

// Track which appIds have had their media-defaults migrated this session
// so we don't fire the migration helper on every getAppDefaults call.
const migratedApps = new Set();

function ensureAppHydrated(appId) {
  if (migratedApps.has(appId)) return;
  migratedApps.add(appId);
  const legacyKeys = { [APP_FIELD]: legacyAppKey(appId) };
  // Synchronous seed of the app-prefs snapshot so the LS-derived value is
  // visible immediately. Registering the legacy key here also activates the
  // JSON scratch fallback so edits survive reload-without-root.
  prefs(appId, { legacyKeys });
  (async () => {
    await migrateAppJsonField(appId, APP_FIELD, legacyAppKey(appId));
    await hydrateAppPrefs(appId, { legacyKeys });
  })();
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// ── Global blob (edited in media-settings) ──

export function getAllDefaults() {
  return asObject(getSuiteField(GLOBAL_AREA, FIELD_BLOB, {}));
}

export function saveDefaults(blob) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    throw new Error('saveDefaults: expected a plain object');
  }
  setSuite(GLOBAL_AREA, FIELD_BLOB, blob);
}

// ── Per-app blob (edited inside the consuming app) ──

export function getAppDefaults(appId) {
  if (!appId) return {};
  ensureAppHydrated(appId);
  const snap = prefs(appId);
  return asObject(snap[APP_FIELD]);
}

export function saveAppDefaults(appId, blob) {
  if (!appId) throw new Error('saveAppDefaults: appId is required');
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    throw new Error('saveAppDefaults: expected a plain object');
  }
  ensureAppHydrated(appId);
  setPref(appId, APP_FIELD, blob);
}

function readEntryValue(blob, serviceId, key) {
  const entry = blob?.[serviceId];
  if (entry && typeof entry === 'object' && key in entry) {
    const v = entry[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Resolve a default with per-app override → global → fallback.
 * @param {string} serviceId
 * @param {string} key
 * @param {*} fallback
 * @param {object} [opts]
 * @param {string} [opts.appId] If provided, the per-app blob is checked first.
 */
export function getDefault(serviceId, key, fallback, opts = {}) {
  if (opts.appId) {
    const v = readEntryValue(getAppDefaults(opts.appId), serviceId, key);
    if (v !== undefined) return v;
  }
  const v = readEntryValue(getAllDefaults(), serviceId, key);
  if (v !== undefined) return v;
  return fallback;
}

/**
 * Set a single default value.
 * @param {string} serviceId
 * @param {string} key
 * @param {*} value
 * @param {object} [opts]
 * @param {string} [opts.appId] If provided, writes to the per-app blob; else global.
 */
export function setDefault(serviceId, key, value, opts = {}) {
  const target = opts.appId
    ? { read: () => getAppDefaults(opts.appId), write: (b) => saveAppDefaults(opts.appId, b) }
    : { read: getAllDefaults, write: saveDefaults };

  const blob = { ...target.read() };
  const entry = (blob[serviceId] && typeof blob[serviceId] === 'object') ? { ...blob[serviceId] } : {};
  if (value === undefined || value === null || value === '') {
    delete entry[key];
  } else {
    entry[key] = value;
  }
  if (Object.keys(entry).length === 0) delete blob[serviceId];
  else blob[serviceId] = entry;
  target.write(blob);
}

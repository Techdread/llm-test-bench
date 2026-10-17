// Wan2GP backend nodes — multi-node registry with global active + per-app override.
//
// Persistence:
//   <root>/_suite/wan2gp-nodes.json
//     list:     Array<{id, name, baseUrl, token}>
//     activeId: string (id of the global active node)
//   <root>/<appId>/config/settings.json
//     wan2gpNode: string (per-app override; takes precedence)
//
// Resolution order in `resolveNode({ nodeId, appId })`:
//   1. nodeId (explicit per-call) → return that node if it exists
//   2. per-app override            → return that node if it exists
//   3. global active                → return that node if it exists
//   4. first node in the list
//   5. synthesised fallback (the legacy proxy default)
//
// First-load seeding: if no node list exists on disk yet, the legacy
// single-endpoint keys (`devtools-hub-wan2gp-endpoint`, `…-token`) are
// merged with the historical preset list to produce the initial registry.

import { suite, hydrateSuite, setSuite, setSuiteFields, getSuiteField } from './suite-prefs.js';
import { prefs, hydrateAppPrefs, setPref } from './app-prefs.js';
import { migrateJsonFieldAt } from './app-config.js';

const PREFS_AREA = 'wan2gp-nodes';
const FIELD_LIST = 'list';
const FIELD_ACTIVE = 'activeId';
const APP_FIELD_NODE = 'wan2gpNode';

const LEGACY_NODES_KEY = 'devtools-hub-wan2gp-nodes';
const LEGACY_ACTIVE_KEY = 'devtools-hub-wan2gp-active-node';
const LEGACY_ENDPOINT_KEY = 'devtools-hub-wan2gp-endpoint';
const LEGACY_TOKEN_KEY = 'devtools-hub-wan2gp-token';

export const FALLBACK_NODE = Object.freeze({
  id: 'proxy',
  name: 'Local proxy',
  baseUrl: '/__wan2gp',
  token: '',
});

const SEED_NODES = [
  { id: 'proxy',    name: 'Local proxy', baseUrl: '/__wan2gp',                   token: '' },
];

function cleanId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function makeId(name, existing) {
  const base = cleanId(name) || 'node';
  let candidate = base;
  let n = 2;
  while (existing.some(x => x.id === candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

function legacyAppNodeKey(appId) {
  return `${appId}-wan2gp-node`;
}

// Build the post-migration default registry, merging in legacy single-endpoint
// LS values if present. Used when no node list exists on disk yet AND no
// modern `devtools-hub-wan2gp-nodes` LS blob has been migrated.
function seedDefaultNodes() {
  let legacyEndpoint = '';
  let legacyToken = '';
  try {
    legacyEndpoint = cleanBaseUrl(localStorage.getItem(LEGACY_ENDPOINT_KEY) || '');
    legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY) || '';
  } catch { /* private mode */ }

  const seeded = SEED_NODES.map(n => ({ ...n, token: legacyToken || n.token }));

  let activeId = '';
  if (legacyEndpoint) {
    const match = seeded.find(n => cleanBaseUrl(n.baseUrl) === legacyEndpoint);
    if (match) {
      activeId = match.id;
    } else {
      seeded.push({ id: 'custom', name: 'Custom', baseUrl: legacyEndpoint, token: legacyToken });
      activeId = 'custom';
    }
  } else {
    activeId = seeded[0]?.id || FALLBACK_NODE.id;
  }

  // Drop the legacy single-endpoint keys now that the data has been folded
  // into the seed. Idempotent on subsequent loads (no-ops if already gone).
  try { localStorage.removeItem(LEGACY_ENDPOINT_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* ignore */ }

  return { list: seeded, activeId };
}

// Seed the suite snapshot synchronously, hydrate from disk, and on first run
// migrate the legacy `devtools-hub-wan2gp-nodes` / `…-active-node` LS blobs
// onto disk. If neither LS nor disk has a list, fall back to the seed
// (preserving any legacy single-endpoint values).
// Both fields get a legacy LS key so edits made before a root is connected
// survive reload via the suite-prefs JSON scratch path; the async migrate
// step moves them onto disk on first connect.
const SUITE_LEGACY = {
  [FIELD_LIST]: LEGACY_NODES_KEY,
  [FIELD_ACTIVE]: LEGACY_ACTIVE_KEY,
};
suite(PREFS_AREA, {
  defaults: { [FIELD_LIST]: null, [FIELD_ACTIVE]: '' },
  legacyKeys: SUITE_LEGACY,
});
(async () => {
  await migrateJsonFieldAt('_suite/wan2gp-nodes.json', FIELD_LIST, LEGACY_NODES_KEY);
  await hydrateSuite(PREFS_AREA, {
    defaults: { [FIELD_LIST]: null, [FIELD_ACTIVE]: '' },
    legacyKeys: SUITE_LEGACY,
  });
  // No list on disk after hydrate? Seed defaults (folding in legacy values).
  if (!Array.isArray(getSuiteField(PREFS_AREA, FIELD_LIST, null))) {
    const { list, activeId } = seedDefaultNodes();
    setSuiteFields(PREFS_AREA, { [FIELD_LIST]: list, [FIELD_ACTIVE]: activeId });
  }
})();

// Track per-app legacy migrations triggered this session.
const hydratedApps = new Set();
function ensureAppHydrated(appId) {
  if (!appId || hydratedApps.has(appId)) return;
  hydratedApps.add(appId);
  prefs(appId, { legacyKeys: { [APP_FIELD_NODE]: legacyAppNodeKey(appId) } });
  hydrateAppPrefs(appId, { legacyKeys: { [APP_FIELD_NODE]: legacyAppNodeKey(appId) } });
}

// ── Public API ────────────────────────────────────────────────────────────

export function getNodes() {
  const raw = getSuiteField(PREFS_AREA, FIELD_LIST, null);
  if (Array.isArray(raw) && raw.length > 0) return raw.map(normalizeNode);
  return [FALLBACK_NODE];
}

function normalizeNode(n) {
  return {
    id: String(n?.id || ''),
    name: String(n?.name || n?.id || 'node'),
    baseUrl: cleanBaseUrl(n?.baseUrl),
    token: String(n?.token || ''),
  };
}

export function saveNodes(nodes) {
  if (!Array.isArray(nodes)) throw new Error('saveNodes: expected array');
  setSuite(PREFS_AREA, FIELD_LIST, nodes.map(normalizeNode));
}

export function getNode(id) {
  if (!id) return null;
  return getNodes().find(n => n.id === id) || null;
}

export function addNode(input) {
  const nodes = getNodes();
  const node = normalizeNode({
    ...input,
    id: input?.id ? cleanId(input.id) : makeId(input?.name, nodes),
  });
  if (!node.id) throw new Error('addNode: id is required');
  if (!node.baseUrl) throw new Error('addNode: baseUrl is required');
  if (nodes.some(n => n.id === node.id)) throw new Error(`Node "${node.id}" already exists`);
  const next = [...nodes, node];
  saveNodes(next);
  return node;
}

export function updateNode(id, patch) {
  const nodes = getNodes();
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) throw new Error(`Node "${id}" not found`);
  const merged = normalizeNode({ ...nodes[idx], ...patch, id: nodes[idx].id });
  const next = [...nodes];
  next[idx] = merged;
  saveNodes(next);
  return merged;
}

export function removeNode(id) {
  const nodes = getNodes().filter(n => n.id !== id);
  if (nodes.length === 0) throw new Error('Cannot remove the last node');
  saveNodes(nodes);
  // If the global active was removed, fall back to first.
  if (getSuiteField(PREFS_AREA, FIELD_ACTIVE, '') === id) {
    setSuite(PREFS_AREA, FIELD_ACTIVE, nodes[0].id);
  }
}

// ── Active node ───────────────────────────────────────────────────────────

export function getGlobalActiveNodeId() {
  return getSuiteField(PREFS_AREA, FIELD_ACTIVE, '') || (getNodes()[0]?.id || '');
}

export function setGlobalActiveNodeId(id) {
  if (!getNode(id)) throw new Error(`Cannot activate unknown node "${id}"`);
  setSuite(PREFS_AREA, FIELD_ACTIVE, id);
}

export function getAppOverrideNodeId(appId) {
  if (!appId) return '';
  ensureAppHydrated(appId);
  const snap = prefs(appId);
  return snap[APP_FIELD_NODE] || '';
}

export function setAppOverrideNodeId(appId, id) {
  if (!appId) throw new Error('setAppOverrideNodeId: appId is required');
  if (id && !getNode(id)) throw new Error(`Cannot pin unknown node "${id}"`);
  ensureAppHydrated(appId);
  setPref(appId, APP_FIELD_NODE, id || '');
}

/**
 * Resolve a node from the configured precedence order.
 * @param {object} [opts]
 * @param {string} [opts.nodeId]  Explicit per-call override (highest precedence).
 * @param {string} [opts.appId]   Per-app override (looked up under `<appId>-wan2gp-node`).
 * @returns {{id, name, baseUrl, token}}
 */
export function resolveNode({ nodeId, appId } = {}) {
  if (nodeId) {
    const direct = getNode(nodeId);
    if (direct) return direct;
  }
  if (appId) {
    const pinned = getAppOverrideNodeId(appId);
    if (pinned) {
      const node = getNode(pinned);
      if (node) return node;
    }
  }
  const globalActive = getGlobalActiveNodeId();
  if (globalActive) {
    const node = getNode(globalActive);
    if (node) return node;
  }
  return getNodes()[0] || FALLBACK_NODE;
}

export function resolveActiveNodeId(opts) {
  return resolveNode(opts).id;
}

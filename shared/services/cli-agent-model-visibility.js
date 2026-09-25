// Which CLI-agent models reach the pickers.
//
// Devin lists 467 models — 48 families times their effort variants — where
// every other agent lists a handful, and they all land in the same dropdown as
// the cloud providers. This is the curation layer: a per-agent list of hidden
// model ids, stored hub-wide so one pass in Settings applies everywhere.
//
// Hidden ids rather than shown ids, deliberately: the default stays "everything
// the CLI lists", so a model released tomorrow appears without anyone having to
// reopen the dialog.

import { suite, hydrateSuite, setSuite, getSuiteField, subscribeSuite } from './suite-prefs.js';

const AREA = 'cli-agent-models';
const FIELD = 'hiddenByAgent';
const DEFAULTS = { [FIELD]: {} };
// A localStorage scratch key is what makes the synchronous read above work:
// suite-prefs mirrors the field there on every write, so a picker built before
// (or without) a disk hydrate still filters correctly.
const LEGACY_KEYS = { [FIELD]: 'devtools-hub-cli-agent-hidden-models' };

suite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY_KEYS });

let hydrating = null;

/**
 * Hydrate from disk once per page. Deliberately lazy and never awaited by the
 * filtering path: before it settles the snapshot comes from the localStorage
 * scratch (or the defaults), which errs toward showing too many rows rather
 * than hiding one the user still wants.
 */
export function ensureVisibilityHydrated() {
  if (!hydrating) {
    hydrating = hydrateSuite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY_KEYS })
      .catch(() => getSuiteField(AREA, FIELD, {}));
  }
  return hydrating;
}

function hiddenByAgent() {
  const map = getSuiteField(AREA, FIELD, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/** Hidden model ids for one agent. */
export function getHiddenModelIds(agentId) {
  const list = hiddenByAgent()[agentId];
  return new Set(Array.isArray(list) ? list.filter(id => typeof id === 'string') : []);
}

/** Replace one agent's hidden set. Returns the normalized list that was stored. */
export async function setHiddenModelIds(agentId, ids) {
  const list = [...new Set([...(ids || [])].filter(id => typeof id === 'string' && id))].sort();
  const next = { ...hiddenByAgent() };
  // An agent with nothing hidden leaves no trace, so the stored shape stays
  // empty for everyone who never opens this dialog.
  if (list.length) next[agentId] = list;
  else delete next[agentId];
  await setSuite(AREA, FIELD, next);
  return list;
}

export function subscribeModelVisibility(callback) {
  return subscribeSuite(AREA, callback);
}

/** Drop the rows the user hid. Accepts id strings or {id,label} options. */
export function applyModelVisibility(agentId, options = []) {
  const hidden = getHiddenModelIds(agentId);
  if (!hidden.size) return options;
  return options.filter(option => !hidden.has(typeof option === 'string' ? option : option?.id));
}

/**
 * Fold a flat catalogue into families for the curation dialog.
 *
 * A `family` field from the bridge wins whenever one is present — Devin reports
 * membership that no prefix rule could recover, because its family slugs are
 * dotted (`claude-fable-5.1`) where the variants are dashed
 * (`claude-fable-5-1-max`). Without it, 165 of Devin's 467 rows would each form
 * a family of one.
 *
 * Failing that, a model belongs to the longest other catalogue id it extends,
 * walked up to the root: `claude-opus-5-low-fast` sits under `claude-opus-5-low`
 * and thus in the `claude-opus-5` family. Agents whose ids share no prefixes
 * (Claude Code, Codex) get one single-model family each, rendering as a plain
 * list.
 */
export function groupModelsByFamily(options = []) {
  const rows = options
    .map(option => (typeof option === 'string' ? { id: option, label: option } : option))
    .filter(option => option?.id);
  const ids = new Set(rows.map(row => row.id));

  // Longest prefix that is itself a model id, found by walking "-" boundaries
  // right to left rather than scanning the whole catalogue per row.
  const parentOf = (id) => {
    let cut = id.lastIndexOf('-');
    while (cut > 0) {
      const candidate = id.slice(0, cut);
      if (ids.has(candidate)) return candidate;
      cut = id.lastIndexOf('-', cut - 1);
    }
    return '';
  };
  const rootOf = (id) => {
    let current = id;
    for (let parent = parentOf(current); parent; parent = parentOf(current)) current = parent;
    return current;
  };

  const declaresFamilies = rows.some(row => typeof row.family === 'string' && row.family);
  const familyOf = row => (declaresFamilies && row.family ? row.family : rootOf(row.id));

  const families = new Map();
  for (const row of rows) {
    const key = familyOf(row);
    if (!families.has(key)) {
      const keyRow = rows.find(candidate => candidate.id === key);
      families.set(key, { id: key, label: keyRow?.label || key, models: [] });
    }
    families.get(key).models.push(row);
  }
  return [...families.values()];
}

/** Every id that is a variant of some other id — what "families only" hides. */
export function variantModelIds(options = []) {
  return groupModelsByFamily(options)
    .flatMap(family => family.models.filter(model => model.id !== family.id).map(model => model.id));
}

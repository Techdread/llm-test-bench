// Model ensemble store — spec 341. Hub-wide, in the suite settings area
// `ensembles` (<root>/_suite/ensembles.json once a data root is connected), so
// every app sees the same ensembles. The pure logic lives in
// ensemble-definitions.js; this file only binds it to suite prefs.

import { suite, hydrateSuite, getSuiteField, setSuite, subscribeSuite } from './suite-prefs.js';
import { loadAt, invalidateConfigCache } from './app-config.js';
import {
  saveDefinition, setHidden, listDefinitions, resolveRecord, mergeRecordLists,
} from './ensemble-definitions.js';

export * from './ensemble-definitions.js';

const AREA = 'ensembles';
const FIELD = 'list';
const DEFAULTS = { [FIELD]: [] };
// localStorage scratch, as the provider registry has: without a connected data
// root (a fresh browser, the Quest) ensembles must still survive a reload, and
// are moved onto disk when a root is connected.
const LEGACY = { [FIELD]: 'devtools-hub-ensembles' };

suite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY });
const hydration = hydrateSuite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY }).catch(() => {});

/** Resolves once stored ensembles are loaded (call before listing at startup). */
export function ensemblesReady() {
  return hydration;
}

function records() {
  const list = getSuiteField(AREA, FIELD, []);
  return Array.isArray(list) ? list : [];
}

export function listEnsembles(options) {
  return listDefinitions(records(), options);
}

/** Every stored record, including hidden ones and all versions (for the Studio). */
export function listEnsembleRecords() {
  return records();
}

export function getEnsemble(id) {
  const record = records().find(r => r.id === id);
  return record ? resolveRecord(record) : null;
}

const PATH = '_suite/ensembles.json';

/** The list as it is on disk right now, or null when it cannot be read. */
async function storedRecords() {
  try {
    invalidateConfigCache(PATH);
    const disk = await loadAt(PATH);
    return Array.isArray(disk?.[FIELD]) ? disk[FIELD] : null;
  } catch {
    return null;
  }
}

/**
 * Write the list, merged with whatever is on disk. Re-reading first costs one
 * file read per save and is what stops a stale snapshot from deleting another
 * session's ensembles — the failure that lost one.
 */
async function writeRecords(list) {
  const merged = mergeRecordLists(list, await storedRecords());
  await setSuite(AREA, FIELD, merged);
  return merged;
}

export async function saveEnsemble(definition, { id = null } = {}) {
  const stored = await storedRecords();
  // Save against the stored list, so editing an ensemble this tab never saw
  // adds a version to it rather than creating a second record with a -2 id.
  const { list, record } = saveDefinition(mergeRecordLists(records(), stored), definition, { id });
  await writeRecords(list);
  return resolveRecord(record);
}

export async function hideEnsemble(id) {
  await writeRecords(setHidden(mergeRecordLists(records(), await storedRecords()), id, true));
}

export async function restoreEnsemble(id) {
  await writeRecords(setHidden(mergeRecordLists(records(), await storedRecords()), id, false));
}

export function subscribeEnsembles(callback) {
  return subscribeSuite(AREA, () => callback(listEnsembles({ includeHidden: true })));
}

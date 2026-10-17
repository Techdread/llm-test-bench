// Variant lanes — named library sets a prompt can be pinned to (spec 327).
//
// A lane is the unit an author actually thinks in ("Three.js 3D"), not a raw
// library id list. Repository seeds in data/lanes.json stay immutable; user
// lanes and seed visibility live beside the prompt library in the data root and
// follow the same soft-delete rule: hidden, never erased.

import { ensureAppNamespace } from '../../shared/services/data-root-manager.js';
import { librarySelectionErrors, normalizeLibraryIds } from './projectLibraries.js';

const LIBRARY_DIR = 'library';
const LANES_FILE = 'lanes.json';
export const LANE_SCHEMA_VERSION = 1;

/**
 * How a variant's prompt text is produced. These answer different questions:
 * `held-constant` is the controlled comparison (the library is the only thing
 * that changed), while the adapted modes trade comparability for a brief the
 * library can actually be good at.
 */
export const LANE_MODES = Object.freeze(['held-constant', 'preserve', 'transform']);
export const DEFAULT_LANE_MODE = 'preserve';

export const LANE_MODE_LABELS = Object.freeze({
  'held-constant': 'Held constant',
  preserve: 'Adapted · preserve concept',
  transform: 'Adapted · transform concept',
});

let seedsCache = null;

function laneMode(value) {
  return LANE_MODES.includes(value) ? value : DEFAULT_LANE_MODE;
}

export function slugifyLaneId(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeLane(value, { source = 'user' } = {}) {
  return {
    id: slugifyLaneId(value?.id),
    label: String(value?.label || '').trim(),
    libraries: normalizeLibraryIds(value?.libraries),
    defaultMode: laneMode(value?.defaultMode),
    note: String(value?.note || '').trim(),
    source,
  };
}

/**
 * Reasons a lane cannot be saved. `existing` is every other lane, so an id
 * collision is caught here rather than silently shadowing a seed.
 */
export function laneValidationErrors(value, existing = []) {
  const lane = normalizeLane(value);
  const errors = [];
  if (!lane.id) errors.push('A lane needs an id.');
  if (!lane.label) errors.push('A lane needs a label.');
  if (lane.id && existing.some(item => item.id === lane.id)) {
    errors.push(`A lane with the id "${lane.id}" already exists.`);
  }
  // The library catalogue owns "at most one engine", "web stack only" and the
  // unknown-id rule; a lane must not invent a second opinion about any of them.
  errors.push(...librarySelectionErrors(value?.libraries, { domain: 'game', targetStack: 'web' }));
  return errors;
}

export async function loadSeedLanes() {
  if (seedsCache) return seedsCache;
  const response = await fetch('./data/lanes.json');
  if (!response.ok) throw new Error(`Lane seeds failed to load (${response.status})`);
  const data = await response.json();
  seedsCache = (data.lanes || []).map(lane => normalizeLane(lane, { source: 'seed' }));
  return seedsCache;
}

function emptyDocument() {
  return {
    schemaVersion: LANE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    lanes: [],
    hiddenSeedIds: [],
  };
}

export function normalizeLaneDocument(value) {
  const document = emptyDocument();
  if (!value || typeof value !== 'object') return document;
  document.updatedAt = value.updatedAt || document.updatedAt;
  document.hiddenSeedIds = [...new Set((value.hiddenSeedIds || []).map(slugifyLaneId).filter(Boolean))];
  const seen = new Set();
  document.lanes = (value.lanes || []).flatMap(record => {
    const lane = normalizeLane(record);
    if (!lane.id || !lane.label || seen.has(lane.id)) return [];
    seen.add(lane.id);
    return [{
      ...lane,
      hidden: !!record.hidden,
      createdAt: record.createdAt || document.updatedAt,
      updatedAt: record.updatedAt || record.createdAt || document.updatedAt,
    }];
  });
  return document;
}

async function laneFileHandle({ create = false } = {}) {
  const appRoot = await ensureAppNamespace('game-forge-v2');
  const directory = await appRoot.getDirectoryHandle(LIBRARY_DIR, { create });
  return directory.getFileHandle(LANES_FILE, { create });
}

async function writeDocument(document) {
  document.updatedAt = new Date().toISOString();
  const file = await laneFileHandle({ create: true });
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(document, null, 2));
  await writer.close();
  return document;
}

export async function loadLaneDocument() {
  try {
    const file = await laneFileHandle();
    return normalizeLaneDocument(JSON.parse(await (await file.getFile()).text()));
  } catch {
    // No data root, or no lane file yet. Seeds alone are a complete catalogue,
    // so this is an ordinary empty state rather than a failure.
    return emptyDocument();
  }
}

export async function getAllLanes() {
  const [seeds, document] = await Promise.all([loadSeedLanes(), loadLaneDocument()]);
  const hidden = new Set(document.hiddenSeedIds);
  return [
    ...seeds.filter(lane => !hidden.has(lane.id)),
    ...document.lanes.filter(lane => !lane.hidden).map(lane => ({ ...lane, source: 'user' })),
  ];
}

export async function addUserLane(value) {
  const [document, all] = await Promise.all([loadLaneDocument(), getAllLanes()]);
  const errors = laneValidationErrors(value, all);
  if (errors.length) throw new Error(errors.join(' '));
  const timestamp = new Date().toISOString();
  const lane = { ...normalizeLane(value), hidden: false, createdAt: timestamp, updatedAt: timestamp };
  document.lanes.push(lane);
  await writeDocument(document);
  return lane;
}

export async function updateUserLane(id, changes) {
  const laneId = slugifyLaneId(id);
  const document = await loadLaneDocument();
  const record = document.lanes.find(lane => lane.id === laneId);
  if (!record) throw new Error(`Unknown custom lane: ${laneId}`);
  const all = (await getAllLanes()).filter(lane => lane.id !== laneId);
  const merged = { ...record, ...changes, id: laneId };
  const errors = laneValidationErrors(merged, all);
  if (errors.length) throw new Error(errors.join(' '));
  Object.assign(record, normalizeLane(merged), {
    hidden: false,
    createdAt: record.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await writeDocument(document);
  return record;
}

/** Hide a lane. Variants already built from it keep working — they store ids. */
export async function softDeleteLane(id) {
  const laneId = slugifyLaneId(id);
  const document = await loadLaneDocument();
  const record = document.lanes.find(lane => lane.id === laneId);
  if (record) record.hidden = true;
  else if (!document.hiddenSeedIds.includes(laneId)) document.hiddenSeedIds.push(laneId);
  await writeDocument(document);
}

export function laneById(lanes, id) {
  const laneId = slugifyLaneId(id);
  return lanes.find(lane => lane.id === laneId) || null;
}

/**
 * A label for a lane id that may no longer be in the catalogue. Runs and
 * variants outlive the lanes that made them, so every reader needs this.
 */
export function laneLabel(lanes, id) {
  return laneById(lanes, id)?.label || slugifyLaneId(id) || 'baseline';
}

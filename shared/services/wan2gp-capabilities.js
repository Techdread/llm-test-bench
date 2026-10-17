// Capability discovery against a Wan2GP node.
//
// Apps ask for a capability, not a model: "I need image-in, image-out, with
// masking" resolves against the node's live catalogue. That is what keeps 210
// models — and ten more per upstream release — a non-event for app code.
//
// Everything is cached **per node**. A model list from the 3090 is not valid
// for the 3060: the two boxes have different weights downloaded.
//
// Filtering is done client-side against that cached catalogue rather than via
// the node's `/api/models?...` query parameters. Measured against the live
// 3090 (agent API 0.6.0), the node's `capability=` filters the coarse
// `image-generation`/`video-generation`/`audio-generation` string — NOT the
// fine-grained `capabilities` map — and its `input`/`output` filters are an
// ANY-of intersection where an app wants ALL-of. One cached fetch per node and
// a local filter is both correct and cheaper than a request per distinct need.
//
// Old nodes (agent API < 0.6.0) return model rows without capability metadata
// and silently ignore the filter parameters. That is a first-class state here,
// not an error: `listCapableModels` reports `stale: true` and `pickModel`
// drops to the service's named fallback. Never an empty picker, never a hang.

import { fetchHealth, fetchModels, fetchModelDetail, normalizeModels, resolveActiveNodeId } from './wan2gp.js';
import {
  getApiMetadata,
  hasCapabilityMetadata,
  modelMatchesNeed,
  nodeSupportsCapabilities,
  rankModelsForService,
  referenceLimitsFor,
  SERVICE_NEEDS,
  supportsCapability as supportsCapabilityOn,
} from './wan2gp-payload.js';

export { SERVICE_NEEDS, referenceLimitsFor };

/** Raised when a service needs capability metadata the node cannot provide. */
export class CapabilityUnavailableError extends Error {
  constructor(message, { nodeVersion, serviceId } = {}) {
    super(message);
    this.name = 'CapabilityUnavailableError';
    this.nodeVersion = nodeVersion;
    this.serviceId = serviceId;
  }
}

// Session cache, keyed by resolved node id. Cleared by `invalidateCapabilities`.
const cache = new Map();

function cacheKey(opts = {}) {
  if (opts.nodeId) return String(opts.nodeId);
  try {
    return String(resolveActiveNodeId({ appId: opts.appId }) || 'default');
  } catch {
    return 'default';
  }
}

function entryFor(opts) {
  const key = cacheKey(opts);
  let entry = cache.get(key);
  if (!entry) {
    entry = { key, health: null, models: null, details: new Map() };
    cache.set(key, entry);
  }
  return entry;
}

/** Forget cached health/models/details. Omit `opts` to clear every node. */
export function invalidateCapabilities(opts) {
  if (!opts) return cache.clear();
  cache.delete(cacheKey(opts));
}

async function loadHealth(opts) {
  const entry = entryFor(opts);
  if (entry.health === null) {
    entry.health = fetchHealth({ signal: opts?.signal, nodeId: opts?.nodeId, appId: opts?.appId })
      .catch((err) => ({ __error: err?.message || String(err) }));
  }
  return entry.health;
}

/**
 * What this node can tell us about its models.
 * @returns {Promise<{ reachable, version, supportsCapabilities, gpu, error }>}
 */
export async function nodeCapabilityStatus(opts = {}) {
  const health = await loadHealth(opts);
  if (!health || health.__error) {
    return {
      reachable: false,
      version: null,
      supportsCapabilities: false,
      gpu: null,
      error: health?.__error || 'node unreachable',
    };
  }
  return {
    reachable: true,
    version: health.version || null,
    supportsCapabilities: nodeSupportsCapabilities(health),
    gpu: health.gpu || null,
    error: null,
  };
}

async function loadModels(opts) {
  const entry = entryFor(opts);
  if (entry.models === null) {
    entry.models = fetchModels({ signal: opts?.signal, nodeId: opts?.nodeId, appId: opts?.appId })
      .then((res) => normalizeModels(res))
      .catch((err) => {
        entry.models = null; // let a later call retry
        throw err;
      });
  }
  return entry.models;
}

/**
 * Models on this node matching a capability need.
 *
 * @param {object} need `{ input, output, capability, family }` — values may be
 *   comma-separated, and every value must match (see `modelMatchesNeed`).
 * @returns {Promise<{ models, stale, status }>} `stale: true` means the node
 *   cannot report capabilities and `models` is the unfiltered catalogue.
 */
export async function listCapableModels(need = {}, opts = {}) {
  const status = await nodeCapabilityStatus(opts);
  const all = await loadModels(opts);

  // An old node ignores the filter parameters and returns rows with no
  // capability fields, so filtering client-side would yield nothing. Hand back
  // the full list flagged stale and let the caller decide.
  if (!status.supportsCapabilities || !all.some(hasCapabilityMetadata)) {
    return { models: all, stale: true, status };
  }
  return { models: all.filter((m) => modelMatchesNeed(m, need)), stale: false, status };
}

/** Normalized `api_metadata` for one model, from the detail endpoint. */
export async function getCapabilities(modelType, opts = {}) {
  if (!modelType) throw new Error('getCapabilities: modelType is required');
  const entry = entryFor(opts);
  if (!entry.details.has(modelType)) {
    const promise = fetchModelDetail(modelType, {
      signal: opts.signal,
      nodeId: opts.nodeId,
      appId: opts.appId,
    }).catch((err) => {
      entry.details.delete(modelType);
      throw err;
    });
    entry.details.set(modelType, promise);
  }
  const detail = await entry.details.get(modelType);
  return { detail, metadata: getApiMetadata(detail), model: detail };
}

/** Does a named model on this node report `capability`? */
export async function supportsCapability(modelType, capability, opts = {}) {
  const { detail } = await getCapabilities(modelType, opts);
  return supportsCapabilityOn(detail, capability);
}

/**
 * Resolve the model a service should use.
 *
 * Order: explicit `modelType` → the service's `prefer` list (when present on
 * the node) → the first capable model → the service's named fallback.
 *
 * @returns {Promise<{ modelType, resolvedBy, stale, status, candidates }>}
 *   `resolvedBy` is `explicit | preferred | capable | fallback`.
 */
export async function pickModel(serviceId, opts = {}) {
  const spec = SERVICE_NEEDS[serviceId];
  if (!spec) throw new Error(`pickModel: unknown service "${serviceId}"`);

  if (opts.modelType) {
    return { modelType: opts.modelType, resolvedBy: 'explicit', stale: false, status: null, candidates: [] };
  }

  let status = { reachable: false, version: null, supportsCapabilities: false, error: 'not checked' };
  let ranked = [];
  try {
    status = await nodeCapabilityStatus(opts);
    if (status.supportsCapabilities) {
      const all = await loadModels(opts);
      ranked = rankModelsForService(all, serviceId);
    }
  } catch (err) {
    // Fall through to the named fallback — an unreachable node must not stop
    // an app that already knows which model it wants to try.
    status = { ...status, error: err?.message || String(err) };
  }

  if (ranked.length) {
    const modelType = String(ranked[0].model_type);
    return {
      modelType,
      resolvedBy: spec.prefer.includes(modelType) ? 'preferred' : 'capable',
      stale: false,
      status,
      candidates: ranked,
    };
  }

  return {
    modelType: spec.fallback,
    resolvedBy: 'fallback',
    stale: true,
    status,
    candidates: [],
  };
}

/**
 * The message an app should show when a service fell back because the node is
 * too old, or nothing on it matched. Returns null when the pick was clean.
 */
export function fallbackNotice(pick, serviceId) {
  if (!pick || !pick.stale) return null;
  const service = serviceId || pick.serviceId || 'this service';
  if (pick.status && !pick.status.reachable) {
    return `Wan2GP node unreachable — ${service} is using its built-in default (${pick.modelType}).`;
  }
  if (pick.status && !pick.status.supportsCapabilities) {
    const version = pick.status.version ? ` (API ${pick.status.version})` : '';
    return `Wan2GP node too old for capability discovery${version} — ${service} is using its built-in default (${pick.modelType}). Update the node to pick models by capability.`;
  }
  return `No model on this node matches ${service} — falling back to ${pick.modelType}.`;
}

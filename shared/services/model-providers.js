// Unified Model Providers — shared facade.
// Centralises provider registry, model discovery, caching, and generation APIs
// for all DevTools Hub apps.
//
// Persistence:
//   <root>/_suite/providers.json
//     list:               configured provider objects
//     default:            default provider id
//     defaultByProvider:  { [providerId]: defaultModelId }
//   <root>/_suite/model-cache.json
//     byProvider:         { [providerId]: { models, timestamp } } — 1h TTL

import * as openrouterAdapter from './providers-openrouter.js';
import * as lmstudioAdapter from './providers-lmstudio.js';
import * as lemonadeAdapter from './providers-lemonade.js';
import * as unslothStudioAdapter from './providers-unsloth-studio.js';
import * as cliAgentAdapter from './providers-cli-agent.js';
import { isAgentBridgeReachable } from './agent-backend.js';
import {
  suite,
  hydrateSuite,
  setSuite,
  setSuiteFields,
  getSuiteField,
  migrateJsonField,
} from './suite-prefs.js';

const PROVIDERS_AREA = 'providers';
const FIELD_LIST = 'list';
const FIELD_DEFAULT_PROVIDER = 'default';
const FIELD_DEFAULTS_BY_PROVIDER = 'defaultByProvider';

const CACHE_AREA = 'model-cache';
const CACHE_FIELD = 'byProvider';

const LEGACY_PROVIDERS_KEY = 'devtools-hub-model-providers';
const LEGACY_MODEL_CACHE_KEY = 'devtools-hub-model-cache';
const LEGACY_DEFAULT_PROVIDER_KEY = 'devtools-hub-default-provider';
const LEGACY_DEFAULT_MODEL_KEY = 'devtools-hub-default-model-by-provider';

const MODEL_CACHE_TTL = 1000 * 60 * 60; // 1 hour

// ── Adapter registry ──

const adapters = {
  openrouter: openrouterAdapter,
  lmstudio: lmstudioAdapter,
  lemonade: lemonadeAdapter,
  'unsloth-studio': unslothStudioAdapter,
  [cliAgentAdapter.PROVIDER_TYPE]: cliAgentAdapter,
};

/**
 * Get the adapter for a provider type.
 */
function getAdapter(providerType) {
  const adapter = adapters[providerType];
  if (!adapter) throw new Error(`Unknown provider type: ${providerType}`);
  return adapter;
}

// ── Seed + hydrate suite areas on import ──

const PROVIDERS_DEFAULTS = {
  [FIELD_LIST]: null,                 // null until hydrated; getProviders() seeds
  [FIELD_DEFAULT_PROVIDER]: '',
  [FIELD_DEFAULTS_BY_PROVIDER]: {},
};
// All three fields get a legacy LS key so that edits made before a root is
// connected survive reload via the suite-prefs JSON scratch path. The async
// migrate step below moves them onto disk on first connect.
const PROVIDERS_LEGACY = {
  [FIELD_LIST]: LEGACY_PROVIDERS_KEY,
  [FIELD_DEFAULT_PROVIDER]: LEGACY_DEFAULT_PROVIDER_KEY,
  [FIELD_DEFAULTS_BY_PROVIDER]: LEGACY_DEFAULT_MODEL_KEY,
};
suite(PROVIDERS_AREA, { defaults: PROVIDERS_DEFAULTS, legacyKeys: PROVIDERS_LEGACY });
(async () => {
  await migrateJsonField(PROVIDERS_AREA, FIELD_LIST, LEGACY_PROVIDERS_KEY);
  await migrateJsonField(PROVIDERS_AREA, FIELD_DEFAULTS_BY_PROVIDER, LEGACY_DEFAULT_MODEL_KEY);
  await hydrateSuite(PROVIDERS_AREA, { defaults: PROVIDERS_DEFAULTS, legacyKeys: PROVIDERS_LEGACY });
  // Post-hydrate seed: only persist the default OpenRouter provider if neither
  // disk nor LS scratch held a list. Doing this after hydrate avoids the race
  // where a pre-hydrate getProviders() would auto-save defaults and wipe the
  // user's actual providers from disk.
  const list = getSuiteField(PROVIDERS_AREA, FIELD_LIST, null);
  if (!Array.isArray(list) || list.length === 0) {
    setSuite(PROVIDERS_AREA, FIELD_LIST, [openrouterAdapter.createDefaultProvider()]);
  }
})();

const CACHE_DEFAULTS = { [CACHE_FIELD]: {} };
suite(CACHE_AREA, { defaults: CACHE_DEFAULTS });
(async () => {
  await migrateJsonField(CACHE_AREA, CACHE_FIELD, LEGACY_MODEL_CACHE_KEY);
  await hydrateSuite(CACHE_AREA, { defaults: CACHE_DEFAULTS });
})();

// ── Local CLI agents as synthetic providers ──
//
// The coding agents behind serve.py's `/__agent/*` bridge are offered as
// ordinary providers so every app's existing model dropdown can pick one. They
// are deliberately kept OUT of `getProviders()`: that list is the user's own
// editable registry and is what gets written to disk, while these are owned by
// the bridge — nothing to configure, nothing to persist, and gone the moment
// the bridge stops answering (a plain static server 404s `/__agent/*`).
//
// The probe is lazy: it fires on the first model-discovery call rather than at
// import, so an app that never lists models never pings the bridge.

let cliBridgeReachable = false;
let cliBridgeProbe = null;

function probeCliBridge({ refresh = false } = {}) {
  if (!cliBridgeProbe || refresh) {
    cliBridgeProbe = isAgentBridgeReachable({ refresh })
      .then((ok) => { cliBridgeReachable = ok; return ok; })
      .catch(() => { cliBridgeReachable = false; return false; });
  }
  return cliBridgeProbe;
}

/**
 * Re-probe the bridge and report whether local CLI agents are on offer.
 * Callers that render a picker can await this to avoid the rows popping in.
 */
export async function refreshCliAgentProviders() {
  return probeCliBridge({ refresh: true });
}

/** True once the bridge has answered — synchronous, for render paths. */
export function areCliAgentProvidersAvailable() {
  return cliBridgeReachable;
}

/** The CLI agent providers currently on offer (empty until the bridge answers). */
export function getCliAgentProviders() {
  probeCliBridge();
  return cliBridgeReachable ? cliAgentAdapter.listProviders() : [];
}

function isSyntheticProvider(provider) {
  return provider?.synthetic === true || cliAgentAdapter.isCliAgentProviderId(provider?.id);
}

// ── Provider Registry ──

/**
 * Get all registered providers.
 *
 * Returns the live list when present; otherwise returns a fresh default
 * (OpenRouter only) WITHOUT writing it back. The post-hydrate block above
 * is responsible for the one-time persistence of the default seed — auto-
 * saving inside this getter would race with hydrate and overwrite the
 * user's persisted providers when called pre-hydrate.
 *
 * @returns {Array} Provider objects
 */
export function getProviders() {
  const list = getSuiteField(PROVIDERS_AREA, FIELD_LIST, null);
  if (Array.isArray(list) && list.length > 0) return list;
  return [openrouterAdapter.createDefaultProvider()];
}

/**
 * Save the full providers list.
 */
export function saveProviders(providers) {
  // Bridge-owned entries must never reach disk, however they got into a list.
  setSuite(PROVIDERS_AREA, FIELD_LIST, (providers || []).filter(p => !isSyntheticProvider(p)));
}

/**
 * Get a single provider by ID.
 *
 * CLI agent ids resolve whether or not the bridge is up, so a selection
 * restored from a previous session fails with the adapter's "run the hub with
 * serve.py" message rather than a bare "provider not found".
 */
export function getProvider(providerId) {
  if (cliAgentAdapter.isCliAgentProviderId(providerId)) {
    return cliAgentAdapter.providerFromId(providerId);
  }
  return getProviders().find(p => p.id === providerId) || null;
}

/**
 * Add a new provider.
 */
export function addProvider(provider) {
  const providers = getProviders();
  if (providers.find(p => p.id === provider.id)) {
    throw new Error(`Provider "${provider.id}" already exists`);
  }
  providers.push(provider);
  saveProviders(providers);
  return providers;
}

/**
 * Update an existing provider.
 */
export function updateProvider(providerId, patch) {
  const providers = getProviders();
  const idx = providers.findIndex(p => p.id === providerId);
  if (idx === -1) throw new Error(`Provider "${providerId}" not found`);
  providers[idx] = { ...providers[idx], ...patch, id: providerId };
  saveProviders(providers);
  return providers;
}

/**
 * Remove a provider.
 */
export function removeProvider(providerId) {
  let providers = getProviders();
  providers = providers.filter(p => p.id !== providerId);
  saveProviders(providers);
  // Clean up cached models
  clearModelCache(providerId);
  return providers;
}

/**
 * Get only enabled providers.
 */
export function getEnabledProviders() {
  return [...getProviders().filter(p => p.enabled !== false), ...getCliAgentProviders()];
}

/**
 * Validate a provider config using its adapter.
 */
export function validateProvider(provider) {
  try {
    const adapter = getAdapter(provider.type);
    return adapter.validateProvider(provider);
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Test a provider's connection.
 */
export async function testConnection(provider) {
  try {
    const adapter = getAdapter(provider.type);
    return adapter.testConnection(provider);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Model Cache ──

function getModelCache() {
  const cache = getSuiteField(CACHE_AREA, CACHE_FIELD, {});
  return cache && typeof cache === 'object' ? cache : {};
}

function setModelCache(cache) {
  setSuite(CACHE_AREA, CACHE_FIELD, cache);
}

function clearModelCache(providerId) {
  const cache = getModelCache();
  delete cache[providerId];
  setModelCache(cache);
}

/**
 * Get cached models for a provider if the cache is fresh (within TTL).
 * @returns {Array|null}
 */
function getCachedModels(providerId) {
  const cache = getModelCache();
  const entry = cache[providerId];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MODEL_CACHE_TTL) return null;
  return entry.models;
}

/**
 * Get cached models regardless of age — used as a failure fallback.
 * Stale-but-useful model lists are better than nothing,
 * especially for LAN providers that may be temporarily offline.
 * @returns {Array|null}
 */
function getCachedModelsAny(providerId) {
  const cache = getModelCache();
  const entry = cache[providerId];
  if (!entry) return null;
  return entry.models;
}

function setCachedModels(providerId, models) {
  const cache = getModelCache();
  cache[providerId] = { timestamp: Date.now(), models };
  setModelCache(cache);
}

// ── Model Discovery ──

/**
 * Apply client-side filters to a model list.
 * Filters are applied after cache load rather than being embedded in the
 * cache key — this avoids one fetch shape contaminating another (e.g.
 * free-only cache being returned for an all-models request).
 */
function applyModelFilters(models, options = {}) {
  let result = models;
  if (options.freeOnly) {
    result = result.filter(m => {
      const pricing = m.raw?.pricing || m.pricing || {};
      if (m.modelId?.toLowerCase().endsWith(':free')) return true;
      const promptCost = Number.parseFloat(pricing.prompt ?? '1');
      const completionCost = Number.parseFloat(pricing.completion ?? '1');
      return promptCost === 0 && completionCost === 0;
    });
  }
  if (options.search) {
    const q = options.search.toLowerCase();
    result = result.filter(m =>
      m.name.toLowerCase().includes(q)
      || m.modelId.toLowerCase().includes(q)
      || (m.providerName || '').toLowerCase().includes(q)
    );
  }
  return result;
}

/**
 * Fetch models for a specific provider. Uses cache if fresh.
 * The full unfiltered model list is always cached; options are applied
 * as post-fetch filters so different callers don't contaminate each
 * other's cache entries.
 *
 * @param {string} providerId
 * @param {Object} [options] - Client-side filters (e.g. { freeOnly: true })
 * @returns {Promise<Array>} Normalized model objects
 */
export async function fetchProviderModels(providerId, options = {}) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);

  // Check cache first (full unfiltered list)
  // CLI catalogues are already cached by the bridge process and can change
  // whenever the installed CLI updates. Do not let an hour-old browser cache
  // hide a newly available model or preserve the old parser's default-only row.
  const synthetic = isSyntheticProvider(provider);
  const cached = synthetic ? null : getCachedModels(providerId);
  if (cached) return applyModelFilters(cached, options);

  // Always fetch the full list — no filter options passed to adapter
  try {
    const adapter = getAdapter(provider.type);
    const models = await adapter.fetchModels(provider);

    // Cache the full results
    if (!synthetic && models.length > 0) {
      setCachedModels(providerId, models);
    }

    return applyModelFilters(models, options);
  } catch (e) {
    // Fall back to ANY cached models (including stale) on failure —
    // stale-but-useful model lists are better than nothing,
    // especially for LAN providers that may be temporarily offline
    const stale = synthetic ? null : getCachedModelsAny(providerId);
    if (stale) {
      console.warn(`Failed to fetch models from ${provider.name}, using stale cache:`, e.message);
      return applyModelFilters(stale, options);
    }
    throw e;
  }
}

/**
 * Fetch models from all registered providers.
 */
export async function fetchAllModels(options = {}) {
  // Settle the bridge probe first so the CLI agent rows are either all there or
  // all absent, rather than appearing a moment after the picker renders.
  await probeCliBridge();
  const providers = [...getProviders(), ...getCliAgentProviders()];
  const results = await Promise.allSettled(
    providers.map(p => fetchProviderModels(p.id, options))
  );
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`Failed to fetch models from ${providers[i].name}:`, r.reason?.message);
    // Fall back to ANY cached models (including stale) on failure —
    // stale-but-useful model lists are better than nothing
    const cached = getCachedModelsAny(providers[i].id);
    return cached ? applyModelFilters(cached, options) : [];
  });
}

/**
 * Fetch models from enabled providers only.
 */
export async function fetchEnabledModels(options = {}) {
  await probeCliBridge();
  const providers = getEnabledProviders();
  const results = await Promise.allSettled(
    providers.map(p => fetchProviderModels(p.id, options))
  );
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`Failed to fetch models from ${providers[i].name}:`, r.reason?.message);
    // Fall back to ANY cached models (including stale) on failure
    const cached = getCachedModelsAny(providers[i].id);
    return cached ? applyModelFilters(cached, options) : [];
  });
}

/**
 * Refresh model cache for a specific provider (force re-fetch).
 */
export async function refreshProviderModels(providerId, options = {}) {
  clearModelCache(providerId);
  return fetchProviderModels(providerId, options);
}

/**
 * Refresh model cache for all providers.
 */
export async function refreshAllModels(options = {}) {
  await refreshCliAgentProviders();
  const providers = [...getProviders(), ...getCliAgentProviders()];
  for (const p of providers) {
    clearModelCache(p.id);
  }
  return fetchAllModels(options);
}

// ── Selection Helpers ──

/**
 * Get the default provider ID.
 */
export function getDefaultProvider() {
  return getSuiteField(PROVIDERS_AREA, FIELD_DEFAULT_PROVIDER, '') || '';
}

/**
 * Set the default provider ID.
 */
export function setDefaultProvider(providerId) {
  setSuite(PROVIDERS_AREA, FIELD_DEFAULT_PROVIDER, providerId || '');
}

/**
 * Get the default model ID for a provider.
 */
export function getDefaultModel(providerId) {
  const map = getSuiteField(PROVIDERS_AREA, FIELD_DEFAULTS_BY_PROVIDER, {}) || {};
  return map[providerId] || '';
}

/**
 * Set the default model ID for a provider.
 */
export function setDefaultModel(providerId, modelId) {
  const current = getSuiteField(PROVIDERS_AREA, FIELD_DEFAULTS_BY_PROVIDER, {}) || {};
  const next = { ...current };
  if (modelId) next[providerId] = modelId;
  else delete next[providerId];
  setSuite(PROVIDERS_AREA, FIELD_DEFAULTS_BY_PROVIDER, next);
}

// ── Single-target Generation ──

/**
 * Stream a chat completion through a specific provider.
 *
 * @param {Object} params
 * @param {string} params.providerId
 * @param {string} params.modelId
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {Function} [params.onChunk] - Called with accumulated text on each chunk
 * @param {string} [params.appTitle]
 * @returns {Promise<string>} Full response text
 */
/**
 * @param {Object} [params] - Sampling/reasoning parameters (see gen-params.js).
 *   Omit for "server defaults" — nothing is put on the wire.
 * @param {Function} [onStats] - Called once with per-generation telemetry:
 *   { durationMs, ttftMs, tokensPerSecond, thought, reasoningTokens, ... }
 */
export async function streamChat({ providerId, modelId, systemPrompt, userPrompt, onChunk, appTitle, params, onStats }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);
  if (provider.enabled === false) throw new Error(`Provider "${provider.name}" is disabled`);

  const adapter = getAdapter(provider.type);
  return adapter.streamChat({
    provider, modelId, systemPrompt, userPrompt, onChunk, appTitle, params, onStats,
  });
}

/**
 * Get the effective provider + model for an app, falling back to hub defaults.
 *
 * Transitional shim: still reads from localStorage because the per-app
 * `${APP_ID}-provider` / `${APP_ID}-model` keys are kept in lockstep with disk
 * by app-prefs (the LS scratch fallback). Once every app has been migrated to
 * read prefs(APP_ID) directly this function can be removed.
 *
 * @param {string} appProviderKey - localStorage key for the app's provider  (e.g. 'code-arena-provider')
 * @param {string} appModelKey    - localStorage key for the app's model     (e.g. 'code-arena-or-model')
 * @returns {{ provider: string, model: string }}
 */
export function getEffectiveSelection(appProviderKey, appModelKey) {
  const provider = localStorage.getItem(appProviderKey) || getDefaultProvider() || '';
  const model = localStorage.getItem(appModelKey) || (provider ? getDefaultModel(provider) : '');
  return { provider, model };
}

/**
 * Non-streaming chat completion through a specific provider.
 */
export async function completeChat({ providerId, modelId, systemPrompt, userPrompt, appTitle }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);
  if (provider.enabled === false) throw new Error(`Provider "${provider.name}" is disabled`);

  const adapter = getAdapter(provider.type);
  return adapter.completeChat({
    provider, modelId, systemPrompt, userPrompt, appTitle,
  });
}

/**
 * Raw chat completion through a specific provider — supports arbitrary
 * message arrays and tool-calling. Returns the full parsed response body
 * (OpenAI-style: `{ choices: [{ message: { content, tool_calls } }], ... }`).
 */
export async function chatCompletion({ providerId, modelId, messages, tools, appTitle }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);
  if (provider.enabled === false) throw new Error(`Provider "${provider.name}" is disabled`);

  const adapter = getAdapter(provider.type);
  if (!adapter.chatCompletion) {
    throw new Error(`Provider "${provider.name}" (${provider.type}) does not support tool-calling chat completion`);
  }
  return adapter.chatCompletion({
    provider, modelId, messages, tools, appTitle,
  });
}

/**
 * Streaming raw chat completion through a specific provider. Supports
 * arbitrary message arrays, including multimodal image content.
 *
 * @returns {Promise<string|Object>} Full accumulated assistant text by default,
 * or an OpenAI-style response object when `returnResponse` is true.
 */
export async function streamChatCompletion({ providerId, modelId, messages, tools, toolChoice, appTitle, onChunk, returnResponse = false, signal, params }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);
  if (provider.enabled === false) throw new Error(`Provider "${provider.name}" is disabled`);

  const adapter = getAdapter(provider.type);
  if (adapter.streamChatCompletion) {
    return adapter.streamChatCompletion({
      provider, modelId, messages, tools, toolChoice, appTitle, onChunk, returnResponse, signal,
      params,
    });
  }

  const response = await chatCompletion({ providerId, modelId, messages, tools, appTitle });
  const content = response?.choices?.[0]?.message?.content || '';
  onChunk?.(content, { content, toolCalls: response?.choices?.[0]?.message?.tool_calls || [] });
  return returnResponse ? response : content;
}

// ── Parallel Generation ──

/**
 * Run streaming chat completions against multiple targets in parallel.
 *
 * @param {Object} params
 * @param {Array<{providerId: string, modelId: string}>} params.targets
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {string} [params.appTitle]
 * @param {Function} [params.onUpdate] - Called per-target with status updates:
 *   onUpdate({ providerId, modelId, key, status, partialText, finalText, error })
 *   status: 'queued' | 'running' | 'streaming' | 'completed' | 'failed'
 * @returns {Promise<Array>} Final results array
 */
export async function parallelStreamChat({ targets, systemPrompt, userPrompt, appTitle, onUpdate }) {
  if (!targets || targets.length === 0) {
    throw new Error('No targets specified for parallel generation');
  }

  const makeKey = (t) => `${t.providerId}::${t.modelId}`;

  // Emit initial queued state
  if (onUpdate) {
    for (const target of targets) {
      onUpdate({
        providerId: target.providerId,
        modelId: target.modelId,
        key: makeKey(target),
        status: 'queued',
        partialText: '',
        finalText: null,
        error: null,
      });
    }
  }

  const promises = targets.map(async (target) => {
    const key = makeKey(target);
    try {
      if (onUpdate) {
        onUpdate({
          providerId: target.providerId,
          modelId: target.modelId,
          key,
          status: 'running',
          partialText: '',
          finalText: null,
          error: null,
        });
      }

      const result = await streamChat({
        providerId: target.providerId,
        modelId: target.modelId,
        systemPrompt,
        userPrompt,
        appTitle,
        onChunk: onUpdate ? (partial) => {
          onUpdate({
            providerId: target.providerId,
            modelId: target.modelId,
            key,
            status: 'streaming',
            partialText: partial,
            finalText: null,
            error: null,
          });
        } : null,
      });

      const finalResult = {
        providerId: target.providerId,
        modelId: target.modelId,
        key,
        status: 'completed',
        text: result,
        error: null,
      };

      if (onUpdate) {
        onUpdate({
          ...finalResult,
          partialText: result,
          finalText: result,
        });
      }

      return finalResult;
    } catch (e) {
      const failResult = {
        providerId: target.providerId,
        modelId: target.modelId,
        key,
        status: 'failed',
        text: '',
        error: e.message,
      };

      if (onUpdate) {
        onUpdate({
          ...failResult,
          partialText: '',
          finalText: null,
        });
      }

      return failResult;
    }
  });

  return Promise.all(promises);
}

/**
 * Run non-streaming chat completions against multiple targets in parallel.
 */
export async function parallelCompleteChat({ targets, systemPrompt, userPrompt, appTitle }) {
  if (!targets || targets.length === 0) {
    throw new Error('No targets specified for parallel generation');
  }

  const promises = targets.map(async (target) => {
    try {
      const text = await completeChat({
        providerId: target.providerId,
        modelId: target.modelId,
        systemPrompt,
        userPrompt,
        appTitle,
      });
      return {
        providerId: target.providerId,
        modelId: target.modelId,
        key: `${target.providerId}::${target.modelId}`,
        status: 'completed',
        text,
        error: null,
      };
    } catch (e) {
      return {
        providerId: target.providerId,
        modelId: target.modelId,
        key: `${target.providerId}::${target.modelId}`,
        status: 'failed',
        text: '',
        error: e.message,
      };
    }
  });

  return Promise.all(promises);
}

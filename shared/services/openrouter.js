// Centralized OpenRouter API service for all DevTools Hub apps.
//
// Persistence model:
//   API key  → <root>/_suite/api-keys.json `openrouterKey` field
//              (mirrored to localStorage["devtools-hub-openrouter-key"] as scratch)
//   Models   → <root>/_suite/openrouter-cache.json `models` field
//              ({ models: [...], timestamp: <ms> } shape, 1h TTL)
//
// The IIFE below runs first to consolidate any legacy per-app API keys into
// the canonical hub LS key, which is what suite-prefs then migrates to disk.
// All apps share a single key and model cache.

// settings-sync used to restore LS values from cookies; loaded first to
// preserve that behaviour while we work through the wider settings migration.
import './settings-sync.js';
import { applyParams, withUsageReporting, createRunStats } from './gen-params.js';

import {
  suite,
  hydrateSuite,
  setSuite,
  getSuiteField,
  migrateJsonField,
} from './suite-prefs.js';

const API_BASE = 'https://openrouter.ai/api/v1';
const KEYS_AREA = 'api-keys';
const KEY_FIELD = 'openrouterKey';
const LEGACY_KEY_LS = 'devtools-hub-openrouter-key';

const CACHE_AREA = 'openrouter-cache';
const CACHE_FIELD = 'models';
const LEGACY_CACHE_LS = 'devtools-hub-openrouter-models';
const MODELS_CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Legacy per-app keys — consolidated into the hub LS key on first load,
// after which the suite-prefs migration moves the hub key onto disk.
const LEGACY_PER_APP_KEYS = [
  'prompt-gallery-openrouter-key',
  'svg-benchmark-openrouter-key',
];

// Well-known free models as fallback if API fetch fails
const FALLBACK_FREE_MODELS = [
  { id: 'google/gemma-3-1b-it:free', name: 'Google: Gemma 3 1B' },
  { id: 'google/gemma-3-4b-it:free', name: 'Google: Gemma 3 4B' },
  { id: 'google/gemma-3-12b-it:free', name: 'Google: Gemma 3 12B' },
  { id: 'google/gemma-3-27b-it:free', name: 'Google: Gemma 3 27B' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Google: Gemini 2.0 Flash Exp' },
  { id: 'meta-llama/llama-3.3-8b-instruct:free', name: 'Meta: Llama 3.3 8B' },
  { id: 'meta-llama/llama-4-scout:free', name: 'Meta: Llama 4 Scout' },
  { id: 'meta-llama/llama-4-maverick:free', name: 'Meta: Llama 4 Maverick' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral: Small 3.1 24B' },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek: R1' },
  { id: 'deepseek/deepseek-chat-v3:free', name: 'DeepSeek: Chat V3' },
  { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen3 235B' },
  { id: 'qwen/qwen3-32b:free', name: 'Qwen3 32B' },
  { id: 'qwen/qwen3-30b-a3b:free', name: 'Qwen3 30B' },
  { id: 'qwen/qwen3-8b:free', name: 'Qwen3 8B' },
  { id: 'qwen/qwen3-4b:free', name: 'Qwen3 4B' },
  { id: 'microsoft/mai-ds-r1:free', name: 'Microsoft: MAI DS R1' },
  { id: 'moonshotai/kimi-k2:free', name: 'Moonshot: Kimi K2' },
];

function isFreeModel(model) {
  if (model.id?.toLowerCase().endsWith(':free')) return true;
  const pricing = model.pricing;
  if (!pricing) return false;
  const promptCost = Number.parseFloat(pricing.prompt ?? '1');
  const completionCost = Number.parseFloat(pricing.completion ?? '1');
  return promptCost === 0 && completionCost === 0;
}

function describeApiKey(apiKey) {
  const value = typeof apiKey === 'string' ? apiKey : String(apiKey ?? '');
  return {
    present: value.length > 0,
    length: value.length,
    prefix: value ? value.slice(0, 10) : '',
    suffix: value.length > 4 ? value.slice(-4) : '',
    hasWhitespace: value !== value.trim(),
    looksQuoted: value.startsWith('"') || value.endsWith('"') || value.startsWith("'") || value.endsWith("'"),
  };
}

async function throwOpenRouterError(res, context = {}) {
  const err = await res.json().catch(() => ({}));
  const message = err.error?.message || `API error: ${res.status}`;

  if (res.status === 401) {
    const keyInfo = describeApiKey(context.apiKey);
    console.warn('[OpenRouter] 401 Unauthorized request diagnostics', {
      model: context.modelId,
      appTitle: context.appTitle || 'DevTools Hub',
      referer: window.location.origin,
      apiKey: keyInfo,
      userPromptLength: typeof context.userPrompt === 'string' ? context.userPrompt.length : null,
      userPromptPreview: typeof context.userPrompt === 'string' ? context.userPrompt.slice(0, 120) : null,
    });
    const keyLabel = keyInfo.present
      ? `${keyInfo.prefix}${keyInfo.suffix ? `...${keyInfo.suffix}` : ''} (${keyInfo.length} chars)`
      : 'missing';
    throw new Error(`${message}. OpenRouter rejected the API key being sent: ${keyLabel}.`);
  }

  throw new Error(message);
}

// ── Pre-migration: consolidate legacy per-app keys into the hub LS key ──
// Runs synchronously before suite-prefs is seeded so the hub key is in
// place when the suite-prefs migration scans localStorage for it.

(function consolidateLegacyKeys() {
  try {
    if (!localStorage.getItem(LEGACY_KEY_LS)) {
      for (const legacyKey of LEGACY_PER_APP_KEYS) {
        const val = localStorage.getItem(legacyKey);
        if (val) {
          localStorage.setItem(LEGACY_KEY_LS, val);
          break;
        }
      }
    }
    for (const legacyKey of LEGACY_PER_APP_KEYS) localStorage.removeItem(legacyKey);
    // Per-app legacy model caches — drop, the hub cache supersedes them.
    localStorage.removeItem('prompt-gallery-openrouter-models');
    localStorage.removeItem('svg-benchmark-openrouter-models');
  } catch { /* private mode */ }
})();

// ── Seed + hydrate suite areas ──

const KEY_DEFAULTS = { [KEY_FIELD]: '' };
const KEY_LEGACY = { [KEY_FIELD]: LEGACY_KEY_LS };
suite(KEYS_AREA, { defaults: KEY_DEFAULTS, legacyKeys: KEY_LEGACY });
const keyHydration = hydrateSuite(KEYS_AREA, { defaults: KEY_DEFAULTS, legacyKeys: KEY_LEGACY });

suite(CACHE_AREA, { defaults: { [CACHE_FIELD]: null } });
(async () => {
  await migrateJsonField(CACHE_AREA, CACHE_FIELD, LEGACY_CACHE_LS);
  await hydrateSuite(CACHE_AREA, { defaults: { [CACHE_FIELD]: null } });
})();

// ── API Key management ──

export function getApiKey() {
  return getSuiteField(KEYS_AREA, KEY_FIELD, '') || '';
}

export function saveApiKey(key) {
  setSuite(KEYS_AREA, KEY_FIELD, key ? key.trim() : '');
}

export function hasApiKey() {
  return !!getApiKey();
}

async function getApiKeyForRequest() {
  try {
    await keyHydration;
  } catch { /* hydrateSuite already logs failures */ }
  return getApiKey();
}

// ── Model list ──

/**
 * Fetch models from OpenRouter with optional filters.
 *
 * @param {Object} [options]
 * @param {boolean} [options.freeOnly=false]       Only return models with zero pricing
 * @param {string}  [options.providerFilter]        Filter by provider prefix (e.g. "google", "meta-llama")
 * @param {string}  [options.search]                Text search on model id and name
 * @returns {Promise<Array<{id:string, name:string, context_length?:number, pricing?:object}>>}
 */
export async function fetchModels({ freeOnly = false, providerFilter, search } = {}) {
  // Check cache first (cache stores the full unfiltered list).
  let allModels = null;
  const cached = getSuiteField(CACHE_AREA, CACHE_FIELD, null);
  if (cached && Date.now() - cached.timestamp < MODELS_CACHE_TTL) {
    allModels = cached.models;
  }

  // Fetch from API if not cached (no auth required for model list).
  if (!allModels) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const apiKey = await getApiKeyForRequest();
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(`${API_BASE}/models`, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();

      allModels = (data.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length,
        pricing: m.pricing,
      }));

      if (allModels.length > 0) {
        setSuite(CACHE_AREA, CACHE_FIELD, { models: allModels, timestamp: Date.now() });
      }
    } catch (e) {
      console.warn('Failed to fetch OpenRouter models, using fallback list:', e.message);
      allModels = null;
    }
  }

  // Apply filters (mirrors the Python fetch_openrouter_models approach)
  let filtered = allModels || FALLBACK_FREE_MODELS;

  if (freeOnly) {
    filtered = filtered.filter(isFreeModel);
  }

  if (providerFilter) {
    const prefix = providerFilter.toLowerCase();
    filtered = filtered.filter(m => m.id.toLowerCase().startsWith(prefix));
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(m =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }

  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/** Convenience wrapper — fetches only free models. Backward-compatible. */
export async function fetchFreeModels() {
  return fetchModels({ freeOnly: true });
}

// ── Raw chat completion (supports tools, full message arrays) ──

/**
 * Send a raw OpenAI-style chat completion request to OpenRouter.
 * Unlike streamChat, this supports arbitrary message arrays and tool-calling.
 * Non-streaming — returns the full parsed response body.
 */
export async function chatCompletion({ modelId, messages, tools, appTitle }) {
  const apiKey = await getApiKeyForRequest();
  if (!apiKey) throw new Error('OpenRouter API key not set');

  const body = { model: modelId, messages };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': appTitle || 'DevTools Hub',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await throwOpenRouterError(res, {
      apiKey,
      modelId,
      appTitle,
      userPrompt: messages?.find(m => m?.role === 'user')?.content,
    });
  }
  return res.json();
}

/**
 * Stream a raw OpenAI-style chat completion request to OpenRouter.
 * Supports arbitrary message arrays, including multimodal image content.
 */
export async function streamChatCompletion({ modelId, messages, tools, appTitle, onChunk, returnResponse = false, signal }) {
  const apiKey = await getApiKeyForRequest();
  if (!apiKey) throw new Error('OpenRouter API key not set');

  const body = { model: modelId, messages, stream: true };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': appTitle || 'DevTools Hub',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    await throwOpenRouterError(res, {
      apiKey,
      modelId,
      appTitle,
      userPrompt: messages?.find(m => m?.role === 'user')?.content,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  const toolCallParts = [];
  let finishReason = null;

  function applyToolCallDelta(delta) {
    if (!delta) return;
    const index = Number.isInteger(delta.index) ? delta.index : toolCallParts.length;
    const current = toolCallParts[index] || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
    if (delta.id) current.id = delta.id;
    if (delta.type) current.type = delta.type;
    if (delta.function?.name) current.function.name += delta.function.name;
    if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
    toolCallParts[index] = current;
  }

  function normalisedToolCalls() {
    return toolCallParts.filter(Boolean).map((tc, index) => ({
      id: tc.id || `call_${index}`,
      type: tc.type || 'function',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '',
      },
    }));
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;
        let choice;
        try {
          choice = JSON.parse(data).choices?.[0] || {};
        } catch { continue; /* skip malformed chunks */ }
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) {
          full += delta.content;
        }
        if (delta.tool_calls) {
          delta.tool_calls.forEach(applyToolCallDelta);
        }
        if (delta.content || delta.tool_calls) {
          // Outside the parse guard so consumer onChunk errors propagate.
          onChunk?.(full, { content: full, toolCalls: normalisedToolCalls(), finishReason });
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* already closed */ }
  }

  if (!returnResponse) return full;
  const message = {
    role: 'assistant',
    content: full || null,
  };
  const calls = normalisedToolCalls();
  if (calls.length > 0) message.tool_calls = calls;
  return { choices: [{ message, finish_reason: finishReason || 'stop' }] };
}

// ── Generic streaming chat completion ──

export async function streamChat({ systemPrompt, userPrompt, modelId, appTitle, onChunk, params, onStats }) {
  const apiKey = await getApiKeyForRequest();
  if (!apiKey) throw new Error('OpenRouter API key not set');
  if (!userPrompt) throw new Error('Prompt is empty');

  const stats = createRunStats();
  let body = applyParams({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: !!onChunk,
  }, params, 'openrouter');
  if (onStats) body = withUsageReporting(body, 'openrouter');

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': appTitle || 'DevTools Hub',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await throwOpenRouterError(res, { apiKey, modelId, appTitle, userPrompt });
  }

  // Streaming response
  if (onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') break;
          let delta, parsed;
          try {
            parsed = JSON.parse(data);
            delta = parsed.choices?.[0]?.delta?.content;
          } catch (e) { continue; /* skip malformed chunks */ }

          // OpenRouter streams thinking on `delta.reasoning`; keep it out of the
          // answer text and just record that the model thought.
          if (parsed.choices?.[0]?.delta?.reasoning) stats.markReasoning();
          if (parsed.choices?.[0]?.finish_reason) stats.setFinishReason(parsed.choices[0].finish_reason);
          if (parsed.usage) stats.setUsage(parsed.usage);

          if (delta) {
            stats.markFirstToken();
            full += delta;
            // Outside the parse guard: a consumer throwing from onChunk
            // (e.g. a runaway-output cap) must abort the stream, not be
            // swallowed as a malformed chunk.
            onChunk(full);
          }
        }
      }
    } finally {
      try { reader.cancel(); } catch { /* already closed */ }
    }
    onStats?.(stats.finish());
    return full;
  }

  // Non-streaming response
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (onStats) {
    if (data.choices?.[0]?.message?.reasoning) stats.markReasoning();
    stats.setFinishReason(data.choices?.[0]?.finish_reason);
    stats.setUsage(data.usage);
    onStats(stats.finish());
  }
  return content;
}

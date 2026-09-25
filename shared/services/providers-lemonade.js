// Lemonade provider adapter.
// Lemonade exposes an OpenAI-compatible local API at /v1.

import { applyParams, withUsageReporting, createRunStats } from './gen-params.js';
import { localNetworkFetch } from './local-network.js';

export const PROVIDER_TYPE = 'lemonade';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT = 600000;
const DEFAULT_GENERATION_TIMEOUT = 600000;

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function requestHeaders(provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

async function readError(res) {
  try {
    const data = await res.json();
    return data.error?.message || data.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}: ${res.statusText}`;
  }
}

function formatModelName(id) {
  const raw = String(id || '');
  let name = raw.startsWith('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw.replace(/^[^/]*\//, '');
  name = name.replace(/\.(gguf|bin|safetensors)$/i, '');
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function parseSseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return { done: true };
  try {
    return { parsed: JSON.parse(data) };
  } catch {
    return null;
  }
}

function addToolCallDelta(toolCallParts, delta) {
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

function normalizedToolCalls(toolCallParts) {
  return toolCallParts.filter(Boolean).map((call, index) => ({
    id: call.id || `call_${index}`,
    type: call.type || 'function',
    function: {
      name: call.function?.name || '',
      arguments: call.function?.arguments || '',
    },
  }));
}

function messagesForPrompt(systemPrompt, userPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return messages;
}

function timeoutError(provider, message) {
  return new Error(`Lemonade ${provider.name}: ${message}`);
}

/** Validate a Lemonade provider config. */
export function validateProvider(provider) {
  if (!provider || provider.type !== PROVIDER_TYPE) {
    return { valid: false, error: 'Not a Lemonade provider' };
  }
  if (!provider.baseUrl) {
    return { valid: false, error: 'baseUrl is required for Lemonade providers' };
  }
  try {
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { valid: false, error: 'baseUrl is not a valid HTTP URL' };
  }
  return { valid: true };
}

/** Test the Lemonade endpoint by fetching its OpenAI-compatible model list. */
export async function testConnection(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  try {
    const res = await localNetworkFetch(`${baseUrl}/v1/models`, {
      headers: requestHeaders(provider),
      signal: AbortSignal.timeout(Math.min(timeout, 10000)),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    const data = await res.json();
    return { ok: true, modelCount: Array.isArray(data.data) ? data.data.length : 0 };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: e.message };
  }
}

/** Fetch and normalize models from Lemonade's OpenAI-compatible catalogue. */
export async function fetchModels(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  const res = await localNetworkFetch(`${baseUrl}/v1/models`, {
    headers: requestHeaders(provider),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Lemonade ${provider.name}: HTTP ${res.status}`);

  const data = await res.json();
  return (data.data || []).map(model => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: model.id,
    name: model.name || formatModelName(model.id),
    displayLabel: `${provider.name} / ${model.name || formatModelName(model.id)}`,
    supportsStreaming: true,
    contextLength: model.context_length || model.context_window || model.meta?.n_ctx || null,
    pricing: null,
    tags: provider.tags || [],
    raw: model,
  }));
}

/**
 * Resolve one watchdog duration. A per-call value wins over the provider
 * setting, and **0 disables the watchdog entirely** — the caller's AbortSignal
 * (a stop button) is then the only bound, which is what a slow local model
 * spending minutes on prompt processing actually needs.
 */
function pickTimeout(explicit, configured, fallback) {
  const value = [explicit, configured, fallback].find(v => Number.isFinite(Number(v)));
  return Math.max(0, Number(value) || 0);
}

/**
 * POST the chat request and return a live handle, not a bare Response: the
 * caller holds it for the whole body read so the external signal stays wired to
 * the fetch (a mid-stream stop really tears the connection down) and `arm()`
 * re-arms the inactivity watchdog per chunk. Call `release()` when done.
 */
async function postChat(provider, body, { stream = false, signal, timeouts = {}, telemetry = null } = {}) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const limitMs = stream
    ? pickTimeout(timeouts.streamMs, provider.streamTimeoutMs, DEFAULT_STREAM_INACTIVITY_TIMEOUT)
    : pickTimeout(timeouts.generationMs, provider.generationTimeoutMs, DEFAULT_GENERATION_TIMEOUT);
  const controller = new AbortController();
  let timer = null;
  let externalAbortHandler;
  let released = false;

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    externalAbortHandler = () => controller.abort(signal.reason);
    signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  const arm = () => {
    if (!limitMs || released) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('Lemonade request timeout', 'TimeoutError')), limitMs);
  };
  const release = () => {
    released = true;
    clearTimeout(timer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  };

  arm();
  try {
    telemetry?.mark('dispatched');
    const res = await localNetworkFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: requestHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.ok) telemetry?.mark('sessionReady');
    return { res, arm, release, signal, telemetry };
  } catch (e) {
    release();
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (signal?.aborted) throw new DOMException('Request aborted by caller', 'AbortError');
      throw timeoutError(provider, stream ? 'Stream timed out' : 'Connection timed out');
    }
    throw e;
  }
}

/** Stream a standard system/user completion from Lemonade. */
export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, params, onStats, telemetry }) {
  const stats = createRunStats(undefined, telemetry);
  let body = applyParams({
    model: modelId,
    messages: messagesForPrompt(systemPrompt, userPrompt),
    stream: !!onChunk,
  }, params, PROVIDER_TYPE);
  if (onChunk) body = withUsageReporting(body, PROVIDER_TYPE);

  const call = await postChat(provider, body, { stream: !!onChunk, telemetry });
  const { res } = call;
  if (!res.ok) { call.release(); throw new Error(`Lemonade ${provider.name}: ${await readError(res)}`); }

  if (!onChunk) {
    try {
      const data = await res.json();
      const message = data.choices?.[0]?.message;
      if (message?.reasoning_content) stats.markReasoning();
      stats.setFinishReason(data.choices?.[0]?.finish_reason);
      stats.setUsage(data.usage);
      onStats?.(stats.finish());
      return message?.content || '';
    } finally {
      call.release();
    }
  }

  return readStreamingResponse(call, provider, onChunk, onStats, stats);
}

async function readStreamingResponse(call, provider, onChunk, onStats, stats, { returnResponse = false } = {}) {
  const { res, arm = () => {}, release = () => {}, signal } = call;
  const reader = res.body?.getReader();
  if (!reader) { release(); throw new Error(`Lemonade ${provider.name}: Response has no readable body`); }
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason = null;
  const toolCallParts = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(); // data arrived: restart the inactivity watchdog
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event) continue;
        if (event.done) break;
        const choice = event.parsed?.choices?.[0] || {};
        const delta = choice.delta || {};
        if (choice.finish_reason) { finishReason = choice.finish_reason; stats.setFinishReason(finishReason); }
        if (delta.reasoning_content) stats.markReasoning();
        if (delta.tool_calls) {
          call.telemetry?.mark('firstTool');
          delta.tool_calls.forEach(part => addToolCallDelta(toolCallParts, part));
        }
        if (event.parsed?.usage) stats.setUsage(event.parsed.usage);
        if (delta.content) {
          stats.markFirstToken();
          full += delta.content;
        }
        if (delta.content || delta.tool_calls) {
          const toolCalls = normalizedToolCalls(toolCallParts);
          onChunk?.(full, { content: full, toolCalls, finishReason });
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      // A caller-initiated stop must never look like a finished turn, however
      // much text had already streamed.
      if (signal?.aborted) throw new DOMException('Request aborted by caller', 'AbortError');
      if (full) return returnResponse ? openAiResponse(full, toolCallParts, finishReason) : full;
      throw timeoutError(provider, 'Stream timed out');
    }
    throw e;
  } finally {
    release();
  }

  onStats?.(stats.finish());
  if (!returnResponse) return full;
  return openAiResponse(full, toolCallParts, finishReason);
}

function openAiResponse(content, toolCallParts, finishReason) {
  const message = { role: 'assistant', content: content || null };
  const toolCalls = normalizedToolCalls(toolCallParts);
  if (toolCalls.length) message.tool_calls = toolCalls;
  return { choices: [{ message, finish_reason: finishReason || 'stop' }] };
}

/** Raw non-streaming OpenAI-compatible completion, including tools. */
export async function chatCompletion({ provider, modelId, messages, tools, timeouts, telemetry }) {
  const body = { model: modelId, messages, stream: false };
  if (tools?.length) body.tools = tools;
  const call = await postChat(provider, body, { timeouts, telemetry });
  try {
    if (!call.res.ok) throw new Error(`Lemonade ${provider.name}: ${await readError(call.res)}`);
    const data = await call.res.json();
    if (telemetry) createRunStats(undefined, telemetry).setUsage(data?.usage);
    return data;
  } finally {
    call.release();
  }
}

/** Raw streaming OpenAI-compatible completion, including tools. */
export async function streamChatCompletion({ provider, modelId, messages, tools, onChunk, returnResponse = false, signal, timeouts, telemetry, }) {
  const body = { model: modelId, messages, stream: true };
  if (tools?.length) body.tools = tools;
  const call = await postChat(provider, body, { stream: true, signal, timeouts, telemetry });
  if (!call.res.ok) { call.release(); throw new Error(`Lemonade ${provider.name}: ${await readError(call.res)}`); }
  return readStreamingResponse(call, provider, onChunk, null, createRunStats(undefined, telemetry), { returnResponse });
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle, telemetry }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, appTitle, telemetry });
}

/** Create a Lemonade provider entry for the Settings registry. */
export function createProvider({ id, name, baseUrl, tags = [], timeoutMs = DEFAULT_TIMEOUT }) {
  return {
    id: id || `lemonade-${Date.now()}`,
    type: PROVIDER_TYPE,
    name: name || 'Lemonade',
    baseUrl,
    enabled: true,
    tags,
    timeoutMs,
  };
}

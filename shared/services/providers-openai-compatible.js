// Generic OpenAI-compatible provider adapter.
//
// Talks plain `/v1/models` + `/v1/chat/completions` to any server that speaks
// the OpenAI wire format — llama.cpp's llama-server, vLLM, TGI's OpenAI shim,
// Ollama's /v1, LiteLLM, ninfer, or a hand-rolled gateway.
//
// CORS: most of these servers answer curl happily but send no
// `Access-Control-Allow-Origin` and 404 the OPTIONS preflight, which makes them
// unreachable from a browser tab. So by default this adapter routes through the
// hub's own same-origin proxy at `/__llm/<base64url-target>/...` (see serve.py),
// where CORS does not apply at all. Set `useProxy: false` on the provider to
// call the endpoint directly instead — correct when the server does send CORS
// headers, and required when the page is not served by serve.py.

import { applyParams, withUsageReporting, createRunStats } from './gen-params.js';
import { localNetworkFetch } from './local-network.js';

export const PROVIDER_TYPE = 'openai-compatible';

/** Same-origin proxy mount in serve.py. Keep in sync with LLM_PROXY_PREFIX. */
export const HUB_PROXY_PREFIX = '/__llm';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT = 600000;
const DEFAULT_GENERATION_TIMEOUT = 600000;

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** base64url of the target origin, so a full URL survives one path segment. */
export function encodeProxyTarget(baseUrl) {
  const bytes = new TextEncoder().encode(normalizeBaseUrl(baseUrl));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when this provider's traffic goes through the hub proxy (the default). */
export function usesProxy(provider) {
  return provider?.useProxy !== false;
}

/**
 * Absolute (direct) or same-origin (proxied) URL for an endpoint path.
 * @param {Object} provider
 * @param {string} path - Leading-slash path, e.g. `/v1/models`.
 */
export function endpointUrl(provider, path) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  if (!usesProxy(provider)) return `${baseUrl}${path}`;
  return `${HUB_PROXY_PREFIX}/${encodeProxyTarget(baseUrl)}${path}`;
}

// Proxied calls are same-origin, so Chrome's Local Network Access machinery
// (and its targetAddressSpace hint) does not apply to them — only direct calls
// need localNetworkFetch's handling.
function endpointFetch(provider, path, init) {
  const url = endpointUrl(provider, path);
  if (usesProxy(provider)) return fetch(url, init);
  return localNetworkFetch(url, init);
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

// A proxied 404 with no body is what a plain static server returns for
// `/__llm/*`, so say so rather than blaming the model server.
function proxyUnavailableHint(provider, res) {
  if (!usesProxy(provider) || res.status !== 404) return '';
  return ' — the hub proxy at /__llm is not answering. Serve this page with serve.py,'
    + ' or turn off "Route through this hub" and enable CORS on the endpoint.';
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

function providerError(provider, message) {
  return new Error(`${provider.name}: ${message}`);
}

/** Validate an OpenAI-compatible provider config. */
export function validateProvider(provider) {
  if (!provider || provider.type !== PROVIDER_TYPE) {
    return { valid: false, error: 'Not an OpenAI-compatible provider' };
  }
  if (!provider.baseUrl) {
    return { valid: false, error: 'baseUrl is required (the origin serving /v1)' };
  }
  try {
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { valid: false, error: 'baseUrl is not a valid HTTP URL' };
  }
  return { valid: true };
}

/** Test the endpoint by fetching its model list. */
export async function testConnection(provider) {
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  try {
    const res = await endpointFetch(provider, '/v1/models', {
      headers: requestHeaders(provider),
      signal: AbortSignal.timeout(Math.min(timeout, 10000)),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}${proxyUnavailableHint(provider, res)}` };
    }
    const data = await res.json();
    const count = Array.isArray(data.data) ? data.data.length : 0;
    // A server with no catalogue is still usable when a model id is pinned.
    if (!count && manualModels(provider).length) {
      return { ok: true, modelCount: manualModels(provider).length };
    }
    return { ok: true, modelCount: count };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: e.message };
  }
}

// Servers that expose no catalogue (or one that omits the served model) still
// work when the user pins model ids by hand. `modelIds` is a comma-separated
// string or an array; `defaultModel` is the single-model shorthand.
function manualModels(provider) {
  const raw = provider.modelIds || provider.defaultModel || '';
  const ids = Array.isArray(raw) ? raw : String(raw).split(',');
  return ids.map(id => String(id).trim()).filter(Boolean);
}

function toModelEntry(provider, model) {
  const id = typeof model === 'string' ? model : model.id;
  const name = (typeof model === 'string' ? '' : model.name) || formatModelName(id);
  return {
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: id,
    name,
    displayLabel: `${provider.name} / ${name}`,
    supportsStreaming: true,
    contextLength: typeof model === 'string'
      ? null
      : (model.context_length || model.context_window || model.meta?.n_ctx || null),
    pricing: null,
    tags: provider.tags || [],
    raw: typeof model === 'string' ? { id } : model,
  };
}

/** Fetch and normalize the endpoint's model catalogue. */
export async function fetchModels(provider) {
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  const manual = manualModels(provider);
  let listed = [];
  try {
    const res = await endpointFetch(provider, '/v1/models', {
      headers: requestHeaders(provider),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw providerError(provider, `HTTP ${res.status}${proxyUnavailableHint(provider, res)}`);
    const data = await res.json();
    listed = Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    // Pinned ids are the whole point for a server with no /v1/models.
    if (!manual.length) throw e;
  }

  const entries = listed.map(model => toModelEntry(provider, model));
  const seen = new Set(entries.map(entry => entry.modelId));
  for (const id of manual) {
    if (!seen.has(id)) entries.push(toModelEntry(provider, id));
  }
  return entries;
}

async function postChat(provider, body, { stream = false, signal } = {}) {
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;
  const controller = new AbortController();
  let externalAbortHandler;

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    externalAbortHandler = () => controller.abort(signal.reason);
    signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timeout', 'TimeoutError')),
    stream ? (provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT) : timeout,
  );

  try {
    return await endpointFetch(provider, '/v1/chat/completions', {
      method: 'POST',
      headers: requestHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw providerError(provider, stream ? 'Stream timed out' : 'Connection timed out');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  }
}

/** Stream a standard system/user completion. */
export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, params, onStats }) {
  const stats = createRunStats();
  let body = applyParams({
    model: modelId,
    messages: messagesForPrompt(systemPrompt, userPrompt),
    stream: !!onChunk,
  }, params, PROVIDER_TYPE);
  if (onChunk) body = withUsageReporting(body, PROVIDER_TYPE);

  const res = await postChat(provider, body, { stream: !!onChunk });
  if (!res.ok) throw providerError(provider, `${await readError(res)}${proxyUnavailableHint(provider, res)}`);

  if (!onChunk) {
    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (message?.reasoning_content) stats.markReasoning();
    stats.setFinishReason(data.choices?.[0]?.finish_reason);
    stats.setUsage(data.usage);
    onStats?.(stats.finish());
    return message?.content || '';
  }

  return readStreamingResponse(res, provider, onChunk, onStats, stats);
}

async function readStreamingResponse(res, provider, onChunk, onStats, stats, { returnResponse = false } = {}) {
  const reader = res.body?.getReader();
  if (!reader) throw providerError(provider, 'Response has no readable body');
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason = null;
  const toolCallParts = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event) continue;
        if (event.done) break;
        const choice = event.parsed?.choices?.[0] || {};
        const delta = choice.delta || {};
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (delta.reasoning_content) stats.markReasoning();
        if (delta.tool_calls) delta.tool_calls.forEach(call => addToolCallDelta(toolCallParts, call));
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
      if (full) return returnResponse ? openAiResponse(full, toolCallParts, finishReason) : full;
      throw providerError(provider, 'Stream timed out');
    }
    throw e;
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

/** Raw non-streaming completion, including tools. */
export async function chatCompletion({ provider, modelId, messages, tools, toolChoice, params }) {
  const body = applyParams({ model: modelId, messages, stream: false }, params, PROVIDER_TYPE);
  if (tools?.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }
  const res = await postChat(provider, body);
  if (!res.ok) throw providerError(provider, `${await readError(res)}${proxyUnavailableHint(provider, res)}`);
  return res.json();
}

/** Raw streaming completion, including tools. */
export async function streamChatCompletion({
  provider, modelId, messages, tools, toolChoice, onChunk, returnResponse = false, signal, params,
}) {
  let body = applyParams({ model: modelId, messages, stream: true }, params, PROVIDER_TYPE);
  body = withUsageReporting(body, PROVIDER_TYPE);
  if (tools?.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }
  const res = await postChat(provider, body, { stream: true, signal });
  if (!res.ok) throw providerError(provider, `${await readError(res)}${proxyUnavailableHint(provider, res)}`);
  return readStreamingResponse(res, provider, onChunk, null, createRunStats(), { returnResponse });
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, appTitle });
}

/** Create an OpenAI-compatible provider entry for the Settings registry. */
export function createProvider({
  id, name, baseUrl, apiKey = '', modelIds = '', tags = [],
  timeoutMs = DEFAULT_TIMEOUT, useProxy = true,
}) {
  return {
    id: id || `openai-compatible-${Date.now()}`,
    type: PROVIDER_TYPE,
    name: name || 'OpenAI-Compatible',
    baseUrl,
    apiKey,
    modelIds,
    enabled: true,
    useProxy,
    tags,
    timeoutMs,
  };
}

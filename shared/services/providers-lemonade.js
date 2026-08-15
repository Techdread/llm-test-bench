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

async function postChat(provider, body, { stream = false, signal } = {}) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;
  const controller = new AbortController();
  let timer;
  let externalAbortHandler;

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    externalAbortHandler = () => controller.abort(signal.reason);
    signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  timer = setTimeout(() => controller.abort(new DOMException('Lemonade request timeout', 'TimeoutError')), stream
    ? (provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT)
    : timeout);

  try {
    return await localNetworkFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: requestHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw timeoutError(provider, stream ? 'Stream timed out' : 'Connection timed out');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  }
}

/** Stream a standard system/user completion from Lemonade. */
export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, params, onStats }) {
  const stats = createRunStats();
  let body = applyParams({
    model: modelId,
    messages: messagesForPrompt(systemPrompt, userPrompt),
    stream: !!onChunk,
  }, params, PROVIDER_TYPE);
  if (onChunk) body = withUsageReporting(body, PROVIDER_TYPE);

  const res = await postChat(provider, body, { stream: !!onChunk });
  if (!res.ok) throw new Error(`Lemonade ${provider.name}: ${await readError(res)}`);

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
  if (!reader) throw new Error(`Lemonade ${provider.name}: Response has no readable body`);
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
      throw timeoutError(provider, 'Stream timed out');
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

/** Raw non-streaming OpenAI-compatible completion, including tools. */
export async function chatCompletion({ provider, modelId, messages, tools }) {
  const body = { model: modelId, messages, stream: false };
  if (tools?.length) body.tools = tools;
  const res = await postChat(provider, body);
  if (!res.ok) throw new Error(`Lemonade ${provider.name}: ${await readError(res)}`);
  return res.json();
}

/** Raw streaming OpenAI-compatible completion, including tools. */
export async function streamChatCompletion({ provider, modelId, messages, tools, onChunk, returnResponse = false, signal }) {
  const body = { model: modelId, messages, stream: true };
  if (tools?.length) body.tools = tools;
  const res = await postChat(provider, body, { stream: true, signal });
  if (!res.ok) throw new Error(`Lemonade ${provider.name}: ${await readError(res)}`);
  return readStreamingResponse(res, provider, onChunk, null, createRunStats(), { returnResponse });
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, appTitle });
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

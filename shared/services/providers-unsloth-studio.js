// Unsloth Studio provider adapter.
// Unsloth Studio exposes an OpenAI-compatible API, but unlike most LAN-only
// LM Studio setups it normally requires a bearer token.

export const PROVIDER_TYPE = 'unsloth-studio';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_GENERATION_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT = 5 * 60 * 1000;
const KEY_PREFIX = 'devtools-hub-unsloth-studio-key:';

function storage() {
  try {
    const store = globalThis.localStorage || null;
    return store && typeof store.getItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

function providerId(providerOrId) {
  return typeof providerOrId === 'string' ? providerOrId : providerOrId?.id;
}

export function getApiKey(providerOrId) {
  const id = providerId(providerOrId);
  if (!id) return '';
  return storage()?.getItem(`${KEY_PREFIX}${id}`) || '';
}

export function saveApiKey(providerOrId, key) {
  const id = providerId(providerOrId);
  if (!id) return;
  const store = storage();
  if (!store) return;
  const storageKey = `${KEY_PREFIX}${id}`;
  if (key?.trim()) store.setItem(storageKey, key.trim());
  else store.removeItem(storageKey);
}

export function hasApiKey(providerOrId) {
  return !!getApiKey(providerOrId);
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function authHeaders(provider, extra = {}) {
  const key = getApiKey(provider);
  return {
    ...extra,
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

function parseErrorBody(body, fallback) {
  return body?.error?.message || body?.message || fallback;
}

async function errorMessage(res) {
  try {
    return parseErrorBody(await res.json(), `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}: ${res.statusText}`;
  }
}

function formatModelName(id) {
  return String(id || 'Unsloth Studio')
    .replace(/^[^/]*\//, '')
    .replace(/\.(gguf|bin|safetensors)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function modelListFromResponse(data, provider) {
  const rawModels = Array.isArray(data?.data) ? data.data : [];
  if (rawModels.length > 0) return rawModels;
  const fallback = provider.defaultModel || provider.modelId || 'unsloth-studio';
  return [{ id: fallback, object: 'model' }];
}

function normaliseToolCalls(toolCallParts) {
  return toolCallParts.filter(Boolean).map((tc, index) => ({
    id: tc.id || `call_${index}`,
    type: tc.type || 'function',
    function: {
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '',
    },
  }));
}

function applyToolCallDelta(toolCallParts, delta) {
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

function chatBody({ modelId, messages, tools, stream }) {
  const body = { messages, stream };
  if (modelId) body.model = modelId;
  if (tools?.length) body.tools = tools;
  return body;
}

export function validateProvider(provider) {
  if (!provider || provider.type !== PROVIDER_TYPE) {
    return { valid: false, error: 'Not an Unsloth Studio provider' };
  }
  if (!provider.baseUrl) {
    return { valid: false, error: 'baseUrl is required for Unsloth Studio providers' };
  }
  try {
    new URL(provider.baseUrl);
  } catch {
    return { valid: false, error: 'baseUrl is not a valid URL' };
  }
  return { valid: true };
}

export async function testConnection(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: authHeaders(provider),
      signal: AbortSignal.timeout(Math.min(timeout, 10000)),
    });
    if (!res.ok) return { ok: false, error: await errorMessage(res) };
    const data = await res.json();
    return { ok: true, modelCount: modelListFromResponse(data, provider).length };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: e.message };
  }
}

export async function fetchModels(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers: authHeaders(provider),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    throw new Error(`Unsloth Studio ${provider.name}: ${await errorMessage(res)}`);
  }

  const data = await res.json();
  return modelListFromResponse(data, provider).map(m => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: m.id,
    name: m.name || formatModelName(m.id),
    displayLabel: `${provider.name} / ${m.name || formatModelName(m.id)}`,
    supportsStreaming: true,
    contextLength: m.context_length || null,
    pricing: null,
    tags: provider.tags || [],
    raw: m,
  }));
}

export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, appTitle }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  if (onChunk) {
    return streamChatCompletion({ provider, modelId, messages, onChunk });
  }
  const response = await chatCompletion({ provider, modelId, messages });
  return response?.choices?.[0]?.message?.content || '';
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, appTitle });
}

export async function chatCompletion({ provider, modelId, messages, tools }) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(provider, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(chatBody({ modelId, messages, tools, stream: false })),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    throw new Error(`Unsloth Studio ${provider.name}: ${await errorMessage(res)}`);
  }
  return res.json();
}

export async function streamChatCompletion({ provider, modelId, messages, tools, onChunk, returnResponse = false, signal }) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const streamTimeout = provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT;
  const controller = new AbortController();
  let inactivityTimer = null;
  let externalAbortHandler = null;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(new DOMException('Unsloth Studio stream inactivity timeout', 'TimeoutError'));
    }, streamTimeout);
  }

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    externalAbortHandler = () => controller.abort(signal.reason);
    signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  resetInactivityTimer();
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(provider, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(chatBody({ modelId, messages, tools, stream: true })),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`Unsloth Studio ${provider.name}: Stream timed out`);
    }
    throw e;
  }

  if (!res.ok) {
    clearTimeout(inactivityTimer);
    throw new Error(`Unsloth Studio ${provider.name}: ${await errorMessage(res)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let finishReason = null;
  const toolCallParts = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetInactivityTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.replace(/^data:\s*/, '');
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0] || {};
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};
          const text = delta.content || delta.reasoning_content || '';
          if (text) full += text;
          if (delta.tool_calls) delta.tool_calls.forEach(tc => applyToolCallDelta(toolCallParts, tc));
          if (text || delta.tool_calls) {
            onChunk?.(full, {
              content: full,
              toolCalls: normaliseToolCalls(toolCallParts),
              finishReason,
            });
          }
        } catch {
          // Ignore malformed SSE lines.
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (!full) throw new Error(`Unsloth Studio ${provider.name}: Stream timed out`);
      if (!returnResponse) return full;
    } else {
      throw e;
    }
  } finally {
    clearTimeout(inactivityTimer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  }

  if (!returnResponse) return full;
  const message = { role: 'assistant', content: full || null };
  const calls = normaliseToolCalls(toolCallParts);
  if (calls.length > 0) message.tool_calls = calls;
  return { choices: [{ message, finish_reason: finishReason || 'stop' }] };
}

export function createProvider({ id, name, baseUrl = 'http://127.0.0.1:8888', tags = [], timeoutMs = DEFAULT_TIMEOUT }) {
  return {
    id: id || `unsloth-studio-${Date.now()}`,
    type: PROVIDER_TYPE,
    name: name || 'Unsloth Studio',
    baseUrl,
    enabled: true,
    tags,
    timeoutMs,
  };
}

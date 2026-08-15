// LM Studio provider adapter
// Supports one or more LAN LM Studio instances with OpenAI-compatible API

import { applyParams, withUsageReporting, createRunStats } from './gen-params.js';
import { localNetworkFetch } from './local-network.js';

export const PROVIDER_TYPE = 'lmstudio';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT = 600000; // 10 min inactivity timeout for streaming
const DEFAULT_GENERATION_TIMEOUT = 600000; // 10 min absolute timeout for non-streaming generations (tool-calling, etc.)
const MTMD_MEDIA_MARKER = '<__media__>';
const MTMD_LEGACY_IMAGE_MARKER = '<__image__>';

function stripDataUrlPrefix(value) {
  if (typeof value !== 'string') return value;
  const match = /^data:[^,]*;base64,(.*)$/is.exec(value);
  return match ? match[1] : value;
}

function isImagePart(part) {
  return part?.type === 'image_url' && part.image_url;
}

function getImagePartUrl(part) {
  if (!isImagePart(part)) return '';
  return typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
}

function countMediaMarkers(text) {
  if (typeof text !== 'string' || !text) return 0;
  const mediaCount = text.split(MTMD_MEDIA_MARKER).length - 1;
  const legacyCount = text.split(MTMD_LEGACY_IMAGE_MARKER).length - 1;
  return mediaCount + legacyCount;
}

function adaptImagePartForLmStudio(part) {
  const url = getImagePartUrl(part);
  if (typeof part.image_url === 'string') {
    return { ...part, image_url: stripDataUrlPrefix(url) };
  }
  return {
    ...part,
    image_url: {
      ...part.image_url,
      url: stripDataUrlPrefix(url),
    },
  };
}

function adaptContentForLmStudioVision(content) {
  if (!Array.isArray(content)) return content;

  const imageCount = content.filter(isImagePart).length;
  if (imageCount === 0) return content;

  const markerCount = content.reduce((sum, part) => {
    return sum + (part?.type === 'text' ? countMediaMarkers(part.text) : 0);
  }, 0);
  const missingMarkers = Math.max(0, imageCount - markerCount);
  const markerPrefix = missingMarkers > 0
    ? `${Array.from({ length: missingMarkers }, () => MTMD_MEDIA_MARKER).join('\n')}\n`
    : '';

  let insertedMarkers = missingMarkers === 0;
  const adapted = content.map((part) => {
    if (isImagePart(part)) return adaptImagePartForLmStudio(part);
    if (part?.type === 'text' && !insertedMarkers) {
      insertedMarkers = true;
      return { ...part, text: `${markerPrefix}${part.text || ''}` };
    }
    return part;
  });

  if (!insertedMarkers) {
    adapted.unshift({ type: 'text', text: markerPrefix.trimEnd() });
  }
  return adapted;
}

function adaptMessagesForLmStudioVision(messages = []) {
  return messages.map((msg) => ({
    ...msg,
    content: adaptContentForLmStudioVision(msg.content),
  }));
}

function hasImageContent(messages = []) {
  return messages.some((msg) =>
    Array.isArray(msg?.content) && msg.content.some(isImagePart)
  );
}

function ensureDataUrl(value) {
  if (typeof value !== 'string') return '';
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
}

function textWithoutMediaMarkers(text) {
  return String(text || '')
    .split(MTMD_MEDIA_MARKER).join('')
    .split(MTMD_LEGACY_IMAGE_MARKER).join('')
    .trim();
}

function nativeChatBodyFromMessages(modelId, messages = [], { stream = false } = {}) {
  const systemParts = [];
  const input = [];

  for (const msg of messages) {
    if (msg?.role === 'system') {
      if (typeof msg.content === 'string') systemParts.push(msg.content);
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text' && part.text) systemParts.push(part.text);
        }
      }
      continue;
    }

    if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (part?.type === 'text') {
          const text = textWithoutMediaMarkers(part.text);
          // LM Studio's /api/v1/chat schema:
          //   { "type": "text",  "content": "<string>" }
          //   { "type": "image", "data_url": "<data url>" }
          // The discriminator is `type`. Text parts use `content`, not
          // `text`, even though the discriminator value is 'text'.
          if (text) input.push({ type: 'text', content: text });
        } else if (isImagePart(part)) {
          input.push({ type: 'image', data_url: ensureDataUrl(getImagePartUrl(part)) });
        }
      }
      continue;
    }

    if (typeof msg?.content === 'string') {
      const text = textWithoutMediaMarkers(msg.content);
      if (text) input.push({ type: 'text', content: text });
    }
  }

  return {
    model: modelId,
    input: input.length === 1 && input[0].type === 'text' ? input[0].content : input,
    ...(systemParts.length ? { system_prompt: systemParts.join('\n\n') } : {}),
    stream,
    store: false,
  };
}

function nativeOutputText(result) {
  const output = result?.output || result?.result?.output || [];
  if (!Array.isArray(output)) return '';
  // Accept both the historical `type: 'message'` and the current
  // `type: 'text'` LM Studio response shapes, plus a couple of common
  // property aliases.
  return output
    .filter(item => item && (item.type === 'message' || item.type === 'text'))
    .map(item => (typeof item.content === 'string' ? item.content
                : typeof item.text === 'string' ? item.text
                : ''))
    .join('');
}

async function readLmStudioError(res) {
  try {
    const err = await res.json();
    return err.error?.message || err.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}: ${res.statusText}`;
  }
}

function nativeToOpenAiResponse(result, finishReason = 'stop') {
  const content = nativeOutputText(result);
  return {
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: finishReason,
    }],
  };
}

function enrichLmStudioError(errMsg) {
  if (/number of bitmaps .* does not match number of markers/i.test(errMsg)) {
    return `${errMsg}. The local vision runtime did not pair the image with the prompt. Make sure the loaded LM Studio model is vision-capable and has its multimodal projector/mmproj available.`;
  }
  if (/model does not support vision input/i.test(errMsg)) {
    return `${errMsg}. Select a vision-capable model in LM Studio before running document OCR.`;
  }
  if (/'url' field must be a base64 encoded image/i.test(errMsg)) {
    return `${errMsg}. LM Studio expects raw base64 image data for this endpoint; update the app or LM Studio if this persists.`;
  }
  return errMsg;
}

async function chatCompletionNative({ provider, modelId, messages, signal }) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;
  const body = nativeChatBodyFromMessages(modelId, messages, { stream: false });

  let res;
  try {
    res = await localNetworkFetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LM Studio ${provider.name}: Connection timed out`);
    }
    throw e;
  }

  if (!res.ok) {
    const errMsg = await readLmStudioError(res);
    throw new Error(`LM Studio ${provider.name} native vision API: ${enrichLmStudioError(errMsg)}`);
  }

  const result = await res.json();
  return nativeToOpenAiResponse(result);
}

async function streamChatCompletionNative({ provider, modelId, messages, onChunk, returnResponse = false, signal }) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const streamTimeout = provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT;
  const controller = new AbortController();
  let inactivityTimer = null;
  let externalAbortHandler = null;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(new DOMException('LM Studio native stream inactivity timeout', 'TimeoutError'));
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
    res = await localNetworkFetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nativeChatBodyFromMessages(modelId, messages, { stream: true })),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LM Studio ${provider.name}: Native vision stream timed out (no data for ${streamTimeout / 1000}s)`);
    }
    throw e;
  }

  if (!res.ok) {
    clearTimeout(inactivityTimer);
    const errMsg = await readLmStudioError(res);
    throw new Error(`LM Studio ${provider.name} native vision API: ${enrichLmStudioError(errMsg)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  let full = '';
  let finalResult = null;
  let streamError = null;

  function flushEvent() {
    if (!eventName && dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    const type = eventName;
    eventName = '';
    dataLines = [];
    if (!raw) return;

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return; }

    if (type === 'message.delta' || parsed.type === 'message.delta') {
      const content = parsed.content || '';
      if (content) {
        full += content;
        onChunk?.(full);
      }
      return;
    }

    if (type === 'error' || parsed.type === 'error') {
      streamError = parsed.error?.message || parsed.message || 'Native vision stream failed';
      return;
    }

    if (type === 'chat.end' || parsed.type === 'chat.end') {
      finalResult = parsed.result || parsed;
      const finalText = nativeOutputText(finalResult);
      if (finalText && finalText !== full) {
        full = finalText;
        onChunk?.(full);
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetInactivityTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) {
          flushEvent();
          continue;
        }
        if (trimmed.startsWith('event:')) {
          eventName = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          dataLines.push(trimmed.slice(5).trimStart());
        }
      }
    }
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('event:')) eventName = trimmed.slice(6).trim();
        else if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trimStart());
      }
    }
    flushEvent();
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (full.length > 0) {
        if (!returnResponse) return full;
        return nativeToOpenAiResponse({ output: [{ type: 'message', content: full }] });
      }
      throw new Error(`LM Studio ${provider.name}: Native vision stream timed out (no data for ${streamTimeout / 1000}s)`);
    }
    throw e;
  } finally {
    clearTimeout(inactivityTimer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  }

  if (streamError) throw new Error(`LM Studio ${provider.name} native vision API: ${enrichLmStudioError(streamError)}`);
  if (!returnResponse) return full;
  return nativeToOpenAiResponse(finalResult || { output: [{ type: 'message', content: full }] });
}

/**
 * Validate an LM Studio provider config.
 */
export function validateProvider(provider) {
  if (!provider || provider.type !== PROVIDER_TYPE) {
    return { valid: false, error: 'Not an LM Studio provider' };
  }
  if (!provider.baseUrl) {
    return { valid: false, error: 'baseUrl is required for LM Studio providers' };
  }
  try {
    new URL(provider.baseUrl);
  } catch {
    return { valid: false, error: 'baseUrl is not a valid URL' };
  }
  return { valid: true };
}

/**
 * Normalize the base URL (strip trailing slash).
 */
function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

/**
 * Test the LM Studio connection by fetching the model list.
 */
export async function testConnection(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;
  try {
    const res = await localNetworkFetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(Math.min(timeout, 10000)),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    const models = data.data || [];
    return { ok: true, modelCount: models.length };
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: e.message };
  }
}

/**
 * Fetch models from an LM Studio endpoint, returning normalized model objects.
 */
export async function fetchModels(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const timeout = provider.timeoutMs || DEFAULT_TIMEOUT;

  const res = await localNetworkFetch(`${baseUrl}/v1/models`, {
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    throw new Error(`LM Studio ${provider.name}: HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawModels = data.data || [];

  // Best-effort: /v1/models doesn't advertise modality, but LM Studio's
  // /api/v0/models does (`type: "vlm" | "llm" | "embeddings"`). Fetch it and
  // index by id so we can tag vision-capable models. Non-fatal on failure.
  const typeById = await fetchLmStudioModelTypes(baseUrl, timeout);

  return rawModels.map(m => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: m.id,
    name: formatModelName(m.id),
    displayLabel: `${provider.name} / ${formatModelName(m.id)}`,
    supportsStreaming: true,
    contextLength: m.context_length || null,
    pricing: null,
    tags: provider.tags || [],
    raw: typeById[m.id] ? { ...m, type: typeById[m.id] } : m,
  }));
}

// Fetch /api/v0/models and return { [id]: type }. Swallows errors and returns
// {} so model loading never depends on this enrichment endpoint existing.
async function fetchLmStudioModelTypes(baseUrl, timeout) {
  try {
    const res = await localNetworkFetch(`${baseUrl}/api/v0/models`, {
      signal: AbortSignal.timeout(timeout || DEFAULT_TIMEOUT),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const m of (data.data || [])) {
      if (m && m.id && m.type) out[m.id] = m.type;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Format a model ID into a human-readable name.
 * e.g. "deepseek-r1-distill-qwen-14b" => "Deepseek R1 Distill Qwen 14B"
 */
function formatModelName(id) {
  // Remove common path prefixes (lmstudio-community/, etc.)
  let name = id.replace(/^[^/]*\//, '');
  // Remove file extensions
  name = name.replace(/\.(gguf|bin|safetensors)$/i, '');
  // Replace separators with spaces and capitalize
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Stream a chat completion from an LM Studio endpoint.
 * Uses an inactivity timeout for streaming (resets on each chunk)
 * so long-running generations aren't cut off prematurely.
 */
export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, appTitle, params, onStats }) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const stats = createRunStats();
  // Non-streaming generations (completeChat → suggestImprovements, etc.) are a
  // full model run, not a connection test, so they need the long generation
  // timeout. Reasoning models (Qwen3.6, etc.) can think for minutes before the
  // single response arrives, and the 30s DEFAULT_TIMEOUT would abort them — the
  // request looks like it "works" but the caller only ever sees a timeout error.
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;
  const streamTimeout = provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });

  // For streaming, use an inactivity-based timeout via AbortController
  // so the stream isn't killed while data is still flowing.
  // For non-streaming, use a simple absolute timeout.
  const controller = new AbortController();
  let inactivityTimer = null;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (onChunk) {
      inactivityTimer = setTimeout(() => {
        controller.abort(new DOMException('LM Studio stream inactivity timeout', 'TimeoutError'));
      }, streamTimeout);
    }
  }

  // Start the initial timer (covers time-to-first-token)
  if (onChunk) {
    resetInactivityTimer();
  } else {
    // Non-streaming: absolute timeout
    inactivityTimer = setTimeout(() => {
      controller.abort(new DOMException('LM Studio request timeout', 'TimeoutError'));
    }, timeout);
  }

  let res;
  try {
    let body = applyParams({ model: modelId, messages, stream: !!onChunk }, params, PROVIDER_TYPE);
    if (onChunk) body = withUsageReporting(body, PROVIDER_TYPE);

    res = await localNetworkFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LM Studio ${provider.name}: Connection timed out`);
    }
    throw e;
  }

  if (!res.ok) {
    clearTimeout(inactivityTimer);
    let errMsg;
    try {
      const err = await res.json();
      errMsg = err.error?.message || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}: ${res.statusText}`;
    }
    throw new Error(`LM Studio ${provider.name}: ${errMsg}`);
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

        // Reset inactivity timer on each chunk received
        resetInactivityTimer();

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
          } catch { continue; /* skip malformed chunks */ }

          // Thinking tokens arrive on their own field and are deliberately kept
          // out of `full` — callers want the answer, not the monologue. We only
          // record that (and how much) the model thought.
          if (parsed.choices?.[0]?.delta?.reasoning_content) stats.markReasoning();
          if (parsed.choices?.[0]?.finish_reason) stats.setFinishReason(parsed.choices[0].finish_reason);
          // The final chunk (stream_options.include_usage) carries token counts.
          if (parsed.usage) stats.setUsage(parsed.usage);

          if (delta) {
            stats.markFirstToken();
            full += delta;
            // Outside the parse guard so consumer onChunk errors propagate.
            onChunk(full);
          }
        }
      }
    } catch (e) {
      clearTimeout(inactivityTimer);
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        // If we already have partial content, return what we have with a warning
        if (full.length > 0) {
          console.warn(`LM Studio stream timed out after receiving ${full.length} chars, returning partial result`);
          return full;
        }
        throw new Error(`LM Studio ${provider.name}: Stream timed out (no data for ${streamTimeout / 1000}s)`);
      }
      throw e;
    } finally {
      clearTimeout(inactivityTimer);
    }
    clearTimeout(inactivityTimer);
    onStats?.(stats.finish());
    return full;
  }

  // Non-streaming response
  clearTimeout(inactivityTimer);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (onStats) {
    if (data.choices?.[0]?.message?.reasoning_content) stats.markReasoning();
    stats.setFinishReason(data.choices?.[0]?.finish_reason);
    stats.setUsage(data.usage);
    onStats(stats.finish());
  }
  return content;
}

/**
 * Non-streaming chat completion from an LM Studio endpoint.
 */
export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, appTitle });
}

/**
 * Raw chat completion from an LM Studio endpoint — supports arbitrary message
 * arrays and tool-calling. Returns the full parsed response body.
 */
export async function chatCompletion({ provider, modelId, messages, tools, toolChoice }) {
  if (!tools?.length && hasImageContent(messages)) {
    return chatCompletionNative({ provider, modelId, messages });
  }

  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  // Generations (especially tool-calling loops) can take minutes on local models,
  // so use a much longer absolute timeout than the 30s default used for
  // connection tests and model list fetches.
  const timeout = provider.generationTimeoutMs || DEFAULT_GENERATION_TIMEOUT;

  const body = { model: modelId, messages: adaptMessagesForLmStudioVision(messages), stream: false };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }

  let res;
  try {
    res = await localNetworkFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LM Studio ${provider.name}: Connection timed out`);
    }
    throw e;
  }

  if (!res.ok) {
    let errMsg;
    try {
      const err = await res.json();
      errMsg = err.error?.message || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}: ${res.statusText}`;
    }
    throw new Error(`LM Studio ${provider.name}: ${enrichLmStudioError(errMsg)}`);
  }

  return res.json();
}

/**
 * Streaming raw chat completion from an LM Studio endpoint — supports
 * arbitrary message arrays, including multimodal image content.
 */
export async function streamChatCompletion({ provider, modelId, messages, tools, toolChoice, onChunk, returnResponse = false, signal, params }) {
  if (!tools?.length && hasImageContent(messages)) {
    return streamChatCompletionNative({ provider, modelId, messages, onChunk, returnResponse, signal });
  }

  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const streamTimeout = provider.streamTimeoutMs || DEFAULT_STREAM_INACTIVITY_TIMEOUT;
  const controller = new AbortController();
  let inactivityTimer = null;
  let externalAbortHandler = null;

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      controller.abort(new DOMException('LM Studio stream inactivity timeout', 'TimeoutError'));
    }, streamTimeout);
  }

  let body = applyParams({
    model: modelId,
    messages: adaptMessagesForLmStudioVision(messages),
    stream: true,
  }, params, PROVIDER_TYPE);
  body = withUsageReporting(body, PROVIDER_TYPE);
  if (tools && tools.length > 0) {
    body.tools = tools;
    // Explicit is friendlier to local OpenAI-compatible servers/chat
    // templates than relying on their provider-specific default.
    body.tool_choice = toolChoice || 'auto';
  }

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    externalAbortHandler = () => controller.abort(signal.reason);
    signal.addEventListener('abort', externalAbortHandler, { once: true });
  }

  resetInactivityTimer();
  let res;
  try {
    res = await localNetworkFetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`LM Studio ${provider.name}: Stream timed out (no data for ${streamTimeout / 1000}s)`);
    }
    throw e;
  }

  if (!res.ok) {
    clearTimeout(inactivityTimer);
    let errMsg;
    try {
      const err = await res.json();
      errMsg = err.error?.message || `HTTP ${res.status}`;
    } catch {
      errMsg = `HTTP ${res.status}: ${res.statusText}`;
    }
    throw new Error(`LM Studio ${provider.name}: ${enrichLmStudioError(errMsg)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  const toolCallParts = [];
  let finishReason = null;
  let usage = null;

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

      resetInactivityTimer();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;
        let choice, parsed;
        try {
          parsed = JSON.parse(data);
          choice = parsed.choices?.[0] || {};
        } catch { continue; /* skip malformed chunks */ }
        if (parsed.usage) usage = parsed.usage;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        const reasoningDelta = delta.reasoning_content || delta.reasoning || '';
        if (delta.content) {
          full += delta.content;
        }
        if (delta.tool_calls) {
          delta.tool_calls.forEach(applyToolCallDelta);
        }
        if (delta.content || delta.tool_calls || reasoningDelta) {
          // Outside the parse guard so consumer onChunk errors propagate.
          // Reasoning stays out of assistant content, but still counts as live
          // model activity. Without this heartbeat, an outer build idle timer
          // aborts thinking models such as Muse Glimmer before they reach HTML.
          onChunk?.(full, {
            content: full,
            toolCalls: normalisedToolCalls(),
            finishReason,
            reasoning: !!reasoningDelta,
          });
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (full.length > 0) {
        console.warn(`LM Studio stream timed out after receiving ${full.length} chars, returning partial result`);
        if (!returnResponse) return full;
        const message = { role: 'assistant', content: full || null };
        const calls = normalisedToolCalls();
        if (calls.length > 0) message.tool_calls = calls;
        return {
          choices: [{ message, finish_reason: finishReason || 'stop' }],
          ...(usage ? { usage } : {}),
        };
      }
      throw new Error(`LM Studio ${provider.name}: Stream timed out (no data for ${streamTimeout / 1000}s)`);
    }
    throw e;
  } finally {
    clearTimeout(inactivityTimer);
    if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
  }

  if (!returnResponse) return full;
  const message = { role: 'assistant', content: full || null };
  const calls = normalisedToolCalls();
  if (calls.length > 0) message.tool_calls = calls;
  return {
    choices: [{ message, finish_reason: finishReason || 'stop' }],
    ...(usage ? { usage } : {}),
  };
}

/**
 * Create a new LM Studio provider entry.
 */
export function createProvider({ id, name, baseUrl, tags = [], timeoutMs = DEFAULT_TIMEOUT }) {
  return {
    id: id || `lmstudio-${Date.now()}`,
    type: PROVIDER_TYPE,
    name: name || 'LM Studio',
    baseUrl,
    enabled: true,
    tags,
    timeoutMs,
  };
}

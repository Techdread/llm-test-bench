// OpenRouter provider adapter
// Wraps the existing shared/services/openrouter.js behind the unified provider adapter contract

import {
  getApiKey,
  saveApiKey,
  hasApiKey,
  fetchModels as fetchOpenRouterModels,
  streamChat as openRouterStreamChat,
  chatCompletion as openRouterChatCompletion,
  streamChatCompletion as openRouterStreamChatCompletion,
} from './openrouter.js';

export { getApiKey, saveApiKey, hasApiKey };

export const PROVIDER_TYPE = 'openrouter';

/**
 * Validate an OpenRouter provider config.
 * OpenRouter only needs an API key (stored in localStorage, not in the provider object).
 */
export function validateProvider(provider) {
  if (!provider || provider.type !== PROVIDER_TYPE) {
    return { valid: false, error: 'Not an OpenRouter provider' };
  }
  return { valid: true };
}

/**
 * Test the OpenRouter connection by fetching the model list.
 * Requires an API key to be set.
 */
export async function testConnection(provider) {
  if (!hasApiKey()) {
    return { ok: false, error: 'No API key configured' };
  }
  try {
    const models = await fetchOpenRouterModels({ freeOnly: false });
    return { ok: true, modelCount: models.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Fetch models from OpenRouter, returning normalized model objects.
 * Defaults to fetching ALL models (free + paid). The shared provider layer
 * applies freeOnly filtering client-side via applyModelFilters().
 */
export async function fetchModels(provider, { freeOnly = false } = {}) {
  const raw = await fetchOpenRouterModels({ freeOnly });
  return raw.map(m => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: m.id,
    name: m.name || m.id,
    displayLabel: `${provider.name} / ${m.name || m.id}`,
    supportsStreaming: true,
    contextLength: m.context_length || null,
    pricing: m.pricing || null,
    tags: [],
    raw: m,
  }));
}

/**
 * Stream a chat completion through OpenRouter.
 */
export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, appTitle, params, onStats }) {
  return openRouterStreamChat({
    systemPrompt,
    userPrompt,
    modelId,
    appTitle,
    onChunk,
    params,
    onStats,
  });
}

/**
 * Non-streaming chat completion through OpenRouter.
 */
export async function completeChat({ provider, modelId, systemPrompt, userPrompt, appTitle }) {
  return openRouterStreamChat({
    systemPrompt,
    userPrompt,
    modelId,
    appTitle,
    onChunk: null,
  });
}

/**
 * Raw chat completion through OpenRouter — supports arbitrary message arrays
 * and tool-calling. Returns the full parsed response body.
 */
export async function chatCompletion({ provider, modelId, messages, tools, appTitle }) {
  return openRouterChatCompletion({ modelId, messages, tools, appTitle });
}

/**
 * Streaming raw chat completion through OpenRouter.
 */
export async function streamChatCompletion({ provider, modelId, messages, tools, appTitle, onChunk, returnResponse = false, signal }) {
  return openRouterStreamChatCompletion({ modelId, messages, tools, appTitle, onChunk, returnResponse, signal });
}

/**
 * Create a default OpenRouter provider entry.
 */
export function createDefaultProvider() {
  return {
    id: 'openrouter',
    type: PROVIDER_TYPE,
    name: 'OpenRouter',
    enabled: true,
  };
}

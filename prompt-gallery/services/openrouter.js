// Generation service for Prompt Gallery
// Uses the unified model-providers layer for provider/model management
// Keeps backward compat exports for OpenRouter API key management

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { streamChat } from '../../shared/services/model-providers.js';
import { streamHtmlDocument } from './htmlOutput.js';
import { PROMPT_GALLERY_CHAT_AGENT_BUDGETS } from './codingAgent.js';

export { getApiKey, saveApiKey, hasApiKey };

const SYSTEM_PROMPT = `You are an expert web developer. The user will give you a prompt describing what they want built.
You must respond with ONLY valid, complete HTML that can be rendered directly in a browser.
Include all CSS inline in a <style> tag and all JavaScript inline in a <script> tag.
Do NOT include any markdown, code fences, or explanations — output raw HTML only.
The HTML should be a complete document starting with <!DOCTYPE html>.
Make the output visually polished and modern.`;

/**
 * Generate HTML through the unified provider system.
 * @param {string} prompt - User prompt
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Model ID
 * @param {Function} [onChunk] - Streaming callback
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Stop: cancels a CLI-agent run on the
 *   bridge and detaches any other stream. CLI agents run with no time limit,
 *   so this is how a run that will not finish gets ended.
 */
export async function generateHtml(prompt, providerId, modelId, onChunk, onStats, params, { signal } = {}) {
  return streamHtmlDocument(streamChat, {
    providerId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    appTitle: 'Prompt Gallery',
    onChunk,
    onStats,
    params,
    signal,
    agentBudgets: PROMPT_GALLERY_CHAT_AGENT_BUDGETS,
  });
}

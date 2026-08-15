// Generation service for SVG Benchmark
// Uses the unified model-providers layer for provider/model management
// Keeps backward compat exports for OpenRouter API key management

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { streamChat, streamChatCompletion } from '../../shared/services/model-providers.js';
import { modelSupportsVision } from '../../shared/services/model-vision.js';

export { getApiKey, saveApiKey, hasApiKey };
export { modelSupportsVision };

const SYSTEM_PROMPT = `You are an expert SVG artist. The user will give you a text description of an image they want as SVG.
You must respond with ONLY valid SVG markup. Output raw SVG only — no markdown, no code fences, no explanations.
The SVG must start with <svg and include a viewBox attribute.
Use clean, semantic SVG elements. Make the output visually accurate and polished.
Keep file size reasonable — prefer simple paths and shapes over overly complex geometry.`;

const SYSTEM_PROMPT_WITH_IMAGE = `You are an expert SVG artist. The user will give you a text description AND a reference image of the picture they want reproduced as SVG.
Recreate the reference image as closely as you can in SVG: match its composition, colours, shapes, and proportions.
You must respond with ONLY valid SVG markup. Output raw SVG only — no markdown, no code fences, no explanations.
The SVG must start with <svg and include a viewBox attribute.
Use clean, semantic SVG elements. Make the output visually accurate and polished.
Keep file size reasonable — prefer simple paths and shapes over overly complex geometry.`;


/**
 * Generate SVG through the unified provider system.
 * @param {string} prompt - User prompt
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Model ID
 * @param {Function} [onChunk] - Streaming callback
 */
export async function generateSvg(prompt, providerId, modelId, onChunk, { params, onStats } = {}) {
  return streamChat({
    providerId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    appTitle: 'SVG Benchmark',
    onChunk,
    params,
    onStats,
  });
}

const HEAL_SYSTEM = `You are an expert SVG artist fixing a malformed SVG.
You will receive the original prompt the SVG was made for, the current (broken) SVG markup, and the reason it is invalid.
Return ONLY a corrected, well-formed SVG document — raw SVG markup, no markdown, no code fences, no explanation.
The SVG must start with <svg and include a viewBox attribute. Preserve the intended artwork; only fix what makes it invalid.`;

/**
 * Ask the model to repair an invalid SVG. Streams accumulated text via onChunk.
 */
export async function healSvg(prompt, brokenSvg, reason, providerId, modelId, onChunk, { params, onStats } = {}) {
  const userPrompt = [
    prompt?.trim() ? `ORIGINAL PROMPT:\n${prompt.trim()}` : '',
    `CURRENT SVG (invalid):\n${brokenSvg}`,
    `WHY IT IS INVALID:\n${reason}`,
    'Return the complete corrected SVG.',
  ].filter(Boolean).join('\n\n');
  return streamChat({
    providerId,
    modelId,
    systemPrompt: HEAL_SYSTEM,
    userPrompt,
    appTitle: 'SVG Benchmark',
    onChunk,
    params,
    onStats,
  });
}

/**
 * Generate SVG from a text prompt AND a reference image, using a multimodal
 * message array. Requires a vision-capable model.
 * @param {string} prompt - User prompt
 * @param {string} imageUrl - Reference image as a data URL (or http(s) URL)
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Model ID
 * @param {Function} [onChunk] - Streaming callback (receives accumulated text)
 */
export async function generateSvgWithImage(prompt, imageUrl, providerId, modelId, onChunk) {
  const text = prompt?.trim()
    ? prompt
    : 'Reproduce the reference image as SVG as accurately as you can.';
  return streamChatCompletion({
    providerId,
    modelId,
    appTitle: 'SVG Benchmark',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_WITH_IMAGE },
      {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    onChunk: onChunk ? (accumulated) => onChunk(accumulated) : undefined,
  });
}

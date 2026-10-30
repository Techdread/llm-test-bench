// LLM generation service for Notebook Lab.
// Supports generateCell (prompt → cell source) and explainCell (cell → md).

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { getProvider, streamChat } from '../../shared/services/model-providers.js';
import {
  MAX_GENERATED_NOTEBOOK_CHARS,
  buildNotebookGenerationSystemPrompt,
  buildNotebookGenerationUserPrompt,
  parseGeneratedNotebook,
} from './notebookGeneration.js';
import { buildCellRepairPrompt, cellRepairDiagnostic } from './cellRepair.js';
import { unavailableKinds } from './edition.js';
import { cellSystemPrompt, cellUserPrompt } from './generationContext.js';

export { getApiKey, saveApiKey, hasApiKey };

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function openAiBaseUrlForProvider(provider) {
  if (!provider) return '';
  if (provider.type === 'lmstudio') return `${normalizeBaseUrl(provider.baseUrl)}/v1`;
  if (provider.type === 'openrouter') return 'https://openrouter.ai/api/v1';
  return normalizeBaseUrl(provider.baseUrl);
}

function buildActiveModelContext(providerId, modelId) {
  const provider = getProvider(providerId);
  if (!provider || !modelId) return '';

  const baseUrl = openAiBaseUrlForProvider(provider);
  const lines = [
    'Active Notebook Lab model selection:',
    `- providerName: ${provider.name || providerId}`,
    `- providerType: ${provider.type || 'unknown'}`,
    `- modelId: ${modelId}`,
  ];
  if (baseUrl) lines.push(`- openaiCompatibleBaseUrl: ${baseUrl}`);
  if (provider.type === 'lmstudio') {
    lines.push('- apiKeyPlaceholder: lm-studio');
  }

  return `\n\n${lines.join('\n')}\nWhen generating code that calls an LLM or an OpenAI-compatible chat completions API, use this exact modelId and endpoint. Do not substitute a default, example, fallback, or Hugging Face model name.`;
}


// Hard ceiling on streamed generation size. Flaky models (free-tier ones
// especially) can degenerate into an endless token loop; without a cap the
// stream grows unbounded and the per-chunk re-render eventually hangs the
// tab until Chrome kills the renderer. No sane cell needs more than this.
const MAX_GEN_CHARS = 120000;

function guardRunaway(partial) {
  if (partial.length > MAX_GEN_CHARS) {
    throw new Error(`model output exceeded ${Math.round(MAX_GEN_CHARS / 1000)}k characters — stopped what looks like a runaway generation loop. Partial output was kept; try again or switch model.`);
  }
}

export function stripFences(text) {
  if (!text) return '';
  const t = text.trim();
  const fence = t.match(/^```(?:\w+)?\n([\s\S]*?)\n```\s*$/);
  if (fence) return fence[1];
  return t;
}

/**
 * Generate a cell source given a prompt.
 * @param {{kind:string, prompt:string, contextCells?:Array, providerId:string, modelId:string, searchContext?:string, onChunk?:Function}} opts
 * @returns {Promise<string>}
 */
export async function generateCell({ kind, prompt, contextCells, variables, currentSource, providerId, modelId, searchContext, onChunk }) {
  const systemPrompt = `${cellSystemPrompt(kind)}${buildActiveModelContext(providerId, modelId)}`;
  const userPrompt = cellUserPrompt({ prompt, contextCells, variables, searchContext, currentSource });
  let full = '';
  await streamChat({
    providerId,
    modelId,
    systemPrompt,
    userPrompt,
    appTitle: 'Notebook Lab',
    onChunk: (partial) => {
      guardRunaway(partial);
      full = partial;
      if (onChunk) onChunk(stripFences(partial));
    },
  });
  return stripFences(full);
}

/**
 * Produce a complete replacement for a cell from its captured runtime error.
 * The normal kind contract is retained so every supported cell type gets the
 * same output validation/cleanup as ordinary AI generation.
 */
export async function repairCell({ cell, contextCells, variables, providerId, modelId, onChunk }) {
  if (!cellRepairDiagnostic(cell)) throw new Error('Run the cell first so there is an error to repair');
  return generateCell({
    kind: cell.kind,
    prompt: buildCellRepairPrompt(cell),
    contextCells,
    variables,
    providerId,
    modelId,
    onChunk,
  });
}

/**
 * Generate and validate a complete multi-cell notebook draft.
 * The editor is not mutated until the caller explicitly applies the draft.
 */
export async function generateNotebookDraft({
  prompt,
  mode = 'create',
  currentNotebook,
  languages = [],
  visualOutput = 'auto',
  providerId,
  modelId,
  searchContext,
  variables,
  onChunk,
}) {
  const unavailable = [...unavailableKinds()];
  const systemPrompt = `${buildNotebookGenerationSystemPrompt({ unavailable })}${buildActiveModelContext(providerId, modelId)}`;
  const userPrompt = buildNotebookGenerationUserPrompt({
    prompt, mode, currentNotebook, searchContext, languages, visualOutput, variables,
  });
  let full = '';
  await streamChat({
    providerId,
    modelId,
    systemPrompt,
    userPrompt,
    appTitle: 'Notebook Lab — Notebook Generator',
    onChunk: (partial) => {
      if (partial.length > MAX_GENERATED_NOTEBOOK_CHARS) {
        throw new Error(`model output exceeded the ${Math.round(MAX_GENERATED_NOTEBOOK_CHARS / 1000)}k character notebook limit`);
      }
      full = partial;
      onChunk?.(partial);
    },
  });
  return parseGeneratedNotebook(full, { languages, visualOutput, unavailable });
}

/**
 * Explain an existing cell. Returns Markdown suitable for a follow-up md cell.
 */
export async function explainCell({ cell, providerId, modelId, onChunk }) {
  const systemPrompt = 'You are a helpful notebook assistant. Explain the given cell to the user in clear Markdown. Be concise (2–4 short paragraphs) and highlight what it does, any assumptions, and interesting edge cases. Return Markdown only.';
  const userPrompt = `Cell kind: ${cell.kind}\n\nSource:\n\n\`\`\`\n${cell.source}\n\`\`\`\n${cell.lastOutputText ? `\nOutput:\n\`\`\`\n${cell.lastOutputText.slice(0, 800)}\n\`\`\`` : ''}`;
  let full = '';
  await streamChat({
    providerId,
    modelId,
    systemPrompt,
    userPrompt,
    appTitle: 'Notebook Lab',
    onChunk: (partial) => {
      guardRunaway(partial);
      full = partial;
      if (onChunk) onChunk(partial);
    },
  });
  return full;
}

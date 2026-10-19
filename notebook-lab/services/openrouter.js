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

export { getApiKey, saveApiKey, hasApiKey };

const KIND_GUIDANCE = {
  md: 'Respond with Markdown only. No code fences around the outer Markdown.',
  js: 'Respond with a single JavaScript snippet. Use top-level await if needed. You may call `nb.set(key, value)` and `nb.get(key)` to share values between cells. Use `console.log` for output.',
  py: 'Respond with a single Python snippet runnable in Pyodide. matplotlib/numpy are available via `await micropip.install("numpy")` style setup only if needed (numpy/matplotlib are preloaded). Use `nb["key"] = value` / `nb["key"]` to share values with other cells. Print results you want to see.',
  c: 'Respond with a complete single-file C program with a main() function. Use printf/puts for output. Keep it compatible with a small browser C interpreter and use only common standard headers such as stdio.h, stdlib.h, string.h, and math.h. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  rust: 'Respond with a complete single-file Rust program with fn main(). Use println! for output and only the Rust standard library. This runs through remote Rust Playground execution. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  lua: 'Respond with a complete single-file Lua 5.4 program. Use print for output. It runs offline via the Wasmoon WebAssembly runtime (standard Lua only — no LuaJIT, no external rocks). To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  java: 'Respond with a complete single-file Java program: one public class containing `public static void main(String[] args)`. It compiles with real OpenJDK (javac) and runs in a Debian VM. Use System.out.println for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  go: 'Respond with a complete single-file Go program in `package main` with `func main()`. It builds with the real Go toolchain in a Debian VM (standard library only, no external modules). Use the fmt package for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  scala: 'Respond with a complete single-file Scala 2.11-compatible program with `object Main { def main(args: Array[String]): Unit = ... }` or `object Main extends App`. It runs with real scalac in the browser-hosted Debian VM. Use println for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  clojure: 'Respond with a complete single-file Clojure program (Clojure 1.11, core library only — no deps.edn/Leiningen). It runs on the JVM in a Debian VM. Use (println ...) for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  html: 'Respond with a complete HTML fragment that will render inside a sandboxed iframe. Inline all CSS/JS. Do not include <html> or <head> tags.',
  ui: 'Respond with a single JSON object for a Notebook Lab UI cell. Shape: {"title":"...","description":"...","controls":[...]}. Supported control types: label, text, textarea, number, checkbox, select, radio, slider, color, date, button. Bind input controls with a "bind" key so they write to notebook variables. Include defaults for bound inputs. Select/radio options may be strings or {"label","value"} objects. No commentary, no code fences.',
  chart: 'Respond with a single Vega-Lite JSON spec (starting with `{`). No commentary, no code fences.',
};

function systemPromptForKind(kind) {
  const base = 'You are an expert notebook assistant. Return ONLY the cell contents, with no prose, no commentary, and no markdown code fences around the whole output.';
  return `${base}\n\nCell kind: ${kind}\n${KIND_GUIDANCE[kind] || ''}`;
}

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

function buildContext(contextCells = []) {
  if (!contextCells.length) return '';
  const trimmed = contextCells.slice(-4).map((c, i) => {
    const src = (c.source || '').slice(0, 600);
    const out = (c.lastOutputText || '').slice(0, 300);
    return `### Prior cell ${i + 1} [${c.kind}]\n${src}${out ? `\nOutput:\n${out}` : ''}`;
  }).join('\n\n');
  return `\n\nPrior notebook context (truncated):\n${trimmed}\n`;
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
export async function generateCell({ kind, prompt, contextCells, providerId, modelId, searchContext, onChunk }) {
  const systemPrompt = `${systemPromptForKind(kind)}${buildActiveModelContext(providerId, modelId)}`;
  const searchBlock = searchContext ? `\n\n${searchContext}\n` : '';
  const userPrompt = `${buildContext(contextCells)}${searchBlock}\nTask: ${prompt}`;
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
export async function repairCell({ cell, contextCells, providerId, modelId, onChunk }) {
  if (!cellRepairDiagnostic(cell)) throw new Error('Run the cell first so there is an error to repair');
  return generateCell({
    kind: cell.kind,
    prompt: buildCellRepairPrompt(cell),
    contextCells,
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
  onChunk,
}) {
  const unavailable = [...unavailableKinds()];
  const systemPrompt = `${buildNotebookGenerationSystemPrompt({ unavailable })}${buildActiveModelContext(providerId, modelId)}`;
  const userPrompt = buildNotebookGenerationUserPrompt({
    prompt, mode, currentNotebook, searchContext, languages, visualOutput,
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

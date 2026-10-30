// Pure helpers for whole-notebook AI generation.

import { hashSource } from './cellMetadata.js';
import {
  C_GUIDE,
  HTML_NB_BRIDGE_GUIDE,
  JS_RETURN_GUIDE,
  LUA_NB_GUIDE,
  SQL_GUIDE,
  UI_CONTROL_GUIDE,
  describeNotebookVariables,
} from './generationContext.js';

export const SUPPORTED_NOTEBOOK_KINDS = new Set([
  'md', 'js', 'py', 'c', 'rust', 'lua', 'sql', 'java', 'go', 'scala', 'clojure', 'html', 'ui', 'chart',
]);

export const NOTEBOOK_LANGUAGE_KINDS = Object.freeze([
  'py', 'js', 'html', 'c', 'rust', 'lua', 'sql', 'java', 'go', 'scala', 'clojure',
]);

export const NOTEBOOK_VISUAL_OUTPUTS = Object.freeze([
  'auto', 'none', 'chart', 'plot', 'interactive', 'network',
]);

export const MAX_GENERATED_CELLS = 40;
export const MAX_GENERATED_NOTEBOOK_CHARS = 300000;

export function buildNotebookResearchQuery(prompt, maxLength = 320) {
  const cleaned = String(prompt || '')
    .replace(/\bsearch (?:the )?web (?:for|and)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) throw new Error('A notebook prompt is required for web research');
  const bounded = cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
  return `${bounded} authoritative data source`;
}

function stripOuterFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : trimmed;
}

function firstJsonObject(text) {
  const source = stripOuterFence(text);
  try { return JSON.parse(source); } catch { /* find an object inside surrounding prose */ }

  const start = source.indexOf('{');
  if (start < 0) throw new Error('Model response did not contain a JSON object');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)); }
        catch (error) { throw new Error(`Model returned malformed notebook JSON: ${error.message}`); }
      }
    }
  }
  throw new Error('Model response contained an incomplete JSON object');
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateJsonCell(kind, source, index) {
  if (kind !== 'chart' && kind !== 'ui') return;
  let parsed;
  try { parsed = JSON.parse(source); }
  catch (error) { throw new Error(`Cell ${index + 1} [${kind}] is not valid JSON: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cell ${index + 1} [${kind}] must contain one JSON object`);
  }
  if (kind === 'chart' && !parsed.mark && !parsed.layer && !parsed.hconcat && !parsed.vconcat && !parsed.concat) {
    throw new Error(`Cell ${index + 1} [chart] is not recognisable as a Vega-Lite specification`);
  }
  if (kind === 'ui' && !Array.isArray(parsed.controls)) {
    throw new Error(`Cell ${index + 1} [ui] needs a controls array`);
  }
}

export function normalizeNotebookGenerationConstraints({ languages = [], visualOutput = 'auto' } = {}) {
  const allowedLanguages = new Set(NOTEBOOK_LANGUAGE_KINDS);
  const normalizedLanguages = [...new Set(
    (Array.isArray(languages) ? languages : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => allowedLanguages.has(value)),
  )];
  const normalizedVisual = NOTEBOOK_VISUAL_OUTPUTS.includes(visualOutput) ? visualOutput : 'auto';
  return { languages: normalizedLanguages, visualOutput: normalizedVisual };
}

function visualEvidence(cells) {
  const evidence = { chart: false, plot: false, interactive: false, network: false };
  for (const cell of cells) {
    const source = String(cell.source || '');
    const lower = source.toLowerCase();
    const isVega = cell.kind === 'chart'
      || (cell.kind === 'js' && /vega(?:-lite)?|\$schema[\s\S]*vega-lite|\bmark\s*:/.test(lower));
    const isPlot = cell.kind === 'py' && /matplotlib|\bplt\s*\.|\.plot\s*\(/i.test(source);
    const isInteractive = cell.kind === 'html'
      && /<canvas\b|<svg\b|\bd3\.|plotly|three\.|addEventListener|nb\.onChange/i.test(source);
    const isNetwork = (cell.kind === 'chart' || cell.kind === 'html' || cell.kind === 'js' || cell.kind === 'py')
      && /force(?:-directed|Simulation)|network\s+(?:graph|diagram)|\bnodes?\b[\s\S]{0,240}\bedges?\b/i.test(source);
    evidence.chart ||= isVega;
    evidence.plot ||= isPlot;
    evidence.interactive ||= isInteractive;
    evidence.network ||= isNetwork;
  }
  return evidence;
}

/** Enforce the user's language and output choices after model generation. */
export function validateNotebookGenerationConstraints(cells, constraints = {}) {
  const normalized = normalizeNotebookGenerationConstraints(constraints);
  const { languages, visualOutput } = normalized;

  if (languages.length) {
    // Markdown, Controls, and Vega-Lite are support cells rather than
    // programming-language choices. Output modes may add their required
    // renderer so useful combinations such as Python + Interactive HTML work.
    const allowedKinds = new Set(['md', 'ui', 'chart', ...languages]);
    if (visualOutput === 'plot') allowedKinds.add('py');
    if (visualOutput === 'chart' || visualOutput === 'network') allowedKinds.add('js');
    if (visualOutput === 'interactive' || visualOutput === 'network') allowedKinds.add('html');
    const disallowed = [...new Set(cells.map(cell => cell.kind).filter(kind => !allowedKinds.has(kind)))];
    if (disallowed.length) {
      throw new Error(`Generated notebook used cell types outside the selected languages: ${disallowed.join(', ')}`);
    }
  }

  const evidence = visualEvidence(cells);
  if (visualOutput === 'none' && (evidence.chart || evidence.plot || evidence.interactive || evidence.network)) {
    throw new Error('Generated notebook included a visual output even though “No visual output” was selected');
  }
  if (visualOutput === 'chart' && !evidence.chart) {
    throw new Error('Generated notebook did not include the requested Vega-Lite chart output');
  }
  if (visualOutput === 'plot' && !evidence.plot) {
    throw new Error('Generated notebook did not include the requested Python/Matplotlib plot output');
  }
  if (visualOutput === 'interactive' && !evidence.interactive) {
    throw new Error('Generated notebook did not include the requested interactive HTML visual output');
  }
  if (visualOutput === 'network' && !evidence.network) {
    throw new Error('Generated notebook did not include the requested network graph output');
  }
  return normalized;
}

export function parseGeneratedNotebook(text, constraints = {}) {
  const rawText = String(text || '');
  if (rawText.length > MAX_GENERATED_NOTEBOOK_CHARS) {
    throw new Error(`Generated notebook exceeds the ${Math.round(MAX_GENERATED_NOTEBOOK_CHARS / 1000)}k character safety limit`);
  }
  const payload = firstJsonObject(rawText);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Generated notebook must be a JSON object');
  }
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Generated notebook needs a title');
  if (!Array.isArray(payload.cells) || payload.cells.length < 2) {
    throw new Error('Generated notebook needs at least two cells');
  }
  if (payload.cells.length > MAX_GENERATED_CELLS) {
    throw new Error(`Generated notebook has ${payload.cells.length} cells; the limit is ${MAX_GENERATED_CELLS}`);
  }

  const cells = payload.cells.map((cell, index) => {
    if (!cell || typeof cell !== 'object') throw new Error(`Cell ${index + 1} must be an object`);
    const kind = String(cell.kind || '').trim().toLowerCase();
    if (!SUPPORTED_NOTEBOOK_KINDS.has(kind)) {
      throw new Error(`Cell ${index + 1} uses unsupported kind "${kind || '(missing)'}"`);
    }
    if ((constraints.unavailable || []).includes(kind)) {
      throw new Error(`Cell ${index + 1} uses ${kind}, which this edition cannot run`);
    }
    if (typeof cell.source !== 'string' || !cell.source.trim()) {
      throw new Error(`Cell ${index + 1} [${kind}] needs non-empty source text`);
    }
    validateJsonCell(kind, cell.source, index);
    return {
      kind,
      title: String(cell.title || `${kind.toUpperCase()} cell ${index + 1}`).trim(),
      source: cell.source,
    };
  });

  const sources = (Array.isArray(payload.sources) ? payload.sources : [])
    .filter(source => source && typeof source === 'object' && validHttpUrl(source.url))
    .map(source => ({
      title: String(source.title || source.url).trim(),
      url: String(source.url).trim(),
      note: String(source.note || '').trim(),
      retrievedAt: String(source.retrievedAt || '').trim(),
    }));

  const warnings = [];
  if (!cells.some(cell => cell.kind === 'md')) warnings.push('No Markdown explanation cells were generated.');
  if (cells[0].kind !== 'md') warnings.push('The first cell is not a Markdown introduction.');
  if (!sources.length) warnings.push('The model did not provide a structured source list.');

  const normalizedConstraints = validateNotebookGenerationConstraints(cells, constraints);

  return {
    title,
    summary: String(payload.summary || '').trim(),
    cells,
    sources,
    warnings,
    constraints: normalizedConstraints,
  };
}

function notebookContext(currentNotebook) {
  if (!currentNotebook?.cells?.length) return '';
  const cells = currentNotebook.cells.slice(-12).map((cell, index) => {
    const source = String(cell.source || '').slice(0, 1400);
    return `CURRENT CELL ${index + 1} [${cell.kind}]\n${source}`;
  }).join('\n\n');
  return `\n\nCURRENT NOTEBOOK\nTitle: ${currentNotebook.title || 'Untitled'}\n${cells}`;
}

// Compiled languages that can publish to nb but not read it. C (xcc) and Lua
// run in the page and read nb too, so they have their own rules.
const COMPILED_KIND_LABELS = { rust: 'Rust', java: 'Java', go: 'Go', scala: 'Scala', clojure: 'Clojure' };

// `unavailable` lists cell kinds this edition cannot run (the public web
// edition passes services/edition.js's list); they are left out of the schema
// and named as forbidden.
export function buildNotebookGenerationSystemPrompt({ unavailable = [] } = {}) {
  const blocked = new Set(unavailable);
  const kinds = [...SUPPORTED_NOTEBOOK_KINDS].filter(kind => !blocked.has(kind));
  const compiled = Object.keys(COMPILED_KIND_LABELS).filter(kind => !blocked.has(kind)).map(kind => COMPILED_KIND_LABELS[kind]);
  // One rule per language family, skipping any this edition cannot run.
  const languageRules = [
    compiled.length && `- ${compiled.join('/')} cells are complete executable programs. They can publish data by printing __NB_SET__ {"key":"name","value":...} but cannot read notebook state.`,
    !blocked.has('c') && `- C cells are complete single-file programs with main(). ${C_GUIDE}`,
    !blocked.has('lua') && `- Lua cells are complete Lua 5.4 programs. ${LUA_NB_GUIDE}`,
    `- Use SQL cells to filter, join, group and rank data that earlier cells put in nb. ${SQL_GUIDE}`,
  ].filter(Boolean).join('\n');
  const unavailableRule = blocked.size
    ? `\n- This edition cannot run ${[...blocked].join(', ')} cells. Never emit those kinds.`
    : '';
  return `You are an expert scientific notebook author. Build a coherent, runnable, multi-cell Notebook Lab notebook from one request.

Return ONLY one strict JSON object. Do not wrap it in Markdown fences and do not add commentary outside the JSON.

Required schema:
{
  "title": "Concise notebook title",
  "summary": "One sentence describing the learning journey",
  "sources": [
    { "title": "Source title", "url": "https://...", "retrievedAt": "YYYY-MM-DD", "note": "What this source supports" }
  ],
  "cells": [
    { "kind": "${kinds.join('|')}", "title": "Plan label", "source": "Complete cell source" }
  ]
}

Notebook design rules:
- Produce 3–16 purposeful cells in a runnable teaching sequence. Start with a Markdown overview and finish with interpretation, conclusions, or exercises.
- Use Markdown cells for explanations and citations. Cite supplied web sources with normal Markdown links; never invent a citation or claim a URL was inspected when it was not supplied.
- Use Python for data cleaning, statistics, numerical work, and scientific calculations. NumPy, pandas, and matplotlib are available in Pyodide. Share JSON-serialisable results with nb["key"] = value and read prior values with nb.get("key", default).
- Use JavaScript for browser APIs (including fetch), post-processing, and data-driven Vega-Lite. Read shared values with nb.get("key"), write with nb.set("key", value), use top-level await freely, and RETURN a Vega-Lite object to render it interactively. ${JS_RETURN_GUIDE}
- Prefer a JavaScript cell that returns a Vega-Lite spec when chart data comes from Python or another earlier cell. A chart cell is static strict Vega-Lite JSON and cannot read notebook variables.
- Vega-Lite visualisations should include meaningful axis titles, tooltips, legends, responsive width where practical, and selections/parameters when the request asks for interactivity.
- In a layered Vega-Lite spec, define selection params on exactly one unit layer (normally the interactive point/bar layer), not on the outer layered spec. Sibling layers may still reference the named selection. This prevents duplicate compiled Vega signals.
- HTML cells are complete fragments rendered in a sandboxed iframe. Inline CSS and JavaScript, omit html/head wrappers, and do not reference repository-relative files. ${HTML_NB_BRIDGE_GUIDE}
- UI cells contain one strict JSON object with title, description, and a controls array. Controls may be label, text, textarea, number, checkbox, select, radio, slider, color, date, or button. Bind each input with "bind": "key" and give it a "default"; later cells read the value with nb.get / nb["key"]. ${UI_CONTROL_GUIDE}
- To make a notebook interactive, put a UI cell before the cells that use its values; an HTML cell that redraws from nb.onChange updates live as the controls move, while code cells use the new values when they are run again.
${languageRules}
- Make every source string complete and executable. JSON-escape newlines, quotes, and backslashes correctly.
- When live network data may fail because of CORS or availability, explain that limitation and include a small attributed fallback sample so the notebook remains demonstrable.
- Clearly separate retrieved facts, assumptions, and calculated results. Do not fabricate outputs that have not been computed.${unavailableRule}`;
}

export function buildNotebookGenerationUserPrompt({
  prompt,
  mode = 'create',
  currentNotebook,
  searchContext = '',
  languages = [],
  visualOutput = 'auto',
  variables,
} = {}) {
  const request = String(prompt || '').trim();
  if (!request) throw new Error('A notebook prompt is required');
  const modeInstruction = mode === 'append'
    ? 'Extend the current notebook with new cells. Avoid repeating its existing introduction; make the new cells continue its data flow.'
    : 'Create a new self-contained notebook.';
  const research = String(searchContext || '').trim();
  const constraints = normalizeNotebookGenerationConstraints({ languages, visualOutput });
  const languageInstruction = constraints.languages.length
    ? `Allowed programming-language cell kinds: ${constraints.languages.join(', ')}. Do not emit other programming-language kinds. Markdown, UI Controls, and Vega-Lite chart support cells remain allowed.`
    : 'Programming languages: Auto. Choose the smallest useful mix for the task.';
  const visualInstructions = {
    auto: 'Visual output: Auto. Include one only when it materially improves the notebook.',
    none: 'Visual output: None. Do not produce charts, plots, network diagrams, canvas/SVG visuals, or other graphical output.',
    chart: 'Visual output: REQUIRED Vega-Lite chart. Include a chart cell or a JavaScript cell that returns a valid Vega-Lite specification.',
    plot: 'Visual output: REQUIRED Python/Matplotlib plot. Include a Python cell that imports matplotlib and creates a meaningful plot.',
    interactive: 'Visual output: REQUIRED interactive HTML visual. Include an HTML cell with a real SVG/canvas or other interactive visual and working interactions.',
    network: 'Visual output: REQUIRED network graph. Include a node/edge network visual, preferably interactive, with clear labels or tooltips.',
  };
  const rendererExceptions = {
    auto: '',
    none: '',
    chart: ' JavaScript is permitted as an output renderer when a dynamic chart must read notebook state.',
    plot: ' Python is permitted as the required plot renderer even when it was not selected separately.',
    interactive: ' HTML is permitted as the required visual renderer even when it was not selected separately.',
    network: ' HTML or JavaScript is permitted as the required network renderer even when not selected separately.',
  };
  const constraintBlock = `\n\nGENERATION CONSTRAINTS\n- ${languageInstruction}\n- ${visualInstructions[constraints.visualOutput]}${rendererExceptions[constraints.visualOutput]}`;
  // Only an append builds on the open notebook's nb values; a new notebook starts empty.
  const variablesText = mode === 'append' ? describeNotebookVariables(variables) : '';
  const variablesBlock = variablesText ? `\n\n${variablesText}` : '';
  return `${modeInstruction}${notebookContext(mode === 'append' ? currentNotebook : null)}${variablesBlock}${research ? `\n\nWEB RESEARCH SUPPLIED TO YOU\n${research}` : ''}${constraintBlock}\n\nUSER REQUEST\n${request}`;
}

export function materializeGeneratedNotebook(draft, {
  mode = 'create',
  currentNotebook = null,
  notebookId,
  cellId,
  prompt,
  providerId,
  modelId,
  useWebSearch = false,
  backend = 'model',
  runId = '',
  researchSources = [],
  languages = [],
  visualOutput = 'auto',
  now = new Date().toISOString(),
  generationId = `notebook-gen-${Date.now().toString(36)}`,
} = {}) {
  if (!draft?.cells?.length) throw new Error('A generated notebook draft is required');
  if (typeof cellId !== 'function') throw new Error('cellId factory is required');
  if (mode === 'create' && typeof notebookId !== 'function') throw new Error('notebookId factory is required');
  if (mode === 'append' && !currentNotebook) throw new Error('Current notebook is required when appending');

  const constraints = normalizeNotebookGenerationConstraints({ languages, visualOutput });
  const generation = {
    id: generationId,
    prompt: String(prompt || ''),
    providerId: String(providerId || ''),
    modelId: String(modelId || ''),
    backend,
    ...(runId ? { runId } : {}),
    useWebSearch: !!useWebSearch,
    generatedAt: now,
    summary: draft.summary || '',
    sources: draft.sources || [],
    researchSources: Array.isArray(researchSources) ? researchSources : [],
    constraints,
  };
  const cells = draft.cells.map(cell => ({
    id: cellId(),
    kind: cell.kind,
    source: cell.source,
    outputs: null,
    error: null,
    lastOutputText: '',
    metadata: {
      ai: {
        prompt: String(prompt || ''),
        kind: cell.kind,
        providerId: String(providerId || ''),
        modelId: String(modelId || ''),
        backend,
        ...(runId ? { runId } : {}),
        useWebSearch: !!useWebSearch,
        createdAt: now,
        updatedAt: now,
        generatedSourceHash: hashSource(cell.source),
        notebookGenerationId: generationId,
      },
    },
  }));

  const priorGenerations = Array.isArray(currentNotebook?.metadata?.aiNotebookGenerations)
    ? currentNotebook.metadata.aiNotebookGenerations
    : [];
  if (mode === 'append') {
    return {
      ...currentNotebook,
      cells: [...currentNotebook.cells, ...cells],
      updatedAt: now,
      metadata: {
        ...(currentNotebook.metadata || {}),
        aiNotebookGenerations: [...priorGenerations, generation],
      },
    };
  }
  return {
    id: notebookId(),
    title: draft.title,
    state: {},
    cells,
    createdAt: now,
    updatedAt: now,
    metadata: { aiNotebookGenerations: [generation] },
  };
}

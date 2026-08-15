// AI suggestions for the Save dialog: title, description and tags derived
// from the prompt + sketch source. Mirrors the Prompt Gallery save-dialog
// helpers, but the context here is a p5 sketch (code + params).

import { completeChat, chatCompletion } from '../../../shared/services/model-providers.js';

const APP_TITLE = 'p5 Sketch Gallery';

const TITLE_SYSTEM = `You generate short, kebab-case titles for saved p5.js sketches.
Output ONLY the title. No quotes, no explanation, no trailing punctuation.
Rules: lowercase, words separated by single hyphens, 2-4 words, no file extension, ASCII only, no leading/trailing hyphens.
Describe what the sketch draws, not that it is a sketch (good: flocking-arrows, wind-tunnel-wing).`;

const NOTES_SYSTEM = `You write a short description of a p5.js sketch for its author.
Output ONLY the description: 1-2 sentences, max 240 characters, plain prose, no markdown, no quotes.
Say what it draws and what the interesting parameters do. Be specific to this sketch, not generic creative-coding talk.`;

const TAGS_SYSTEM = `You generate concise tags for a saved p5.js sketch.
Output ONLY a comma-separated list of 3-6 lowercase tags. No quotes, no explanation, no trailing punctuation.
Tags should describe subject, technique, motion or visual style (e.g. flocking, particles, noise-field, monochrome, physics).`;

export function sanitizeTitle(text) {
  if (!text) return '';
  const line = String(text).split('\n').map(l => l.trim()).find(Boolean) || '';
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function sanitizeNotes(text) {
  if (!text) return '';
  return String(text)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 400)
    .trim();
}

export function sanitizeTags(text) {
  if (!text) return '';
  const line = String(text).split('\n').map(l => l.trim()).find(Boolean) || '';
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .split(',')
    .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
}

// Compact context for the model: prompt, params, and a truncated source.
export function buildSketchContext({ prompt, code, params } = {}) {
  const promptStr = (prompt || '').trim().slice(0, 1200);
  const codeStr = (code || '').trim().slice(0, 3000);
  const paramsStr = params && Object.keys(params).length
    ? JSON.stringify(params, null, 2).slice(0, 600)
    : '';
  if (!promptStr && !codeStr) return '';
  return [
    promptStr ? `PROMPT:\n${promptStr}` : '',
    paramsStr ? `PARAMS:\n${paramsStr}` : '',
    codeStr ? 'SKETCH SOURCE (truncated):\n```javascript\n' + codeStr + '\n```' : '',
  ].filter(Boolean).join('\n\n');
}

const SYSTEMS = {
  title: TITLE_SYSTEM,
  notes: NOTES_SYSTEM,
  tags: TAGS_SYSTEM,
};

const SANITIZERS = {
  title: sanitizeTitle,
  notes: sanitizeNotes,
  tags: sanitizeTags,
};

// Thinking models (qwen3.x, gemma-4, …) routinely answer a short "output only
// X" prompt entirely inside reasoning_content and leave content empty, which
// the shared adapters drop. Re-ask through the raw endpoint and take the final
// line of the reasoning — that is where such models land the actual answer.
async function reasoningFallback({ providerId, modelId, systemPrompt, userPrompt }) {
  const body = await chatCompletion({
    providerId,
    modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    appTitle: APP_TITLE,
  });
  const msg = body?.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning_content || '';
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// field: 'title' | 'notes' | 'tags'
export async function suggestField({ field, providerId, modelId, prompt, code, params }) {
  const systemPrompt = SYSTEMS[field];
  if (!systemPrompt) throw new Error(`Unknown suggestion field: ${field}`);
  const userPrompt = buildSketchContext({ prompt, code, params });
  if (!userPrompt) throw new Error('Need a prompt or sketch source to suggest from');

  const out = await completeChat({
    providerId,
    modelId,
    systemPrompt,
    userPrompt,
    appTitle: APP_TITLE,
  });
  const cleaned = SANITIZERS[field](out);
  if (cleaned) return cleaned;

  try {
    return SANITIZERS[field](await reasoningFallback({ providerId, modelId, systemPrompt, userPrompt }));
  } catch (e) {
    // Provider has no raw endpoint (or it failed) — treat as "no suggestion".
    return '';
  }
}

// Runs the requested fields in parallel; never rejects — each entry is
// { field, value } on success or { field, error } on failure.
export async function suggestAll({ fields, providerId, modelId, prompt, code, params }) {
  const wanted = fields?.length ? fields : ['title', 'notes', 'tags'];
  return Promise.all(wanted.map(async (field) => {
    try {
      return { field, value: await suggestField({ field, providerId, modelId, prompt, code, params }) };
    } catch (e) {
      return { field, error: e.message || String(e) };
    }
  }));
}

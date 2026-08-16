// Shared prompt-ideation service.
//
// Two flows, used by every app that has an LLM-driven prompt entry:
//   - brainstormPrompts({ theme }) — fresh ideas, optional theme nudge
//   - nearbyPrompts({ prompt }) — variations of an existing prompt, "more like this"
//
// Each flow takes a `domain` so the system prompt is tuned to the host app
// (e.g. "p5.js sketch", "SVG illustration"). The output contract is the same
// across domains: a JSON array of strings, one prompt each.

import { streamChat } from './model-providers.js';

function brainstormSystem(domain) {
  return `You generate fresh ${domain || 'creative-coding sketch'} prompt ideas for a given theme.
Each idea must be a single concrete sentence describing one specific output: what's on screen, how it moves or composes, and any notable parameters or palette cues.
Avoid abstract phrases like "explore generative art" — be specific about subjects, shapes, colour, motion, and style.
Output ONLY a JSON array of 10 strings. No prose, no markdown, no code fences. Keep each under 140 characters.`;
}

function nearbySystem(domain) {
  return `You suggest 6 short ${domain || 'creative-coding sketch'} prompt variations in the same artistic family as the user's prompt.
They should explore neighbouring ideas — different motion, palette, density, structure, mood — not paraphrases.
Output ONLY a JSON array of strings. No prose, no markdown, no code fences. Keep each under 120 characters.`;
}

export async function brainstormPrompts({
  theme,
  domain,
  providerId,
  modelId,
  appTitle,
  onChunk,
}) {
  const userPrompt = theme?.trim()
    ? `Theme: ${theme.trim()}`
    : 'Theme: surprise me — pick an unusual creative direction.';
  return streamChat({
    providerId,
    modelId,
    systemPrompt: brainstormSystem(domain),
    userPrompt,
    appTitle: appTitle || 'Prompt Brainstorm',
    onChunk,
  });
}

export async function nearbyPrompts({
  prompt,
  domain,
  providerId,
  modelId,
  appTitle,
  onChunk,
}) {
  return streamChat({
    providerId,
    modelId,
    systemPrompt: nearbySystem(domain),
    userPrompt: prompt || '',
    appTitle: appTitle || 'Prompt Brainstorm',
    onChunk,
  });
}

// Best-effort JSON-array parsing for streamed model output. Accepts arrays
// inside fenced blocks, leading prose, or partial chunks.
export function safeParseJsonArray(text) {
  if (!text) return [];
  let s = String(text).trim();
  s = s.replace(/^\s*```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  // Try the cleaned string directly first.
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
  } catch (e) { /* fall through */ }
  // Try a substring between the first [ and last ].
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch (e) {}
  }
  return [];
}

export function safeParseStringArray(text) {
  return safeParseJsonArray(text)
    .filter(x => typeof x === 'string' && x.trim())
    .map(s => s.trim());
}

// Per-app LLM wrapper. Re-exports the shared provider-level helpers so the
// toolbar can manage the API key + model; `pickVisualisation` asks the model
// to classify the algorithm kind and map variables to visualisation channels.

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { streamChat } from '../../shared/services/model-providers.js';

export { getApiKey, saveApiKey, hasApiKey };

const APP_TITLE = 'Algorithm Visualizer';

const SYSTEM_PROMPT = `You categorise small algorithm snippets for a visualiser.

Respond with a single JSON object, nothing else — no prose, no code fences.

Schema:
{
  "kind": "array" | "graph" | "tree" | "grid",
  "mapping": {
    // names vary per kind; include only ones you're confident about
    "array": "<var name holding the primary array>",
    "cursors": ["<index var>", "..."],
    "adjacency": "<var holding graph adjacency>",
    "frontier": "<queue/stack/open-set var>",
    "visited": "<visited set/list var>",
    "distances": "<distance map var>",
    "root": "<tree root var>",
    "table": "<2D DP or grid table var>",
    "cursor": "<position var {x,y}>"
  },
  "presetArgs": {}  // optional small object with any hints
}

Rules:
- Use the variable names that actually appear in the source.
- "kind" is one of the four literals. Prefer "grid" for 2D DP tables.
- Leave fields out if the program doesn't have them. Never invent names.`;

/**
 * Ask the LLM to pick a visualisation kind + variable mapping.
 * Returns the parsed object or throws.
 */
export async function pickVisualisation({
  providerId,
  modelId,
  source,
  language,
  onChunk,
}) {
  const userPrompt = `Language: ${language}

Source:
\`\`\`
${source}
\`\`\`

Classify and map. JSON only.`;

  // Always stream — the LM Studio adapter switches to non-streaming mode
  // (with a short absolute timeout) if onChunk is falsy. Local models
  // routinely take longer than that to warm up, so we stream unconditionally
  // and simply discard intermediate chunks if the caller doesn't want them.
  const text = await streamChat({
    providerId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    onChunk: onChunk || (() => {}),
    appTitle: APP_TITLE,
  });
  return parseJsonResponse(text);
}

function parseJsonResponse(text) {
  if (!text) throw new Error('Empty response');
  let t = text.trim();
  // Strip code fences if present.
  t = t.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, '');
  // Model sometimes prefixes prose — grab the first {...} block.
  const m = t.match(/\{[\s\S]*\}/);
  if (m) t = m[0];
  try {
    const obj = JSON.parse(t);
    if (!obj.kind || !['array', 'graph', 'tree', 'grid'].includes(obj.kind)) {
      throw new Error(`Invalid kind: ${obj.kind}`);
    }
    if (!obj.mapping) obj.mapping = {};
    return obj;
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${err.message}. Raw: ${text.slice(0, 200)}`);
  }
}

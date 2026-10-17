// Simple heuristic fallback to classify a program without an LLM call.
// Use when no provider/key is configured or the model is unavailable.

import { pickVisualisation } from './openrouter.js';

const GRAPH_HINTS = /\b(adj|neighbor|neighbour|graph|visited|queue|stack|edges?)\b/i;
const TREE_HINTS  = /\b(root|left|right|children|parent|node)\b/i;
const GRID_HINTS  = /\b(dp|grid|maze|board|rows?|cols?|cells?)\b/i;
const ARRAY_HINTS = /\b(arr|array|nums?|list|sort|swap)\b/i;

export function detectHeuristic(source) {
  const text = source || '';
  const is2d = /\[\s*\[/.test(text) || /\[\[0\s*\]/.test(text) || /for .* for /.test(text);

  if (is2d && GRID_HINTS.test(text)) {
    return {
      kind: 'grid',
      mapping: {
        table: firstMatch(text, /(?:const|let|var)\s+(\w+)\s*=\s*\[\s*\[/)
            || firstMatch(text, /(\w+)\s*=\s*\[\s*\[/)
            || 'grid',
      },
      presetArgs: {},
    };
  }
  if (TREE_HINTS.test(text) && !GRAPH_HINTS.test(text)) {
    return { kind: 'tree', mapping: {}, presetArgs: {} };
  }
  if (GRAPH_HINTS.test(text)) {
    return {
      kind: 'graph',
      mapping: {
        adjacency: firstMatch(text, /(?:const|let|var)\s+(graph|adj\w*)\s*=/)
                || firstMatch(text, /(graph|adj\w*)\s*=/)
                || 'graph',
        frontier: firstMatch(text, /\b(queue|stack|open|frontier)\b/),
        visited:  firstMatch(text, /\b(visited|seen|closed)\b/),
      },
      presetArgs: {},
    };
  }
  // Default.
  return {
    kind: 'array',
    mapping: {
      array: firstMatch(text, /(?:const|let|var)\s+(arr|nums?|array|values|items)\b/)
          || firstMatch(text, /\b(arr|nums?|array|values|items)\b/)
          || 'arr',
      cursors: ['i', 'j'].filter(v => new RegExp('\\b' + v + '\\b').test(text)),
    },
    presetArgs: {},
  };
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

/**
 * High-level detect: try LLM if a provider/key is available, otherwise fall back
 * to the heuristic. Returns `{ kind, mapping, presetArgs, source: 'llm' | 'heuristic' | 'preset' }`.
 */
export async function detectKind({ source, language, providerId, modelId, useLLM, onChunk }) {
  if (useLLM && providerId && modelId) {
    try {
      const out = await pickVisualisation({ providerId, modelId, source, language, onChunk });
      return { ...out, source: 'llm' };
    } catch (err) {
      console.warn('LLM detect failed, falling back to heuristic:', err.message);
      return { ...detectHeuristic(source), source: 'heuristic', llmError: err.message };
    }
  }
  return { ...detectHeuristic(source), source: 'heuristic' };
}

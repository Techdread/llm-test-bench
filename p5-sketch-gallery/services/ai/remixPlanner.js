// Remix planning + prompt brainstorming for the p5 Sketch Gallery.
//
// proposeRemixes is sketch-specific (it cares about p5 params + code), so
// stays here. brainstormPrompts and nearbyPrompts are now generic and live
// in shared/services/prompt-brainstorm.js — we just re-export them with the
// gallery's app title and "p5.js sketch" domain pre-applied.

import { streamChat } from '../../../shared/services/model-providers.js';
import {
  brainstormPrompts as sharedBrainstorm,
  nearbyPrompts as sharedNearby,
  safeParseJsonArray as sharedParseJsonArray,
  safeParseStringArray as sharedParseStringArray,
} from '../../../shared/services/prompt-brainstorm.js';

const REMIX_SYSTEM = `You propose a JSON list of parameter remixes for a p5.js sketch.
Output ONLY a JSON array of objects, each shaped:
  { "name": "short label", "params": { "key": value, ... } }

Use only keys present in the supplied params object. Aim for 4 distinct presets that
push the sketch in interesting directions (sparser, denser, slower, larger, etc.).
Do not include prose or code fences — JSON only.`;

const APP_TITLE = 'p5 Sketch Gallery';
const DOMAIN = 'p5.js sketch';

export async function proposeRemixes({ code, params, providerId, modelId, onChunk }) {
  const userPrompt = `Current params: ${JSON.stringify(params || {}, null, 2)}\n\nSketch:\n\`\`\`javascript\n${code || ''}\n\`\`\``;
  return streamChat({
    providerId,
    modelId,
    systemPrompt: REMIX_SYSTEM,
    userPrompt,
    appTitle: APP_TITLE,
    onChunk,
  });
}

export async function nearbyPrompts({ prompt, providerId, modelId, onChunk }) {
  return sharedNearby({ prompt, domain: DOMAIN, appTitle: APP_TITLE, providerId, modelId, onChunk });
}

export async function brainstormPrompts({ theme, providerId, modelId, onChunk }) {
  return sharedBrainstorm({ theme, domain: DOMAIN, appTitle: APP_TITLE, providerId, modelId, onChunk });
}

export const safeParseStringArray = sharedParseStringArray;
export const safeParseJsonArray = sharedParseJsonArray;

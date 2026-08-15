// Send to Code Morph Lab. Shim over hub-pipes.js (spec 246 Milestone 1).
// Public API and the `cml:handoff` localStorage key are unchanged.

import { stashLsPayload, navigateToLab, logExecution } from './hub-pipes.js';

const KEY = 'cml:handoff';
const MAX_BYTES = 2 * 1024 * 1024;
const TARGET_APP = 'code-morph-lab-v3';

/**
 * Stash a handoff payload in localStorage and navigate to the latest Code Morph Lab.
 *
 * Payload shape:
 * {
 *   source: 'prompt-gallery' | 'three-prompt-lab' | 'model-eval-lab' | 'svg-benchmark' | 'code-arena',
 *   kind: 'prompt' | 'code',
 *   title: string,
 *   prompt?: string,                  // required when kind === 'prompt'
 *   files?: Array<{name, content}>,   // required when kind === 'code'
 *   language?: 'html' | 'python',
 *   meta?: { model?, createdAt?, sourceId?, sourceUrl? },
 * }
 */
export function sendToCodeMorphLab(payload) {
  const meta = {
    ...(payload.meta || {}),
    sourceUrl: payload.meta?.sourceUrl || window.location.href,
  };
  const full = { v: 1, ...payload, meta };
  stashLsPayload({ key: KEY, payload: full, maxBytes: MAX_BYTES });
  logExecution({
    source: payload.source,
    targetApp: TARGET_APP,
    kind: payload.kind === 'prompt' ? 'text/prompt' : 'text/code',
    title: payload.title,
  });
  navigateToLab({ targetApp: TARGET_APP });
}

export const HANDOFF_KEY = KEY;

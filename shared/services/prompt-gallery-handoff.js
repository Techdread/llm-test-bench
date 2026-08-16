// Send to Prompt Gallery's Create view. Shim over hub-pipes.js
// (spec 246 Milestone 1). Public API and the `prompt-gallery:inbound`
// localStorage key are unchanged.

import { stashLsPayload, readLsPayload, clearLsPayload, navigateToLab, logExecution } from './hub-pipes.js';

const KEY = 'prompt-gallery:inbound';
const MAX_BYTES = 1 * 1024 * 1024; // 1 MB — prompt text only, plenty of headroom.
const TARGET_APP = 'prompt-gallery';

/**
 * Stash an inbound prompt payload and navigate to Prompt Gallery's create view.
 *
 * Payload shape:
 * {
 *   source: string,       // e.g. 'three-prompt-lab'
 *   title?: string,
 *   prompt: string,       // required
 *   meta?: { sourceId?, sourceUrl?, ... },
 * }
 */
export function sendToPromptGallery(payload) {
  if (!payload || !payload.prompt) {
    throw new Error('sendToPromptGallery requires a non-empty prompt');
  }
  const meta = {
    ...(payload.meta || {}),
    sourceUrl: payload.meta?.sourceUrl || window.location.href,
  };
  const full = {
    v: 1,
    sentAt: new Date().toISOString(),
    ...payload,
    meta,
  };
  stashLsPayload({ key: KEY, payload: full, maxBytes: MAX_BYTES });
  logExecution({
    source: payload.source,
    targetApp: TARGET_APP,
    kind: 'text/prompt',
    title: payload.title || payload.prompt.slice(0, 80),
  });
  navigateToLab({ targetApp: TARGET_APP, hash: '/create' });
}

export function peekPromptGalleryInboundHandoff() {
  const parsed = readLsPayload(KEY, { destructive: false });
  if (!parsed || parsed.v !== 1) return null;
  return parsed;
}

export function clearPromptGalleryInboundHandoff() {
  clearLsPayload(KEY);
}

export const PROMPT_GALLERY_INBOUND_KEY = KEY;

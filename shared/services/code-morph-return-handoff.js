// Send finished Code Morph Lab output back to its source app. Shim over
// hub-pipes.js (spec 246 Milestone 1). Public API and the localStorage
// keys (`prompt-gallery:cml-return`, `cml:return:<source>`) are unchanged.

import { stashLsPayload, readLsPayload, clearLsPayload, logExecution } from './hub-pipes.js';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const PROMPT_GALLERY_KEY = 'prompt-gallery:cml-return';
const RETURN_KEY_PREFIX = 'cml:return:';

const SOURCE_PATHS = {
  'prompt-gallery':   '../prompt-gallery/#/gallery',
  'three-prompt-lab': '../three-prompt-lab/',
  'model-eval-lab':   '../model-eval-lab/',
  'svg-benchmark':    '../svg-benchmark/',
  'code-arena':       '../code-arena/',
};

/**
 * @typedef {Object} CodeMorphReturnPayload
 * @property {string} source
 * @property {string} title
 * @property {string} prompt
 * @property {string} goal
 * @property {'html'|'python'} language
 * @property {Array<{name:string,content:string}>} files
 * @property {string} entryFile
 * @property {object} [meta]
 */

/**
 * Stash a return payload and navigate to the source app. Prompt Gallery
 * gets a dedicated key; other sources use a generic `cml:return:<source>`
 * keyspace.
 *
 * Note: this handoff drives navigation through `window.location.href`
 * directly rather than the shared navigateToLab() helper, because the
 * return targets are arbitrary absolute paths chosen per-source (and
 * sometimes supplied via meta.sourceUrl) rather than the standard
 * `../<app>/` shape.
 *
 * @param {CodeMorphReturnPayload} payload
 */
export function sendCodeMorphResultBack(payload) {
  const source = payload.source || payload.meta?.source || '';
  const full = {
    v: 1,
    returnedAt: new Date().toISOString(),
    ...payload,
    source,
  };

  if (source === 'prompt-gallery') {
    stashLsPayload({ key: PROMPT_GALLERY_KEY, payload: full, maxBytes: MAX_BYTES });
    logExecution({ source: 'code-morph-lab-v3', targetApp: source, kind: 'text/code', title: payload.title });
    window.location.href = SOURCE_PATHS[source];
    return;
  }

  if (source) {
    stashLsPayload({ key: `${RETURN_KEY_PREFIX}${source}`, payload: full, maxBytes: MAX_BYTES });
    logExecution({ source: 'code-morph-lab-v3', targetApp: source, kind: 'text/code', title: payload.title });
  }

  const target = payload.meta?.sourceUrl || SOURCE_PATHS[source] || '../';
  window.location.href = target;
}

export function peekPromptGalleryReturnHandoff() {
  const parsed = readLsPayload(PROMPT_GALLERY_KEY, { destructive: false });
  if (!parsed || parsed.v !== 1) return null;
  return parsed;
}

export function clearPromptGalleryReturnHandoff() {
  clearLsPayload(PROMPT_GALLERY_KEY);
}

export function peekCodeMorphReturnHandoff(source) {
  const parsed = readLsPayload(`${RETURN_KEY_PREFIX}${source}`, { destructive: false });
  if (!parsed || parsed.v !== 1) return null;
  return parsed;
}

export function clearCodeMorphReturnHandoff(source) {
  clearLsPayload(`${RETURN_KEY_PREFIX}${source}`);
}

export const PROMPT_GALLERY_RETURN_KEY = PROMPT_GALLERY_KEY;

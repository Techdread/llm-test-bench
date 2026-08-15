// Send to Bugfix Bench v2. Shim over hub-pipes.js (spec 246 Milestone 1).
// Public API and the `bbh:handoff` localStorage key are unchanged.

import { stashLsPayload, navigateToLab, logExecution } from './hub-pipes.js';

const KEY = 'bbh:handoff';
const MAX_BYTES = 2 * 1024 * 1024;
const TARGET_APP = 'bugfix-bench-v2';

/**
 * @typedef {Object} BugfixBenchHandoff
 * @property {'prompt-gallery'|'code-arena'|'component-playground'|string} source
 * @property {string} title
 * @property {Array<{name:string,content:string}>} files
 * @property {'js'|'py'|'html'|'python'} [language]
 * @property {string} [entryFile]
 * @property {object} [meta]
 */

/**
 * Stash a handoff payload and navigate to Bugfix Bench v2's Author tab.
 * @param {BugfixBenchHandoff} payload
 */
export function sendToBugfixBench(payload) {
  const lang = normaliseLanguage(payload.language, payload.files);
  const full = { v: 1, ...payload, language: lang };
  stashLsPayload({ key: KEY, payload: full, maxBytes: MAX_BYTES });
  logExecution({
    source: payload.source,
    targetApp: TARGET_APP,
    kind: 'text/code',
    title: payload.title,
  });
  navigateToLab({ targetApp: TARGET_APP, hash: 'tab=author' });
}

function normaliseLanguage(lang, files) {
  if (lang === 'js' || lang === 'py') return lang;
  if (lang === 'python') return 'py';
  if (lang === 'html') return 'js';
  if (files?.some(f => (f.name || '').endsWith('.py'))) return 'py';
  return 'js';
}

export const HANDOFF_KEY = KEY;

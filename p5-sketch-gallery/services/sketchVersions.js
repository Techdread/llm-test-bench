// Versions of the sketch in Create, for the full-window player: where this
// session started (the demo, an opened or remixed sketch, a showcase item),
// each Generate, and any hand edits made between them. Pure, so the player and
// the tests share one rule for what is offered.

import { buildSrcDoc, defaultSketchCode } from './runtime/sketchRunner.js';

export const MAX_SKETCH_VERSIONS = 40;

function sameCode(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

function isStarter(code) {
  return sameCode(code, defaultSketchCode());
}

function snapshot({ code, params, seed }) {
  return { code: String(code || ''), params: { ...(params || {}) }, seed: seed | 0 || 1 };
}

/**
 * A fresh history for a newly loaded sketch. The plain starter sketch is not
 * recorded: it is what every empty Create shows, not a version of anything.
 * @param {{ code: string, params?: Object, seed?: number, label: string, detail?: string }} start
 */
export function startSketchHistory(start) {
  if (!start || !String(start.code || '').trim() || isStarter(start.code)) return [];
  return [{ ...snapshot(start), kind: 'start', label: start.label || 'Start', detail: start.detail || '' }];
}

/**
 * Adds a version unless it repeats the newest one. Oldest versions fall off
 * past MAX_SKETCH_VERSIONS so a long session stays light.
 * @param {Array} history
 * @param {{ code: string, params?: Object, seed?: number, kind: string, label: string, detail?: string }} entry
 */
export function recordSketchVersion(history, entry) {
  const list = Array.isArray(history) ? history : [];
  if (!entry || !String(entry.code || '').trim()) return list;
  if (list.length && sameCode(list.at(-1).code, entry.code)) return list;
  if (!list.length && isStarter(entry.code)) return list;
  const next = [...list, { ...snapshot(entry), kind: entry.kind || 'edit', label: entry.label || 'Version', detail: entry.detail || '' }];
  return next.length > MAX_SKETCH_VERSIONS ? next.slice(next.length - MAX_SKETCH_VERSIONS) : next;
}

/**
 * Records the editor's code before it is replaced (by a Generate), so hand
 * edits made since the last version are kept as a version of their own.
 */
export function keepHandEdits(history, current) {
  if (!current || isStarter(current.code)) return history;
  return recordSketchVersion(history, { ...current, kind: 'edit', label: 'Your edits' });
}

/**
 * The player's list. The sketch on screen is always offered, played with the
 * knobs and seed it has now; while a generation is streaming its half-written
 * code is left out.
 * @returns {{ versions: {id,label,detail,code,params,seed,latest?}[], currentId: string }}
 */
export function sketchVersions(history, current, { generating = false } = {}) {
  const list = (Array.isArray(history) ? history : []).map((entry, index) => ({
    id: `v-${index + 1}`,
    label: `${index + 1} · ${entry.label}`,
    detail: entry.detail || '',
    code: entry.code,
    params: entry.params,
    seed: entry.seed,
  }));
  let currentId = '';
  const code = current?.code || '';
  if (!generating && code.trim()) {
    const last = list.at(-1);
    if (last && sameCode(last.code, code)) {
      last.params = { ...(current.params || {}) };
      last.seed = current.seed | 0 || 1;
      currentId = last.id;
    } else if (list.length || !isStarter(code)) {
      list.push({ id: 'current', label: list.length ? 'Now · your edits' : 'This sketch', detail: list.length ? 'not saved' : '', ...snapshot(current) });
      currentId = 'current';
    } else {
      list.push({ id: 'current', label: 'Starter sketch', detail: '', ...snapshot(current) });
      currentId = 'current';
    }
  }
  const newest = list.at(-1);
  if (newest && list.length > 1) newest.latest = true;
  return { versions: list, currentId: currentId || newest?.id || '' };
}

/**
 * A page that runs one sketch on its own, full size, with no messages from
 * the app: the preview runner, told to start itself. The code rides in as
 * JSON with "<" escaped, so a "</script>" inside it cannot end the tag.
 */
export function playableSketchHtml({ code, params, seed }) {
  const init = JSON.stringify({ type: 'init', code: String(code || ''), params: params || {}, seed: seed | 0 || 1, playing: true })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const start = `<script>window.postMessage(${init}, '*');<\/script>`;
  const page = buildSrcDoc();
  const at = page.lastIndexOf('</body>');
  return at < 0 ? page + start : page.slice(0, at) + start + '\n' + page.slice(at);
}

/** Versions in the shape the shared player takes (`html` per version). */
export function playerVersions(versions) {
  return versions.map(v => ({ id: v.id, label: v.label, detail: v.detail, latest: v.latest, html: playableSketchHtml(v) }));
}

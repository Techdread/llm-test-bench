// Versions of the drawing in Create, for the full-window player: where this
// session started (the demo, an opened submission, a showcase item), each
// Generate, and any hand edits a Generate replaced. Pure, so the player and
// the tests share one rule for what is offered.

import { svgDataUrl } from './svgRender.js';

export const MAX_SVG_VERSIONS = 40;

function hasSvg(code) {
  return /<svg[\s>]/i.test(String(code || ''));
}

function sameCode(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

/**
 * A fresh history for a newly loaded drawing (none for an empty editor).
 * @param {{ code: string, label: string, detail?: string }} start
 */
export function startSvgHistory(start) {
  if (!start || !hasSvg(start.code)) return [];
  return [{ code: String(start.code), kind: 'start', label: start.label || 'Start', detail: start.detail || '' }];
}

/**
 * Adds a version unless it repeats the newest one or holds no SVG. Oldest
 * versions fall off past MAX_SVG_VERSIONS.
 */
export function recordSvgVersion(history, entry) {
  const list = Array.isArray(history) ? history : [];
  if (!entry || !hasSvg(entry.code)) return list;
  if (list.length && sameCode(list.at(-1).code, entry.code)) return list;
  const next = [...list, { code: String(entry.code), kind: entry.kind || 'edit', label: entry.label || 'Version', detail: entry.detail || '' }];
  return next.length > MAX_SVG_VERSIONS ? next.slice(next.length - MAX_SVG_VERSIONS) : next;
}

/** Keeps the editor's SVG as a version before a Generate clears it. */
export function keepSvgEdits(history, code) {
  return recordSvgVersion(history, { code, kind: 'edit', label: 'Your edits' });
}

/**
 * The player's list. The drawing on screen is always offered; while a
 * generation is streaming its half-written SVG is left out.
 * @returns {{ versions: {id,label,detail,code,latest?}[], currentId: string }}
 */
export function svgVersions(history, currentCode, { generating = false } = {}) {
  const list = (Array.isArray(history) ? history : []).map((entry, index) => ({
    id: `v-${index + 1}`,
    label: `${index + 1} · ${entry.label}`,
    detail: entry.detail || '',
    code: entry.code,
  }));
  let currentId = '';
  if (!generating && hasSvg(currentCode)) {
    const last = list.at(-1);
    if (last && sameCode(last.code, currentCode)) {
      currentId = last.id;
    } else {
      list.push({
        id: 'current',
        label: list.length ? 'Now · your edits' : 'This drawing',
        detail: list.length ? 'not saved' : '',
        code: String(currentCode),
      });
      currentId = 'current';
    }
  }
  const newest = list.at(-1);
  if (newest && list.length > 1) newest.latest = true;
  return { versions: list, currentId: currentId || newest?.id || '' };
}

/**
 * A page showing one SVG as large as the window allows. It is drawn as an
 * <img>, like every preview here, so its animation plays and nothing in it
 * can run.
 */
export function playableSvgHtml(code) {
  const src = svgDataUrl(String(code || '')).replace(/"/g, '%22');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  html, body { margin: 0; height: 100%; background: #ffffff; }
  body { display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 24px; }
  img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body><img src="${src}" alt=""></body>
</html>`;
}

/** Versions in the shape the shared player takes (`html` per version). */
export function playerSvgVersions(versions) {
  return versions.map(v => ({ id: v.id, label: v.label, detail: v.detail, latest: v.latest, html: playableSvgHtml(v.code) }));
}

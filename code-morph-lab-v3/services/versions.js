// Playable versions of a morph: the imported original, the workspace after
// each iteration, and the final workspace when it differs from the last one.
// Pure, so the Play overlay and the tests share one rule for what is offered.

import { htmlEntry, playableHtml } from '../../shared/services/playable-html.js';

export { htmlEntry, playableHtml };

function hasPage(files) {
  return Boolean(htmlEntry(files));
}

function sameFiles(a, b) {
  const ak = Object.keys(a || {}).filter(k => k !== 'model-stream.md').sort();
  const bk = Object.keys(b || {}).filter(k => k !== 'model-stream.md').sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && a[k] === b[k]);
}

/**
 * @param {{ startingFiles?: Object, iterations?: Array, finalFiles?: Object, running?: boolean }} input
 * @returns {{ id: string, label: string, detail: string, files: Object }[]} oldest first
 */
export function buildPlayableVersions({ startingFiles = null, iterations = [], finalFiles = null, running = false } = {}) {
  const versions = [];
  if (startingFiles && hasPage(startingFiles)) {
    versions.push({ id: 'original', label: 'Original', detail: 'as it was imported', files: startingFiles });
  }
  let previous = startingFiles;
  for (const iteration of iterations) {
    const files = iteration?.snapshot;
    if (!files || !hasPage(files)) continue;
    // An iteration that changed nothing would be a duplicate choice.
    if (previous && sameFiles(files, previous)) continue;
    const detail = iteration.success ? 'ran clean' : (iteration.errorInfo?.label || 'had errors');
    versions.push({ id: `iteration-${iteration.number}`, label: `After iteration ${iteration.number}`, detail, files });
    previous = files;
  }
  if (finalFiles && hasPage(finalFiles) && !(previous && sameFiles(finalFiles, previous))) {
    versions.push({ id: 'final', label: running ? 'Current workspace' : 'Final workspace', detail: running ? 'still morphing' : '', files: finalFiles });
  }
  // The newest morphed version is the one people came back for.
  const newest = versions.at(-1);
  if (newest && newest.id !== 'original' && !running) newest.latest = true;
  return versions;
}

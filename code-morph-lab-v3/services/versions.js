// Playable versions of a morph: the imported original, the workspace after
// each iteration, and the final workspace when it differs from the last one.
// Pure, so the Play overlay and the tests share one rule for what is offered.

/** The page a set of files opens on: index.html, else the shallowest .html. */
export function htmlEntry(files) {
  const names = Object.keys(files || {}).filter(name => typeof files[name] === 'string');
  if (names.includes('index.html')) return 'index.html';
  return names.filter(name => /\.html?$/i.test(name))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || '';
}

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

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The entry page with the workspace's own CSS and JS inlined, so a project
 * split across files plays in a single sandboxed frame. Only files that exist
 * in the workspace are inlined; anything else is left as written.
 */
export function playableHtml(files) {
  const entry = htmlEntry(files);
  if (!entry) return '';
  let page = files[entry];
  for (const [name, content] of Object.entries(files)) {
    if (name === entry || typeof content !== 'string') continue;
    const ref = `["'](?:\\./)?${escapeRe(name)}["']`;
    if (/\.css$/i.test(name)) {
      page = page.replace(new RegExp(`<link\\b[^>]*href=${ref}[^>]*>`, 'gi'), () => `<style data-file="${name}">\n${content}\n</style>`);
    } else if (/\.m?js$/i.test(name)) {
      page = page.replace(new RegExp(`<script\\b([^>]*?)\\ssrc=${ref}([^>]*)>\\s*</script>`, 'gi'),
        (_, before, after) => `<script${before}${after} data-file="${name}">\n${content.replace(/<\/script/gi, '<\\/script')}\n</script>`);
    }
  }
  return page;
}

// diff-engine — line + word diff → unified hunks.
//
// Thin wrapper around the `diff` library (jsdiff). Self-loads from shared/lib so
// consuming apps don't need an import map entry.
//
// Public API:
//   diffLines(a, b)               -> { kind: 'add'|'del'|'eq', text }[]
//   diffWords(a, b, { withSpace }) -> { kind: 'add'|'del'|'eq', text }[]
//   buildHunks(oldText, newText, { context }) -> Hunk[]
//   applyHunks(oldText, hunks)    -> string
//   summariseHunks(hunks)         -> { add, del, count }
//
// Hunk shape (matches the original ast-explorer-refactor-lab/services/diffEngine.js):
//   { id, oldStart, oldLines, newStart, newLines, lines: [{kind, text}], accepted }

const DIFF_LIB_URL = '../lib/diff/5.2.0/index.mjs';

let diffModulePromise = null;
function loadDiff() {
  if (!diffModulePromise) diffModulePromise = import(DIFF_LIB_URL);
  return diffModulePromise;
}

function kindOf(part) {
  if (part.added) return 'add';
  if (part.removed) return 'del';
  return 'eq';
}

function splitNonEmpty(value) {
  // jsdiff's `value` ends each entry with the trailing newline; we strip the
  // final '\n' before splitting so an n-line block yields n rows (not n+1).
  return value.replace(/\n$/, '').split('\n');
}

/**
 * Line-level diff. Returns one entry per line tagged 'add' | 'del' | 'eq'.
 * @param {string} a
 * @param {string} b
 * @returns {Promise<Array<{kind: 'add'|'del'|'eq', text: string}>>}
 */
export async function diffLines(a, b) {
  const { diffLines: jsDiffLines } = await loadDiff();
  const out = [];
  for (const part of jsDiffLines(a ?? '', b ?? '')) {
    const kind = kindOf(part);
    for (const line of splitNonEmpty(part.value)) out.push({ kind, text: line });
  }
  return out;
}

/**
 * Word-level diff. By default uses `diffWordsWithSpace` (preserves
 * whitespace boundaries); pass `withSpace: false` to fall back to `diffWords`
 * which collapses whitespace runs.
 *
 * @param {string} a
 * @param {string} b
 * @param {{ withSpace?: boolean }} [opts]
 * @returns {Promise<Array<{kind: 'add'|'del'|'eq', text: string}>>}
 */
export async function diffWords(a, b, { withSpace = true } = {}) {
  const mod = await loadDiff();
  const fn = withSpace ? mod.diffWordsWithSpace : mod.diffWords;
  return fn(a ?? '', b ?? '').map((part) => ({ kind: kindOf(part), text: part.value }));
}

/**
 * Build a unified-hunk model from two text blobs.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ context?: number }} [opts]  default context = 3
 * @returns {Promise<Array>}
 */
export async function buildHunks(oldText, newText, { context = 3 } = {}) {
  const { structuredPatch } = await loadDiff();
  const patch = structuredPatch('before', 'after', oldText, newText, '', '', { context });
  return patch.hunks.map((h, i) => ({
    id: String(i),
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines.map((l) => ({
      kind: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('\\') ? 'meta' : 'ctx',
      text: l.length > 0 && (l[0] === '+' || l[0] === '-' || l[0] === ' ') ? l.slice(1) : l,
    })),
    accepted: true,
  }));
}

/**
 * Apply only the accepted hunks to `oldText`, producing a merged result.
 * Rejected hunks are skipped (the old-side lines are kept verbatim).
 * @param {string} oldText
 * @param {Array}  hunks
 * @returns {string}
 */
export function applyHunks(oldText, hunks) {
  const oldLines = oldText.split('\n');
  const hasTrailingNewline = oldText.endsWith('\n');
  const output = [];

  let cursor = 0;
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

  for (const h of sorted) {
    const startIdx = Math.max(0, h.oldStart - 1);
    while (cursor < startIdx) output.push(oldLines[cursor++]);
    if (h.accepted) {
      for (const line of h.lines) {
        if (line.kind === 'ctx' || line.kind === 'add') output.push(line.text);
      }
    } else {
      for (const line of h.lines) {
        if (line.kind === 'ctx' || line.kind === 'del') output.push(line.text);
      }
    }
    cursor = startIdx + h.oldLines;
  }
  while (cursor < oldLines.length) output.push(oldLines[cursor++]);

  const joined = output.join('\n');
  if (hasTrailingNewline && !joined.endsWith('\n')) return joined + '\n';
  if (!hasTrailingNewline && joined.endsWith('\n')) return joined.slice(0, -1);
  return joined;
}

/** Count adds/dels across a hunk list. */
export function summariseHunks(hunks) {
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') add++;
      else if (l.kind === 'del') del++;
    }
  }
  return { add, del, count: hunks.length };
}

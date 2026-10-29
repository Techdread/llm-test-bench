// codeVisibility — whether a cell shows its source, and how an export shows it.
//
// The "hide code" toggle used to be screen-only state, so a report always
// exported every line of its working. It is now saved on the cell as
// `metadata.hideCode`, and an export folds that cell's source away behind a
// "Show code" summary: the reader sees the result, and can still check the
// working.

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Kinds whose output stays on screen when their source is hidden. */
const NO_SEPARATE_OUTPUT = new Set(['md', 'ui']);

export function canHideCode(kind) {
  return Boolean(kind) && !NO_SEPARATE_OUTPUT.has(kind);
}

/** The saved choice: true or false once the user has toggled, else undefined. */
export function savedHideCode(cell) {
  const value = cell?.metadata?.hideCode;
  return typeof value === 'boolean' ? value : undefined;
}

export function withHideCode(cell, hidden) {
  return { ...(cell?.metadata || {}), hideCode: Boolean(hidden) };
}

/** The source block for a standalone export. */
export function exportCodeBlock(cell) {
  const pre = `<pre class="c-src"><code>${escapeHtml(cell?.source || '')}</code></pre>`;
  return savedHideCode(cell) ? `<details class="c-code"><summary>Show code</summary>${pre}</details>` : pre;
}

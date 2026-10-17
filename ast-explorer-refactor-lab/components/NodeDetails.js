// Node details pane — shows the selected node's kind, range, loc, and a JSON
// dump of its scalar properties. Keeps heavy child arrays out of the dump.

import { html } from 'htm/preact';

export function NodeDetails({ entry, source }) {
  if (!entry) {
    return html`<div class="details-body"><p class="muted">Click a node (tree or source) to inspect.</p></div>`;
  }
  const node = entry.node;
  const snippet = (entry.range && source)
    ? source.slice(entry.range[0], entry.range[1])
    : '';

  const rows = [
    { dt: 'type', dd: html`<strong>${entry.kind}</strong>`, show: true },
    { dt: 'field', dd: entry.field || '', show: !!entry.field },
    { dt: 'offsets', dd: entry.range
        ? html`<span class="monospace">${entry.range[0]}…${entry.range[1]} (${entry.range[1] - entry.range[0]} chars)</span>`
        : '', show: !!entry.range },
    { dt: 'location', dd: entry.loc
        ? html`<span class="monospace">L${entry.loc.start.line}:${entry.loc.start.column} → L${entry.loc.end.line}:${entry.loc.end.column}</span>`
        : '', show: !!entry.loc },
  ];

  return html`
    <div class="details-body">
      <dl>
        ${rows.filter(r => r.show).map(r => html`
          <dt key=${r.dt}>${r.dt}</dt><dd>${r.dd}</dd>
        `)}
      </dl>
      ${snippet && html`
        <p class="muted" style=${{ marginTop: 12, marginBottom: 4 }}>Source snippet</p>
        <pre>${snippet.length > 600 ? snippet.slice(0, 600) + '\n…' : snippet}</pre>
      `}
      <p class="muted" style=${{ marginTop: 12, marginBottom: 4 }}>Node JSON</p>
      <pre>${JSON.stringify(scalarShape(node), null, 2)}</pre>
    </div>
  `;
}

function scalarShape(node) {
  if (!node) return null;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      if (v.every(x => typeof x !== 'object' || x === null)) out[k] = v;
      else out[k] = `[${v.length} children]`;
      continue;
    }
    if (typeof v === 'object') {
      if (v.type) out[k] = `<${v.type}>`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

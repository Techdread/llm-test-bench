// Right-hand variable table for the current snapshot.

import { html } from 'htm/preact';

export function VariablesPanel({ snapshot, mapping, kind, onRemap, vars }) {
  const entries = snapshot
    ? [...snapshot.vars.entries()]
    : [];
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  return html`
    <div class="vars-panel">
      <div class="vars-header">
        <div>
          <span class="vars-kind">${kind ? kind.toUpperCase() : '—'}</span>
        </div>
        <div class="vars-t">${snapshot ? `t=${snapshot.t}` : ''}</div>
      </div>
      ${kind && html`<${MappingEditor} mapping=${mapping} kind=${kind} vars=${vars} onRemap=${onRemap} />`}
      <div class="vars-list">
        ${entries.length === 0 && html`<div class="muted pad">No variables captured yet.</div>`}
        ${entries.map(([name, value]) => html`
          <div class="var-row">
            <div class="var-name">${name}</div>
            <div class="var-value">${formatValue(value)}</div>
          </div>
        `)}
      </div>
    </div>
  `;
}

function MappingEditor({ mapping, kind, vars, onRemap }) {
  const fields = fieldsForKind(kind);
  if (!fields.length) return null;
  return html`
    <div class="vars-mapping">
      <div class="vars-section-title">Mapping</div>
      ${fields.map(f => html`
        <div class="map-row">
          <label class="map-label">${f.label}</label>
          ${f.multi
            ? html`<input class="map-input" type="text"
                          value=${Array.isArray(mapping[f.key]) ? mapping[f.key].join(', ') : ''}
                          onChange=${(e) => onRemap({ ...mapping, [f.key]: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                          placeholder="i, j" />`
            : html`<select class="map-input" value=${mapping[f.key] || ''}
                          onChange=${(e) => onRemap({ ...mapping, [f.key]: e.target.value })}>
                    <option value="">—</option>
                    ${vars.map(v => html`<option value=${v}>${v}</option>`)}
                  </select>`
          }
        </div>
      `)}
    </div>
  `;
}

function fieldsForKind(kind) {
  switch (kind) {
    case 'array': return [
      { key: 'array', label: 'Array', multi: false },
      { key: 'cursors', label: 'Cursors', multi: true },
    ];
    case 'graph': return [
      { key: 'adjacency', label: 'Adjacency', multi: false },
      { key: 'frontier',  label: 'Frontier',  multi: false },
      { key: 'visited',   label: 'Visited',   multi: false },
    ];
    case 'tree': return [
      { key: 'root',   label: 'Root',   multi: false },
      { key: 'cursor', label: 'Cursor', multi: false },
    ];
    case 'grid': return [
      { key: 'table',  label: 'Table',  multi: false },
      { key: 'cursor', label: 'Cursor', multi: false },
    ];
    default: return [];
  }
}

function formatValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length > 16) return `[${v.slice(0, 16).map(formatShort).join(', ')}, …${v.length - 16}]`;
    return `[${v.map(formatShort).join(', ')}]`;
  }
  if (t === 'object') {
    if (v.__bigint) return v.__bigint + 'n';
    if (v.__fn) return `fn ${v.__fn}`;
    if (v.__sym) return v.__sym;
    if (v.__circular) return '<circular>';
    if (v.__truncated === true) return '<truncated>';
    const keys = Object.keys(v).slice(0, 8);
    const body = keys.map(k => `${k}: ${formatShort(v[k])}`).join(', ');
    return `{${body}${Object.keys(v).length > 8 ? ', …' : ''}}`;
  }
  return String(v);
}

function formatShort(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return v.length > 4 ? `[…${v.length}]` : `[${v.map(formatShort).join(',')}]`;
  if (t === 'object') return '{…}';
  return String(v);
}

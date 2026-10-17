import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function TableTree({ schema, onInsertRef, onBrowse }) {
  const [open, setOpen] = useState({});
  const tables = schema?.tables || [];

  const toggle = (name) => setOpen(o => ({ ...o, [name]: !o[name] }));

  return html`
    <div class="side-section">
      <div class="side-header">
        <span><i class="fa-solid fa-table"></i> Schema</span>
      </div>
      <div class="table-tree">
        ${tables.length === 0 && html`<div class="muted side-empty">No tables in this DB.</div>`}
        ${tables.map(t => html`
          <div class="tree-table" key=${t.name}>
            <div class="tree-table-row">
              <button class="tree-toggle" onClick=${() => toggle(t.name)}
                      aria-expanded=${!!open[t.name]} aria-label=${`${open[t.name] ? 'Collapse' : 'Expand'} ${t.name}`}>
                <i class=${`fa-solid ${open[t.name] ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>
              </button>
              <span class="tree-name" onClick=${() => onInsertRef?.(t.name)} title="Click to insert name">
                ${t.name}
              </span>
              <span class="tree-count">${t.columns.length}</span>
              <button class="btn-icon btn-xs" onClick=${() => onBrowse?.(t.name)} title="SELECT * FROM ${t.name}">
                <i class="fa-solid fa-eye"></i>
              </button>
            </div>
            ${open[t.name] && html`
              <div class="tree-columns">
                ${t.columns.map(c => html`
                  <div class="tree-col" key=${c.name} onClick=${() => onInsertRef?.(`${t.name}.${c.name}`)}>
                    ${c.pk && html`<i class="fa-solid fa-key" title="Primary key"></i>`}
                    <span class="col-name">${c.name}</span>
                    <span class="col-type">${c.type || ''}</span>
                    ${c.notnull && !c.pk && html`<span class="col-flag" title="NOT NULL">NN</span>`}
                  </div>
                `)}
                ${t.foreignKeys.map(fk => html`
                  <div class="tree-fk" key=${fk.id + '-' + fk.fromColumn}>
                    <i class="fa-solid fa-link"></i>
                    ${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}
                  </div>
                `)}
              </div>
            `}
          </div>
        `)}
      </div>
    </div>
  `;
}

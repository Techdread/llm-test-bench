import { html } from 'htm/preact';

export function DbList({ dbs, current, dirty, onSelect, onNew, onDelete, onExport, onImport }) {
  return html`
    <div class="side-section">
      <div class="side-header">
        <span><i class="fa-solid fa-database"></i> Databases</span>
        <div class="side-header-actions">
          <button class="btn-icon btn-sm" onClick=${onImport} title="Import .sqlite / .db">
            <i class="fa-solid fa-file-import"></i>
          </button>
          <button class="btn-icon btn-sm" onClick=${onNew} title="New DB">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>
      <div class="db-list">
        ${dbs.length === 0 && html`<div class="muted side-empty">No saved DBs yet.</div>`}
        ${dbs.map(name => html`
          <div class=${`db-item ${name === current ? 'active' : ''}`} key=${name}>
            <button class="db-select-btn" onClick=${() => onSelect(name)} title=${name}>
              <i class="fa-solid fa-database"></i>
              <span>${name}</span>
              ${name === current && dirty && html`<span class="dirty-dot" title="Unsaved changes">•</span>`}
            </button>
            <button class="btn-icon btn-xs" onClick=${() => onExport(name)} title="Download .sqlite">
              <i class="fa-solid fa-download"></i>
            </button>
            <button class="btn-icon btn-xs btn-danger" onClick=${() => onDelete(name)} title="Delete DB">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `)}
      </div>
    </div>
  `;
}

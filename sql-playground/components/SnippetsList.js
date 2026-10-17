import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function SnippetsList({ snippets, onLoad, onDelete, onSaveCurrent }) {
  const [name, setName] = useState('');

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSaveCurrent?.(n);
    setName('');
  };

  return html`
    <div class="side-section">
      <div class="side-header">
        <span><i class="fa-solid fa-bookmark"></i> Snippets</span>
      </div>
      <div class="snippet-save">
        <input placeholder="Save current as…" aria-label="Snippet name" value=${name}
               onInput=${(e) => setName(e.target.value)}
               onKeyDown=${(e) => e.key === 'Enter' && submit()} />
        <button class="btn-icon btn-sm" onClick=${submit} disabled=${!name.trim()} title="Save snippet" aria-label="Save snippet">
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
      </div>
      <div class="snippet-list">
        ${snippets.length === 0 && html`<div class="muted side-empty">No saved snippets.</div>`}
        ${snippets.map(s => html`
          <div class="snippet-item" key=${s.id}>
            <button class="snippet-load" onClick=${() => onLoad?.(s)} title=${s.sql}>
              <i class="fa-solid fa-code"></i> ${s.name}
            </button>
            <button class="btn-icon btn-xs btn-danger" onClick=${() => onDelete?.(s.id)} title="Delete snippet">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        `)}
      </div>
    </div>
  `;
}

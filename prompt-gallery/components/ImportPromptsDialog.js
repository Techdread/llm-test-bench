import { html } from 'htm/preact';
import { useState, useCallback, useMemo } from 'preact/hooks';
import { CATEGORIES } from '../services/library.js';

// items: [{ key, title, prompt, category, tags, notes, sourceLabel,
//           importedFrom, alreadyInLibrary }]
export function ImportPromptsDialog({ items, onImport, onClose }) {
  const importable = useMemo(() => items.filter(i => !i.alreadyInLibrary), [items]);
  const [checked, setChecked] = useState(() => new Set());
  const [categories, setCategories] = useState(() => {
    const map = {};
    for (const i of items) map[i.key] = i.category;
    return map;
  });

  const toggle = useCallback((key) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setChecked(prev =>
      prev.size === importable.length ? new Set() : new Set(importable.map(i => i.key))
    );
  }, [importable]);

  const handleImport = useCallback(() => {
    const selected = importable
      .filter(i => checked.has(i.key))
      .map(i => ({ ...i, category: categories[i.key] || i.category }));
    onImport(selected);
  }, [importable, checked, categories, onImport]);

  return html`
    <div class="modal-overlay" onKeyDown=${(e) => e.key === 'Escape' && onClose()}>
      <div class="modal import-prompts-dialog" onClick=${(e) => e.stopPropagation()} style=${{ width: '720px' }}>
        <div class="modal-header">
          <h2>Import Prompts</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          ${items.length === 0
            ? html`
                <div class="gallery-empty" style=${{ padding: '32px 0' }}>
                  <i class="fa-solid fa-file-import"></i>
                  <p>No prompts found in saved generations or Three Prompt Lab</p>
                </div>
              `
            : html`
                <div class="import-list-header">
                  <label class="import-check-all">
                    <input
                      type="checkbox"
                      checked=${checked.size === importable.length && importable.length > 0}
                      onChange=${toggleAll}
                    />
                    Select all (${importable.length} new, ${items.length - importable.length} already in library)
                  </label>
                </div>
                <div class="import-list">
                  ${items.map(item => html`
                    <div class=${`import-item ${item.alreadyInLibrary ? 'import-item-existing' : ''}`} key=${item.key}>
                      <input
                        type="checkbox"
                        disabled=${item.alreadyInLibrary}
                        checked=${checked.has(item.key)}
                        onChange=${() => toggle(item.key)}
                      />
                      <div class="import-item-body" onClick=${() => !item.alreadyInLibrary && toggle(item.key)}>
                        <div class="import-item-title">
                          ${item.title}
                          ${item.alreadyInLibrary && html`<span class="library-badge">already in library</span>`}
                        </div>
                        <div class="import-item-prompt">${item.prompt}</div>
                        <div class="import-item-source">${item.sourceLabel}</div>
                      </div>
                      <select
                        class="form-input import-item-category"
                        disabled=${item.alreadyInLibrary}
                        value=${categories[item.key]}
                        onChange=${(e) => setCategories(prev => ({ ...prev, [item.key]: e.target.value }))}
                      >
                        ${CATEGORIES.map(c => html`<option key=${c.id} value=${c.id}>${c.label}</option>`)}
                      </select>
                    </div>
                  `)}
                </div>
              `
          }
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${handleImport} disabled=${checked.size === 0}>
            <i class="fa-solid fa-file-import"></i> Import ${checked.size > 0 ? checked.size : ''} Prompt${checked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  `;
}

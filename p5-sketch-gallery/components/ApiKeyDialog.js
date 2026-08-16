import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function ApiKeyDialog({ currentKey, onSave, onClose }) {
  const [key, setKey] = useState(currentKey || '');
  const handleSave = () => onSave(key.trim());

  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '500px' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-key" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>OpenRouter API Key</h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <p style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Stored only in your browser's localStorage — never sent anywhere except OpenRouter.
          </p>
          <div class="form-group">
            <label>API Key</label>
            <input
              class="form-input"
              type="password"
              value=${key}
              onInput=${(e) => setKey(e.target.value)}
              onKeyDown=${(e) => e.key === 'Enter' && handleSave()}
              placeholder="sk-or-v1-..."
              autoFocus
              style=${{ fontFamily: 'monospace' }}
            />
          </div>
          <p style=${{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style=${{ color: 'var(--accent)' }}>openrouter.ai/keys</a>.
          </p>
        </div>
        <div class="modal-footer">
          ${currentKey && html`
            <button class="btn btn-danger" onClick=${() => onSave('')} style=${{ marginRight: 'auto' }}>
              <i class="fa-solid fa-trash"></i> Remove
            </button>
          `}
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${handleSave}>
            <i class="fa-solid fa-check"></i> Save
          </button>
        </div>
      </div>
    </div>
  `;
}

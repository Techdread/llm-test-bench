// Modal listing saved sessions with open/delete.

import { html } from 'htm/preact';

export function SessionsDialog({ sessions, onOpen, onDelete, onClose }) {
  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: 640 }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-folder-open" style=${{ marginRight: 8 }}></i>Saved sessions</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="modal-body">
          ${sessions.length === 0
            ? html`<p class="muted">No sessions saved yet. Use the Save button in the toolbar.</p>`
            : html`<div class="session-list">
                ${sessions.map(s => html`
                  <div key=${s.id} class="session-row" onClick=${() => onOpen(s)}>
                    <i class="fa-solid fa-file-code"></i>
                    <div>
                      <div class="title">${s.name}</div>
                      <div class="meta">${s.language || 'js'} · ${(s.updatedAt || s.createdAt || '').slice(0, 19).replace('T', ' ')}</div>
                    </div>
                    <div class="spacer"></div>
                    <button class="btn btn-small btn-danger" onClick=${(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete session "${s.name}"?`)) onDelete(s.id);
                    }} title="Delete session">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                `)}
              </div>`
          }
        </div>
      </div>
    </div>
  `;
}

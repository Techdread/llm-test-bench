import { html } from 'htm/preact';

export function SessionsDialog({ sessions, onOpen, onDelete, onClose }) {
  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '560px' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-folder-open" style=${{ marginRight: 8, color: 'var(--accent)' }}></i>Saved sessions</h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          ${sessions.length === 0 && html`<p class="muted">No saved sessions yet.</p>`}
          <div class="session-list">
            ${sessions.map(s => html`
              <div class="session-row">
                <div onClick=${() => onOpen(s)} style=${{ flex: 1, cursor: 'pointer' }}>
                  <div class="title">${s.name || '(untitled)'}</div>
                  <div class="meta">${s.language || ''} · ${s.updatedAt?.slice(0, 19).replace('T', ' ')}</div>
                </div>
                <button class="btn-icon" onClick=${() => onDelete(s.id)} title="Delete">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            `)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';

export function RecentMorphsList({ sessions, onOpen, onDelete }) {
  if (!sessions || sessions.length === 0) {
    return html`<div class="recent-empty">No morphs yet</div>`;
  }
  return html`
    <ul class="recent-morphs">
      ${sessions.map(s => html`
        <li key=${s.id}>
          <span class="recent-date">${(s.createdAt || '').slice(0, 10)}</span>
          <span class="recent-goal" title=${s.goal}>${s.goal}</span>
          <span class=${`recent-status status-${s.status}`}>${statusLabel(s.status)}</span>
          <button class="btn-link" onClick=${() => onOpen(s.id)}>open</button>
          ${onDelete && html`
            <button
              class="btn-icon btn-sm recent-delete"
              title="Delete this morph"
              aria-label="Delete morph"
              onClick=${() => onDelete(s.id, s.goal)}
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          `}
        </li>
      `)}
    </ul>
  `;
}

function statusLabel(status) {
  switch (status) {
    case 'success': return '✓ success';
    case 'failed':  return '✗ failed';
    case 'stopped': return '■ stopped';
    case 'running': return '● running';
    default:        return status || '—';
  }
}

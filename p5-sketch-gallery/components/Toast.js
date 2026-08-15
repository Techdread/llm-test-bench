import { html } from 'htm/preact';

export function Toast({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return html`
    <div class="toast-container">
      ${toasts.map(t => html`
        <div class=${`toast toast-${t.type || 'info'}`} key=${t.id}>${t.message}</div>
      `)}
    </div>
  `;
}

import { html } from 'htm/preact';

export function Toast({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return html`
    <div class="toast-container">
      ${toasts.map(t => html`<div key=${t.id} class=${`toast toast-${t.type}`}>${t.message}</div>`)}
    </div>
  `;
}

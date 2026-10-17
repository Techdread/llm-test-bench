import { html } from 'htm/preact';

export function Toast({ toasts }) {
  return html`
    <div class="toast-stack">
      ${toasts.map(t => html`
        <div class=${`toast toast-${t.type || 'info'}`} key=${t.id}>
          <span>${t.message}</span>
        </div>
      `)}
    </div>
  `;
}

import { html } from 'htm/preact';

const ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-xmark',
  info: 'fa-circle-info',
};

export function Toast({ toasts }) {
  if (!toasts.length) return null;

  return html`
    <div class="toast-container">
      ${toasts.map(t => html`
        <div class=${`toast toast-${t.type}`} key=${t.id}>
          <i class=${`fa-solid ${ICONS[t.type] || ICONS.info}`}></i>
          ${t.message}
        </div>
      `)}
    </div>
  `;
}

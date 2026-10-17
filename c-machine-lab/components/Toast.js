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
      ${toasts.map(toast => html`
        <div class=${`toast toast-${toast.type}`} key=${toast.id}>
          <i class=${`fa-solid ${ICONS[toast.type] || ICONS.info}`}></i>
          ${toast.message}
        </div>
      `)}
    </div>
  `;
}

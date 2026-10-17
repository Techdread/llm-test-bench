import { html } from 'htm/preact';

export function HtmlPreview({ dataUrl }) {
  return html`
    <div class="html-preview">
      ${dataUrl
        ? html`<iframe sandbox="allow-scripts" src=${dataUrl} class="html-preview-frame"></iframe>`
        : html`
          <div class="html-preview-empty">
            <i class="fa-solid fa-eye"></i>
            <p>No preview yet</p>
          </div>
        `}
    </div>
  `;
}

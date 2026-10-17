import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

const STATUS_ICON = {
  completed: 'fa-check', failed: 'fa-triangle-exclamation', cancelled: 'fa-ban',
};

function ImageStrip({ images, onZoom }) {
  if (!images?.length) return null;
  return html`
    <div class="us-views" style="grid-template-columns:repeat(auto-fill,minmax(96px,1fr));margin:6px 0 12px">
      ${images.map((src, index) => html`
        <figure key=${index}>
          <img src=${src} alt=${`Image ${index + 1}`} onClick=${() => onZoom(src)} />
          <figcaption>${index + 1}</figcaption>
        </figure>`)}
    </div>`;
}

export function RunsView({ exchanges, onRefresh, onZoom, onDownload }) {
  const [selected, setSelected] = useState(0);
  const entry = exchanges[selected];

  return html`
    <div class="us-runs">
      <div class="us-run-list">
        <div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;gap:6px">
          <button class="us-btn us-btn-sm" onClick=${onRefresh}>
            <i class="fas fa-rotate"></i> Refresh
          </button>
          <button class="us-btn us-btn-sm" disabled=${!exchanges.length} onClick=${onDownload}>
            <i class="fas fa-download"></i> JSON
          </button>
        </div>
        ${exchanges.length === 0 && html`
          <p class="us-note" style="padding:12px">
            Every generation, repair and review call is recorded here — prompt, ordered images,
            raw response, timing and status. Failed and cancelled calls are kept too.
          </p>`}
        ${exchanges.map((item, index) => html`
          <div key=${item.id || index}
               class=${`us-run-row ${index === selected ? 'active' : ''}`}
               onClick=${() => setSelected(index)}>
            <div class="us-run-action">
              <i class=${`fas ${STATUS_ICON[item.status] || 'fa-circle'}`}></i>
              ${' '}${item.action}
            </div>
            <div class="us-note">
              ${item.status} · ${item.images?.length || 0} images
              ${item.ms ? ` · ${(item.ms / 1000).toFixed(1)}s` : ''}
            </div>
            <div class="us-note">${item.at ? new Date(item.at).toLocaleTimeString() : ''}</div>
          </div>`)}
      </div>

      <div class="us-run-detail">
        ${!entry && html`<p class="us-note">Select a call to inspect it.</p>`}
        ${entry && html`
          <div>
            <h3 style="margin:0 0 4px">${entry.action} · ${entry.status}</h3>
            <p class="us-note">
              ${entry.providerId ? `${entry.providerId} / ` : ''}${entry.model || 'Model not recorded'}
              ${entry.role === 'eyes' ? ' · as the eyes' : ''}
              ${entry.ms ? ` · ${(entry.ms / 1000).toFixed(1)}s` : ''}
            </p>
            ${entry.error && html`<div class="us-error" style="border-radius:6px;margin:8px 0">${entry.error}</div>`}
            <h4 style="margin:14px 0 4px;font-size:12px">Images sent, in order</h4>
            <${ImageStrip} images=${entry.images} onZoom=${onZoom} />
            <h4 style="margin:14px 0 4px;font-size:12px">Prompt</h4>
            <pre>${entry.prompt || '(none)'}</pre>
            <h4 style="margin:14px 0 4px;font-size:12px">Response</h4>
            <pre>${entry.response || '(no response was returned)'}</pre>
            <p class="us-note">
              Responses are stored before parsing, so a malformed answer, a reasoning-only reply
              or a truncated response is still readable here.
            </p>
          </div>`}
      </div>
    </div>`;
}

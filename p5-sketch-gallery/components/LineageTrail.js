import { html } from 'htm/preact';
import { lineageOf } from '../services/storage/metadataStore.js';

export function LineageTrail({ projects, currentId, onOpen }) {
  if (!currentId) return null;
  const { ancestors, children } = lineageOf(projects, currentId);
  if (ancestors.length === 0 && children.length === 0) return null;
  return html`
    <div class="lineage-trail">
      <div class="panel-title"><i class="fa-solid fa-code-branch"></i> Lineage</div>
      ${ancestors.length > 0 && html`
        <div class="lineage-row">
          <span class="muted small">Parents:</span>
          ${ancestors.map(a => html`
            <button class="tag clickable" key=${a.id} onClick=${() => onOpen(a.id)}>${a.title}</button>
          `)}
        </div>
      `}
      ${children.length > 0 && html`
        <div class="lineage-row">
          <span class="muted small">Remixes:</span>
          ${children.map(c => html`
            <button class="tag clickable" key=${c.id} onClick=${() => onOpen(c.id)}>${c.title}</button>
          `)}
        </div>
      `}
    </div>
  `;
}

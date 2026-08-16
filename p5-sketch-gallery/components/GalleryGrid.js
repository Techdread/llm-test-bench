import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';

function formatModelBadge(project) {
  const raw = project.modelId || project.modelDisplayLabel || project.model || '';
  return raw ? raw.split('/').pop() : 'manual';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function modelTooltip(project) {
  const parts = [];
  if (project.providerName) parts.push(`Provider: ${project.providerName}`);
  if (project.modelDisplayLabel || project.model) parts.push(`Model: ${project.modelDisplayLabel || project.model}`);
  if (project.modelId) parts.push(`Model ID: ${project.modelId}`);
  if (project.generatedAt) parts.push(`Generated: ${formatDate(project.generatedAt)}`);
  if (project.savedAt) parts.push(`Saved: ${formatDate(project.savedAt)}`);
  return parts.join('\n') || 'manual';
}

export function GalleryGrid({
  projects,
  onOpen,
  onAddToCompare,
  onRemix,
  onDelete,
  hasDirectory,
  onPickDirectory,
  compareIds,
}) {
  const [filter, setFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const allTags = useMemo(() => {
    const s = new Set();
    for (const p of projects) for (const t of p.tags || []) s.add(t);
    return [...s].sort();
  }, [projects]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return projects.filter(p => {
      if (q && !(p.title || '').toLowerCase().includes(q) && !(p.notes || '').toLowerCase().includes(q)) return false;
      if (tagFilter && !(p.tags || []).includes(tagFilter)) return false;
      return true;
    });
  }, [projects, filter, tagFilter]);

  if (!hasDirectory) {
    return html`
      <div class="gallery-empty">
        <i class="fa-solid fa-folder-plus"></i>
        <p>Connect a data root to load saved sketches.</p>
        <button class="btn btn-primary" onClick=${onPickDirectory}>
          <i class="fa-solid fa-folder-open"></i> Connect data root
        </button>
      </div>
    `;
  }

  if (projects.length === 0) {
    return html`
      <div class="gallery-empty">
        <i class="fa-solid fa-images"></i>
        <p>No sketches yet — head to <strong>Create</strong> and save one.</p>
      </div>
    `;
  }

  return html`
    <div class="gallery">
      <div class="gallery-controls">
        <input
          class="form-input"
          type="text"
          placeholder="Filter by title or notes..."
          value=${filter}
          onInput=${(e) => setFilter(e.target.value)}
        />
        <select class="form-input" value=${tagFilter} onChange=${(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          ${allTags.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
        </select>
        <span class="muted small">${filtered.length} / ${projects.length}</span>
      </div>

      <div class="gallery-grid">
        ${filtered.map(p => html`
          <div class="gallery-card" key=${p.id}>
            <div class="thumb" onClick=${() => onOpen(p.id)}>
              ${p.thumbnailUrl
                ? html`<img src=${p.thumbnailUrl} alt=${p.title} />`
                : html`<div class="thumb-empty"><i class="fa-solid fa-image"></i></div>`}
              ${p.parentId && html`<span class="lineage-badge" title="Remix of ${p.parentId}">⤷</span>`}
            </div>
            <div class="card-body">
              <div class="card-title" onClick=${() => onOpen(p.id)} title=${p.title}>${p.title}</div>
              <div class="card-meta">
                <span class="model-badge" title=${modelTooltip(p)}>${formatModelBadge(p)}</span>
                <span class="muted small">seed ${p.seed ?? '?'}</span>
              </div>
              ${(p.tags || []).length > 0 && html`
                <div class="tag-row">
                  ${p.tags.slice(0, 4).map(t => html`<span class="tag">${t}</span>`)}
                </div>
              `}
              <div class="card-actions">
                <button class="btn-icon" title="Open" onClick=${() => onOpen(p.id)}>
                  <i class="fa-solid fa-folder-open"></i>
                </button>
                <button
                  class=${`btn-icon ${compareIds?.includes(p.id) ? 'active' : ''}`}
                  title="Add to Compare"
                  onClick=${() => onAddToCompare(p.id)}
                >
                  <i class="fa-solid fa-columns"></i>
                </button>
                <button class="btn-icon" title="Remix" onClick=${() => onRemix(p.id)}>
                  <i class="fa-solid fa-code-branch"></i>
                </button>
                <button class="btn-icon" title="Delete" onClick=${() => onDelete(p.id)}>
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

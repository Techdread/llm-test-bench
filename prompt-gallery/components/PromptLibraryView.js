import { html } from 'htm/preact';
import { useState, useMemo } from 'preact/hooks';
import { CATEGORIES, categoryLabel, categoryIcon, statsForPrompt } from '../services/library.js';
import { RatingWidget } from './RatingWidget.js';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

function PromptCard({ prompt, stats, onUse, onRun, onEdit, onRemove, isGenerating, showCategory }) {
  const [expanded, setExpanded] = useState(false);
  const hasRuns = stats.runs > 0;

  return html`
    <div class="library-card">
      <div class="library-card-head">
        <span class="library-card-title" title=${prompt.title}>${prompt.title}</span>
        ${prompt.source === 'user'
          ? html`<span class="library-badge library-badge-user" title="Your prompt">yours</span>`
          : html`<span class="library-badge" title="Curated starter prompt">curated</span>`
        }
      </div>
      ${showCategory && html`
        <div class="library-card-category">
          <i class=${`fa-solid ${categoryIcon(prompt.category)}`}></i> ${categoryLabel(prompt.category)}
        </div>
      `}
      <div
        class=${`library-card-prompt ${expanded ? 'expanded' : ''}`}
        onClick=${() => setExpanded(e => !e)}
        title=${expanded ? 'Click to collapse' : 'Click to expand'}
      >${prompt.prompt}</div>
      ${expanded && prompt.notes && html`
        <div class="library-card-notes"><i class="fa-solid fa-circle-info"></i> ${prompt.notes}</div>
      `}
      ${(prompt.tags || []).length > 0 && html`
        <div class="gallery-card-tags">
          ${prompt.tags.slice(0, 5).map(t => html`<span class="tag-chip" key=${t}>${t}</span>`)}
        </div>
      `}
      <div class="library-card-stats">
        ${hasRuns
          ? html`
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span>${stats.runs} run${stats.runs === 1 ? '' : 's'} · ${stats.models} model${stats.models === 1 ? '' : 's'}</span>
              ${stats.bestRating > 0 && html`<span class="library-stats-rating">best <${RatingWidget} rating=${stats.bestRating} readonly size=${11} /></span>`}
              ${stats.lastRunAt && html`<span class="library-stats-date">${formatDate(stats.lastRunAt)}</span>`}
            `
          : html`<i class="fa-regular fa-circle"></i><span>never run</span>`
        }
      </div>
      <div class="library-card-actions">
        <button class="btn btn-sm" onClick=${() => onUse(prompt)} title="Load into the Create view">
          <i class="fa-solid fa-pen"></i> Use
        </button>
        <button
          class="btn btn-sm btn-primary"
          onClick=${() => onRun(prompt)}
          disabled=${isGenerating}
          title="Load into Create and generate with the current model"
        >
          <i class="fa-solid fa-bolt"></i> Run
        </button>
        <span class="library-card-actions-spacer"></span>
        <button class="btn-icon" onClick=${() => onEdit(prompt)} title="Edit prompt (previous text is kept as a revision)">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button
          class="btn-icon btn-icon-danger"
          onClick=${() => onRemove(prompt)}
          title=${prompt.source === 'user' ? 'Move to library trash (kept on disk)' : 'Hide this curated prompt'}
        >
          <i class=${`fa-solid ${prompt.source === 'user' ? 'fa-trash' : 'fa-eye-slash'}`}></i>
        </button>
      </div>
    </div>
  `;
}

export function PromptLibraryView({
  prompts,
  generations,
  hasDirectory,
  onPickDirectory,
  onUse,
  onRun,
  onAdd,
  onEdit,
  onRemove,
  onImport,
  importScanning,
  isGenerating,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const filtered = useMemo(() => {
    let list = prompts;
    if (category !== 'all') list = list.filter(p => p.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q)
        || (p.prompt || '').toLowerCase().includes(q)
        || (p.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [prompts, category, search]);

  const statsById = useMemo(() => {
    const map = new Map();
    for (const p of filtered) map.set(p.id, statsForPrompt(generations, p));
    return map;
  }, [filtered, generations]);

  // Group into category sections when showing everything; flat grid otherwise.
  const sections = useMemo(() => {
    if (category !== 'all') return [{ id: category, label: null, prompts: filtered }];
    return CATEGORIES
      .map(c => ({ id: c.id, label: c.label, icon: c.icon, prompts: filtered.filter(p => p.category === c.id) }))
      .concat([{
        id: 'other', label: 'Other', icon: 'fa-lightbulb',
        prompts: filtered.filter(p => !CATEGORIES.some(c => c.id === p.category)),
      }])
      .filter(s => s.prompts.length > 0);
  }, [filtered, category]);

  return html`
    <div class="library-view">
      <div class="library-bar">
        <div class="library-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input
            class="form-input"
            placeholder="Search prompts..."
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
          />
        </div>
        <div class="library-cat-chips">
          <button
            class=${`library-cat-chip ${category === 'all' ? 'active' : ''}`}
            onClick=${() => setCategory('all')}
          >All</button>
          ${CATEGORIES.map(c => html`
            <button
              key=${c.id}
              class=${`library-cat-chip ${category === c.id ? 'active' : ''}`}
              onClick=${() => setCategory(c.id)}
            ><i class=${`fa-solid ${c.icon}`}></i> ${c.label}</button>
          `)}
        </div>
        <span class="library-bar-spacer"></span>
        <button class="btn" onClick=${onImport} disabled=${importScanning} title="Scan saved generations and Three Prompt Lab for prompts to keep">
          <i class=${`fa-solid ${importScanning ? 'fa-spinner fa-spin' : 'fa-file-import'}`}></i>
          <span class="btn-label">Import...</span>
        </button>
        <button class="btn btn-primary" onClick=${onAdd} title="Add a new prompt to your library">
          <i class="fa-solid fa-plus"></i>
          <span class="btn-label">Add Prompt</span>
        </button>
      </div>

      ${!hasDirectory && html`
        <div class="library-dir-hint">
          <i class="fa-solid fa-circle-info"></i>
          Browsing the curated starter prompts. Connect a directory to save your own prompts and see run history.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Pick Directory</button>
        </div>
      `}

      ${sections.length === 0 && html`
        <div class="gallery-empty">
          <i class="fa-solid fa-book-open"></i>
          <p>No prompts match your filters</p>
        </div>
      `}

      ${sections.map(section => html`
        <div class="library-section" key=${section.id}>
          ${section.label && html`
            <div class="library-section-header">
              <i class=${`fa-solid ${section.icon}`}></i> ${section.label}
              <span class="library-section-count">${section.prompts.length}</span>
            </div>
          `}
          <div class="library-grid">
            ${section.prompts.map(p => html`
              <${PromptCard}
                key=${p.id}
                prompt=${p}
                stats=${statsById.get(p.id) || { runs: 0, models: 0, bestRating: 0, lastRunAt: '' }}
                onUse=${onUse}
                onRun=${onRun}
                onEdit=${onEdit}
                onRemove=${onRemove}
                isGenerating=${isGenerating}
                showCategory=${false}
              />
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}

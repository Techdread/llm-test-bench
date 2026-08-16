import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';
import { PROMPT_CATEGORIES, categoryInfo } from '../services/promptLibrary.js';

function PromptCard({ item, onUse, onRun, isGenerating }) {
  const [expanded, setExpanded] = useState(false);
  const category = categoryInfo(item.category);
  const count = Number(item.existingSubmissions) || 0;

  return html`
    <article class="svg-prompt-card">
      <div class="svg-prompt-card-head">
        <div>
          <h3>${item.title}</h3>
          <span class="svg-prompt-category"><i class=${`fa-solid ${category.icon}`}></i> ${category.label}</span>
        </div>
        <span class=${`tag-chip difficulty-${item.difficulty || 'moderate'}`}>${item.difficulty || 'moderate'}</span>
      </div>

      <button
        type="button"
        class=${`svg-prompt-copy ${expanded ? 'expanded' : ''}`}
        onClick=${() => setExpanded(value => !value)}
        title=${expanded ? 'Collapse prompt' : 'Read the full prompt'}
      >${item.prompt}</button>

      ${(item.tags || []).length > 0 && html`
        <div class="svg-prompt-tags">
          ${item.tags.slice(0, 6).map(tag => html`<span class="tag-chip" key=${tag}>${tag}</span>`)}
        </div>
      `}

      <div class="svg-prompt-stats">
        ${count > 0
          ? html`<span><i class="fa-solid fa-file-code"></i> ${count} saved submission${count === 1 ? '' : 's'}</span>`
          : html`<span><i class="fa-regular fa-circle"></i> Not run yet</span>`}
        ${item.hasReference && html`<span class="has-reference"><i class="fa-solid fa-image"></i> Reference</span>`}
      </div>

      <div class="svg-prompt-actions">
        <button type="button" class="btn btn-sm" onClick=${() => onUse(item)}>
          <i class="fa-solid fa-pen"></i> Use prompt
        </button>
        <button type="button" class="btn btn-sm btn-primary" onClick=${() => onRun(item)} disabled=${isGenerating}>
          <i class="fa-solid fa-bolt"></i> Generate
        </button>
      </div>
    </article>
  `;
}

export function PromptLibraryView({ prompts, onUse, onRun, onBatch, isGenerating }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [difficulty, setDifficulty] = useState('all');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (prompts || []).filter(item => {
      if (category !== 'all' && item.category !== category) return false;
      if (difficulty !== 'all' && item.difficulty !== difficulty) return false;
      if (!query) return true;
      return item.title.toLowerCase().includes(query)
        || item.prompt.toLowerCase().includes(query)
        || (item.tags || []).some(tag => tag.toLowerCase().includes(query));
    });
  }, [prompts, search, category, difficulty]);

  const categories = PROMPT_CATEGORIES.filter(info =>
    (prompts || []).some(item => item.category === info.id));

  return html`
    <div class="svg-prompt-library-view">
      <div class="svg-prompt-intro">
        <div>
          <p class="svg-prompt-eyebrow">Shared with Batch mode</p>
          <h2><i class="fa-solid fa-wand-magic-sparkles"></i> SVG prompt catalogue</h2>
          <p>Choose one challenge for the Create workspace, or run the same catalogue across a model in Batch.</p>
        </div>
        <div class="svg-prompt-summary">
          <span><strong>${prompts.length}</strong> prompts</span>
          <span><strong>${prompts.filter(item => item.existingSubmissions > 0).length}</strong> represented</span>
        </div>
      </div>

      <div class="svg-prompt-toolbar">
        <label class="svg-prompt-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input
            class="form-input"
            value=${search}
            onInput=${event => setSearch(event.target.value)}
            placeholder="Search prompts and techniques…"
          />
        </label>
        <select class="filter-select" value=${difficulty} onChange=${event => setDifficulty(event.target.value)}>
          <option value="all">All difficulties</option>
          <option value="simple">Simple</option>
          <option value="moderate">Moderate</option>
          <option value="complex">Complex</option>
          <option value="artistic">Artistic</option>
        </select>
        <button class="btn btn-batch" onClick=${onBatch}>
          <i class="fa-solid fa-layer-group"></i> Batch these prompts
        </button>
      </div>

      <div class="svg-prompt-category-chips">
        <button class=${`prompt-category-chip ${category === 'all' ? 'active' : ''}`} onClick=${() => setCategory('all')}>All</button>
        ${categories.map(info => html`
          <button
            key=${info.id}
            class=${`prompt-category-chip ${category === info.id ? 'active' : ''}`}
            onClick=${() => setCategory(info.id)}
          ><i class=${`fa-solid ${info.icon}`}></i> ${info.label}</button>
        `)}
      </div>

      <div class="svg-prompt-results">
        <div class="svg-prompt-results-head">
          <span>${filtered.length} matching prompt${filtered.length === 1 ? '' : 's'}</span>
          ${(search || category !== 'all' || difficulty !== 'all') && html`
            <button class="btn btn-xs" onClick=${() => { setSearch(''); setCategory('all'); setDifficulty('all'); }}>Clear filters</button>
          `}
        </div>
        ${filtered.length > 0
          ? html`<div class="svg-prompt-grid">
              ${filtered.map(item => html`
                <${PromptCard}
                  key=${item.id || item.slug}
                  item=${item}
                  onUse=${onUse}
                  onRun=${onRun}
                  isGenerating=${isGenerating}
                />
              `)}
            </div>`
          : html`<div class="gallery-empty"><i class="fa-solid fa-book-open"></i><p>No prompts match those filters.</p></div>`}
      </div>
    </div>
  `;
}

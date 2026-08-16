import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';
import { PROMPT_CATEGORIES, categoryInfo } from '../services/promptLibrary.js';

function PromptCard({ item, onUse, onRun, isGenerating }) {
  const [expanded, setExpanded] = useState(false);
  const category = categoryInfo(item.category);

  return html`
    <article class="prompt-library-card">
      <div class="prompt-library-card-head">
        <div>
          <h3>${item.title}</h3>
          <span class="prompt-category-label"><i class=${`fa-solid ${category.icon}`}></i> ${category.label}</span>
        </div>
        <span class=${`prompt-source-badge ${item.source === 'gallery' ? 'from-gallery' : ''}`}>
          ${item.source === 'gallery' ? 'from gallery' : 'curated'}
        </span>
      </div>

      <button
        type="button"
        class=${`prompt-library-copy ${expanded ? 'expanded' : ''}`}
        onClick=${() => setExpanded(value => !value)}
        title=${expanded ? 'Collapse prompt' : 'Read the full prompt'}
      >${item.prompt}</button>

      ${expanded && item.notes && html`
        <div class="prompt-library-notes"><i class="fa-solid fa-circle-info"></i> ${item.notes}</div>
      `}

      <div class="prompt-library-tags">
        ${(item.tags || []).slice(0, 6).map(tag => html`<span class="tag" key=${tag}>${tag}</span>`)}
      </div>

      <div class="prompt-library-stats">
        ${item.savedCount > 0
          ? html`<i class="fa-solid fa-images"></i> Used by ${item.savedCount} saved sketch${item.savedCount === 1 ? '' : 'es'}`
          : html`<i class="fa-regular fa-circle"></i> Not in your gallery yet`}
      </div>

      <div class="prompt-library-actions">
        <button class="btn btn-sm" onClick=${() => onUse(item)}>
          <i class="fa-solid fa-pen"></i> Use
        </button>
        <button class="btn btn-sm btn-primary" onClick=${() => onRun(item)} disabled=${isGenerating}>
          <i class="fa-solid fa-bolt"></i> Generate
        </button>
      </div>
    </article>
  `;
}

export function PromptLibraryView({
  prompts,
  loading,
  hasDirectory,
  onPickDirectory,
  onRefresh,
  onUse,
  onRun,
  isGenerating,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (prompts || []).filter(item => {
      if (category !== 'all' && item.category !== category) return false;
      if (!query) return true;
      return item.title.toLowerCase().includes(query)
        || item.prompt.toLowerCase().includes(query)
        || (item.tags || []).some(tag => tag.toLowerCase().includes(query));
    });
  }, [prompts, search, category]);

  const sections = useMemo(() => {
    if (category !== 'all') return [{ ...categoryInfo(category), prompts: filtered }];
    const known = PROMPT_CATEGORIES.map(info => ({
      ...info,
      prompts: filtered.filter(item => item.category === info.id),
    })).filter(section => section.prompts.length);
    const other = filtered.filter(item => !PROMPT_CATEGORIES.some(info => info.id === item.category));
    if (other.length) known.push({ id: 'other', label: 'Other', icon: 'fa-wand-magic-sparkles', prompts: other });
    return known;
  }, [filtered, category]);

  const curatedCount = (prompts || []).filter(item => item.source === 'curated').length;
  const galleryCount = (prompts || []).filter(item => item.source === 'gallery' || item.savedCount > 0).length;

  return html`
    <div class="prompt-library-view">
      <div class="prompt-library-intro">
        <div>
          <h2><i class="fa-solid fa-wand-magic-sparkles"></i> Curated p5.js prompts</h2>
          <p>Production-sized ideas for simulations, shaders, creative tools and playable experiments — shaped for this gallery's p5 runner.</p>
        </div>
        <div class="prompt-library-counts">
          <span><strong>${curatedCount}</strong> curated</span>
          <span><strong>${galleryCount}</strong> represented in gallery</span>
        </div>
      </div>

      <div class="prompt-library-toolbar">
        <label class="prompt-library-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input
            class="form-input"
            value=${search}
            onInput=${event => setSearch(event.target.value)}
            placeholder="Search prompts, techniques, tags…"
          />
        </label>
        <div class="prompt-category-chips">
          <button class=${`prompt-category-chip ${category === 'all' ? 'active' : ''}`} onClick=${() => setCategory('all')}>All</button>
          ${PROMPT_CATEGORIES.map(info => html`
            <button
              key=${info.id}
              class=${`prompt-category-chip ${category === info.id ? 'active' : ''}`}
              onClick=${() => setCategory(info.id)}
            ><i class=${`fa-solid ${info.icon}`}></i> ${info.label}</button>
          `)}
        </div>
        <button class="btn" onClick=${onRefresh} disabled=${loading || !hasDirectory} title="Rescan saved sketch prompts">
          <i class=${`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
          <span class="btn-label">Rescan gallery</span>
        </button>
      </div>

      ${!hasDirectory && html`
        <div class="prompt-library-hint">
          <i class="fa-solid fa-circle-info"></i>
          The curated catalogue works now. Connect your data root to merge in unique prompts from saved sketches.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Connect</button>
        </div>
      `}

      ${loading && html`<div class="prompt-library-loading"><i class="fa-solid fa-spinner fa-spin"></i> Scanning saved sketch prompts…</div>`}

      ${!loading && sections.length === 0 && html`
        <div class="gallery-empty"><i class="fa-solid fa-book-open"></i><p>No prompts match those filters.</p></div>
      `}

      <div class="prompt-library-scroll">
        ${sections.map(section => html`
          <section class="prompt-library-section" key=${section.id}>
            <div class="prompt-library-section-title">
              <i class=${`fa-solid ${section.icon}`}></i>
              <span>${section.label}</span>
              <span class="prompt-library-section-count">${section.prompts.length}</span>
            </div>
            <div class="prompt-library-grid">
              ${section.prompts.map(item => html`
                <${PromptCard}
                  key=${item.id}
                  item=${item}
                  onUse=${onUse}
                  onRun=${onRun}
                  isGenerating=${isGenerating}
                />
              `)}
            </div>
          </section>
        `)}
      </div>
    </div>
  `;
}


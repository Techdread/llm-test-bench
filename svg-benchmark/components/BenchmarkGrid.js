import { html } from 'htm/preact';
import { useState, useCallback } from 'preact/hooks';

export function BenchmarkGrid({
  benchmarks,
  onSelect,
  onCreateNew,
  onRefresh,
  hasDirectory,
  onPickDirectory,
}) {
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');

  const filtered = (benchmarks || []).filter(b => {
    if (filter) {
      const q = filter.toLowerCase();
      if (!b.prompt.toLowerCase().includes(q) && !b.slug.toLowerCase().includes(q)) return false;
    }
    if (categoryFilter !== 'all' && b.meta.category !== categoryFilter) return false;
    if (difficultyFilter !== 'all' && b.meta.difficulty !== difficultyFilter) return false;
    return true;
  });

  // Collect unique categories and difficulties
  const categories = [...new Set((benchmarks || []).map(b => b.meta.category).filter(Boolean))];
  const difficulties = ['simple', 'moderate', 'complex', 'artistic'];

  if (!hasDirectory) {
    return html`
      <div class="gallery-empty">
        <i class="fa-solid fa-folder-open"></i>
        <p>Connect a directory to start benchmarking</p>
        <button class="btn btn-primary" onClick=${onPickDirectory}>
          <i class="fa-solid fa-folder-open"></i> Open Directory
        </button>
      </div>
    `;
  }

  return html`
    <div class="benchmark-grid-view">
      <div class="filter-bar">
        <div class="filter-search-wrapper">
          <i class="fa-solid fa-search"></i>
          <input
            class="filter-search"
            type="text"
            value=${filter}
            onInput=${(e) => setFilter(e.target.value)}
            placeholder="Search benchmarks..."
          />
        </div>
        <select class="filter-select" value=${categoryFilter} onChange=${(e) => setCategoryFilter(e.target.value)}>
          <option value="all">All Categories</option>
          ${categories.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
        </select>
        <select class="filter-select" value=${difficultyFilter} onChange=${(e) => setDifficultyFilter(e.target.value)}>
          <option value="all">All Difficulties</option>
          ${difficulties.map(d => html`<option key=${d} value=${d}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`)}
        </select>
        <button class="btn" onClick=${onRefresh} title="Refresh benchmarks">
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button class="btn btn-primary" onClick=${onCreateNew}>
          <i class="fa-solid fa-plus"></i>
          <span class="btn-label">New Benchmark</span>
        </button>
      </div>

      ${filtered.length > 0
        ? html`
          <div class="benchmark-grid">
            ${filtered.map(b => html`
              <div class="benchmark-card" key=${b.slug} onClick=${() => onSelect(b.slug)}>
                <div class="benchmark-card-header">
                  <span class="benchmark-card-prompt">${b.prompt || b.slug}</span>
                </div>
                <div class="benchmark-card-meta">
                  ${b.meta.category && html`
                    <span class="tag-chip">${b.meta.category}</span>
                  `}
                  ${b.meta.difficulty && html`
                    <span class="tag-chip difficulty-${b.meta.difficulty}">${b.meta.difficulty}</span>
                  `}
                </div>
                <div class="benchmark-card-footer">
                  <span class="benchmark-stat">
                    <i class="fa-solid fa-file-code"></i> ${b.submissionCount} submission${b.submissionCount !== 1 ? 's' : ''}
                  </span>
                  ${b.bestScore != null && html`
                    <span class="benchmark-stat score">
                      <i class="fa-solid fa-bullseye"></i> ${Math.round(b.bestScore * 100)}%
                    </span>
                  `}
                  ${b.hasReference && html`
                    <span class="benchmark-stat ref">
                      <i class="fa-solid fa-image"></i> Ref
                    </span>
                  `}
                </div>
              </div>
            `)}
          </div>
        `
        : html`
          <div class="gallery-empty">
            <i class="fa-solid fa-bezier-curve"></i>
            <p>${filter || categoryFilter !== 'all' || difficultyFilter !== 'all'
              ? 'No benchmarks match your filters'
              : 'No benchmarks yet. Create one to get started!'
            }</p>
            ${!filter && categoryFilter === 'all' && difficultyFilter === 'all' && html`
              <button class="btn btn-primary" onClick=${onCreateNew}>
                <i class="fa-solid fa-plus"></i> Create First Benchmark
              </button>
            `}
          </div>
        `
      }
    </div>
  `;
}

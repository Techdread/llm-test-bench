import { html } from 'htm/preact';

const COLLECTIONS = [
  { id: 'all', label: 'All', icon: 'fa-layer-group' },
  { id: 'unreviewed', label: 'Unreviewed', icon: 'fa-inbox' },
  { id: 'favorites', label: 'Favorites', icon: 'fa-star' },
  { id: 'recent', label: 'Recent', icon: 'fa-clock' },
  { id: 'refined', label: 'Refined', icon: 'fa-screwdriver-wrench' },
  { id: 'archived', label: 'Archived', icon: 'fa-box-archive' },
];

export function FilterBar({
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  filterModel,
  onFilterModelChange,
  filterTag,
  onFilterTagChange,
  minRating,
  onMinRatingChange,
  collection,
  onCollectionChange,
  models,
  tags,
  collectionCounts,
  resultCount,
  onClear,
}) {
  const hasFilters = Boolean(search || filterModel || filterTag || Number(minRating) > 0 || collection !== 'all');

  return html`
    <div class="gallery-controls">
      <div class="filter-bar">
        <div class="gallery-view-toggle" role="group" aria-label="Gallery view">
          <button
            class=${viewMode === 'projects' ? 'active' : ''}
            onClick=${() => onViewModeChange('projects')}
            title="Group generations by prompt project"
          ><i class="fa-solid fa-folder-tree"></i><span>Projects</span></button>
          <button
            class=${viewMode === 'variants' ? 'active' : ''}
            onClick=${() => onViewModeChange('variants')}
            title="Show every generation"
          ><i class="fa-solid fa-images"></i><span>Variants</span></button>
        </div>

        <div class="filter-search-wrapper">
          <i class="fa-solid fa-search"></i>
          <input
            class="filter-search"
            type="search"
            placeholder="Search projects, prompts, notes, tags or models"
            value=${search}
            onInput=${event => onSearchChange(event.target.value)}
          />
        </div>

        <select class="filter-select" value=${filterModel} onChange=${event => onFilterModelChange(event.target.value)} title="Filter by model">
          <option value="">All models</option>
          ${models.map(model => html`<option key=${model} value=${model}>${model}</option>`)}
        </select>
        <select class="filter-select" value=${filterTag} onChange=${event => onFilterTagChange(event.target.value)} title="Filter by tag">
          <option value="">All tags</option>
          ${tags.map(tag => html`<option key=${tag} value=${tag}>${tag}</option>`)}
        </select>
        <select class="filter-select" value=${minRating} onChange=${event => onMinRatingChange(Number(event.target.value))} title="Minimum rating">
          <option value="0">Any rating</option>
          <option value="3">3+ stars</option>
          <option value="4">4+ stars</option>
          <option value="5">5 stars</option>
        </select>
        <select class="filter-select" value=${sortBy} onChange=${event => onSortChange(event.target.value)} title="Sort results">
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="rating-desc">Highest rated</option>
          <option value="rating-asc">Lowest rated</option>
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          ${viewMode === 'projects' && html`<option value="variants-desc">Most variants</option>`}
        </select>
        <button class="btn-icon" onClick=${onClear} disabled=${!hasFilters} title="Clear gallery filters">
          <i class="fa-solid fa-filter-circle-xmark"></i>
        </button>
      </div>

      <div class="gallery-collection-bar">
        <div class="gallery-collection-tabs" role="group" aria-label="Review collection">
          ${COLLECTIONS.map(item => html`
            <button
              key=${item.id}
              class=${collection === item.id ? 'active' : ''}
              onClick=${() => onCollectionChange(item.id)}
            >
              <i class=${`fa-solid ${item.icon}`}></i>
              <span>${item.label}</span>
              <span class="collection-count">${collectionCounts[item.id] || 0}</span>
            </button>
          `)}
        </div>
        <span class="gallery-result-count">${resultCount} ${viewMode === 'projects' ? 'project' : 'variant'}${resultCount === 1 ? '' : 's'}</span>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RatingWidget } from './RatingWidget.js';
import { FilterBar } from './FilterBar.js';
import {
  collectGalleryFacets,
  filterProjects,
  filterVariants,
  groupGenerationsByFolder,
  modelLabel,
  sortProjects,
  sortVariants,
} from '../services/gallery.js';

const MAX_LIVE_THUMBS = 6;
const OFFSCREEN_UNMOUNT_MS = 1500;
const VIEW_PREF_KEY = 'prompt-gallery-gallery-view';
const subscribers = new Map();
const liveQueue = [];

function tryActivate(id) {
  const sub = subscribers.get(id);
  if (!sub) return;
  const idx = liveQueue.indexOf(id);
  if (idx >= 0) {
    liveQueue.splice(idx, 1);
    liveQueue.push(id);
    return;
  }
  while (liveQueue.length >= MAX_LIVE_THUMBS) {
    const oldId = liveQueue.shift();
    subscribers.get(oldId)?.setLive(false);
  }
  liveQueue.push(id);
  sub.setLive(true);
}

function deactivate(id) {
  const idx = liveQueue.indexOf(id);
  if (idx >= 0) liveQueue.splice(idx, 1);
  subscribers.get(id)?.setLive(false);
}

function LazyThumb({ id, srcdoc, title }) {
  const [live, setLive] = useState(false);
  const wrapRef = useRef(null);
  const offTimerRef = useRef(null);

  useEffect(() => {
    subscribers.set(id, { setLive });
    return () => {
      subscribers.delete(id);
      deactivate(id);
      clearTimeout(offTimerRef.current);
    };
  }, [id]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          clearTimeout(offTimerRef.current);
          tryActivate(id);
        } else {
          clearTimeout(offTimerRef.current);
          offTimerRef.current = setTimeout(() => deactivate(id), OFFSCREEN_UNMOUNT_MS);
        }
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [id]);

  return html`
    <div class="gallery-thumb" ref=${wrapRef}>
      ${live
        ? html`<iframe srcdoc=${srcdoc || ''} sandbox="allow-scripts" title=${title} tabindex="-1"></iframe>`
        : html`<div class="gallery-thumb-placeholder"><i class="fa-solid fa-image"></i></div>`
      }
    </div>
  `;
}

function formatDate(dateStr, includeTime = false) {
  if (!dateStr) return 'Unknown date';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', includeTime
      ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function shortVariantKey(variantKey) {
  const key = String(variantKey || 'legacy');
  const suffix = key.includes('_') ? key.split('_').at(-1) : key;
  return suffix.slice(-6);
}

function ProjectCard({ project, onOpen }) {
  const representative = project.representative;
  return html`
    <article
      class=${`gallery-card project-card ${project.archived ? 'is-archived' : ''}`}
      role="button"
      tabIndex="0"
      aria-label=${`Open project ${project.title}`}
      onClick=${() => onOpen(project.folderId)}
      onKeyDown=${event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(project.folderId);
        }
      }}
    >
      <${LazyThumb}
        id=${`project:${project.folderId}:${representative?.id || 'empty'}`}
        srcdoc=${representative?.response || ''}
        title=${project.title}
      />
      <div class="gallery-card-body">
        <div class="project-card-heading">
          <div class="gallery-card-title" title=${project.title}>${project.title}</div>
          ${project.archived && html`<span class="status-badge archived"><i class="fa-solid fa-box-archive"></i> Archived</span>`}
        </div>
        <div class="project-summary">
          <span><i class="fa-solid fa-code-branch"></i> ${project.variantCount} variant${project.variantCount === 1 ? '' : 's'}</span>
          <span><i class="fa-solid fa-robot"></i> ${project.models.length} model${project.models.length === 1 ? '' : 's'}</span>
          ${project.unreviewedCount > 0 && html`<span class="needs-review"><i class="fa-solid fa-inbox"></i> ${project.unreviewedCount} unreviewed</span>`}
        </div>
        <div class="gallery-card-meta">
          <${RatingWidget} rating=${project.bestRating} readonly size=${12} />
          <span class="gallery-card-date">Updated ${formatDate(project.latestAt)}</span>
          ${project.refinedCount > 0 && html`<span class="status-badge"><i class="fa-solid fa-screwdriver-wrench"></i> ${project.refinedCount}</span>`}
        </div>
        ${project.prompt && html`<p class="project-prompt-excerpt">${project.prompt}</p>`}
        ${project.tags.length > 0 && html`
          <div class="gallery-card-tags">
            ${project.tags.slice(0, 3).map(tag => html`<span class="tag-chip" key=${tag}>${tag}</span>`)}
            ${project.tags.length > 3 && html`<span class="tag-chip">+${project.tags.length - 3}</span>`}
          </div>
        `}
      </div>
    </article>
  `;
}

function VariantCard({ generation, projectTitle, onSelect, onMorph, onDelete, onArchive, onCompare }) {
  const meta = generation.metadata || {};
  const archived = Boolean(meta.archivedAt);
  const refined = Boolean(meta.derivedFrom || meta.refine?.kind);
  const model = modelLabel(generation);

  return html`
    <article class=${`gallery-card variant-card ${archived ? 'is-archived' : ''}`}>
      <div
        class="variant-card-preview"
        role="button"
        tabIndex="0"
        onClick=${() => onSelect(generation.id, generation.folderId)}
        onKeyDown=${event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(generation.id, generation.folderId);
          }
        }}
        title="Open generation"
      >
        <${LazyThumb} id=${generation.id} srcdoc=${generation.response} title=${`${projectTitle} - ${model}`} />
      </div>
      <div class="gallery-card-body">
        <div class="variant-card-heading">
          <div>
            <div class="gallery-card-title" title=${projectTitle}>${projectTitle}</div>
            <div class="variant-model" title=${model}><i class="fa-solid fa-robot"></i> ${model}</div>
          </div>
          <span class="variant-key" title=${generation.variantKey || 'Legacy generation'}>#${shortVariantKey(generation.variantKey)}</span>
        </div>
        <div class="gallery-card-meta">
          <${RatingWidget} rating=${meta.rating || 0} readonly size=${12} />
          <span class="gallery-card-date">${formatDate(meta.createdAt, true)}</span>
          ${refined && html`<span class="status-badge"><i class="fa-solid fa-screwdriver-wrench"></i> Refined</span>`}
          ${archived && html`<span class="status-badge archived"><i class="fa-solid fa-box-archive"></i> Archived</span>`}
        </div>
        ${(meta.tags || []).length > 0 && html`
          <div class="gallery-card-tags">
            ${meta.tags.slice(0, 3).map(tag => html`<span class="tag-chip" key=${tag}>${tag}</span>`)}
            ${meta.tags.length > 3 && html`<span class="tag-chip">+${meta.tags.length - 3}</span>`}
          </div>
        `}
        <div class="variant-card-actions">
          <button class="btn-icon" onClick=${() => onSelect(generation.id, generation.folderId)} title="Open generation"><i class="fa-solid fa-up-right-from-square"></i></button>
          ${onCompare && html`<button class="btn-icon" onClick=${() => onCompare(generation.id)} title="Add to comparison"><i class="fa-solid fa-columns"></i></button>`}
          ${onMorph && html`<button class="btn-icon" onClick=${() => onMorph(generation.id)} title="Morph"><i class="fa-solid fa-wand-magic-sparkles"></i></button>`}
          ${onArchive && html`
            <button class="btn-icon" onClick=${() => onArchive([generation.id], !archived)} title=${archived ? 'Restore from archive' : 'Archive'}>
              <i class=${`fa-solid ${archived ? 'fa-box-open' : 'fa-box-archive'}`}></i>
            </button>
          `}
          ${onDelete && html`<button class="btn-icon btn-icon-danger" onClick=${() => onDelete(generation.id)} title="Delete"><i class="fa-solid fa-trash"></i></button>`}
        </div>
      </div>
    </article>
  `;
}

function ProjectDetail({ project, onBack, onSelect, onMorph, onDelete, onArchive, onCompare }) {
  const [showArchived, setShowArchived] = useState(false);
  const visibleVariants = project.variants.filter(generation => showArchived || !generation.metadata?.archivedAt);

  return html`
    <div class="project-detail">
      <header class="project-detail-header">
        <button class="btn-icon project-back" onClick=${onBack} title="Back to projects"><i class="fa-solid fa-arrow-left"></i></button>
        <div class="project-detail-copy">
          <div class="project-detail-title-row">
            <h2>${project.title}</h2>
            ${project.archived && html`<span class="status-badge archived"><i class="fa-solid fa-box-archive"></i> Archived</span>`}
          </div>
          <div class="project-detail-stats">
            <span>${project.variantCount} variant${project.variantCount === 1 ? '' : 's'}</span>
            <span>${project.models.length} model${project.models.length === 1 ? '' : 's'}</span>
            <span>Best ${project.bestRating || 0}/5</span>
            <span>Updated ${formatDate(project.latestAt)}</span>
          </div>
        </div>
        <div class="project-detail-actions">
          ${project.containsArchived && html`
            <label class="archive-toggle">
              <input type="checkbox" checked=${showArchived} onChange=${event => setShowArchived(event.target.checked)} />
              Show archived
            </label>
          `}
          ${onArchive && html`
            <button class="btn" onClick=${() => onArchive(project.variants.map(generation => generation.id), !project.archived)}>
              <i class=${`fa-solid ${project.archived ? 'fa-box-open' : 'fa-box-archive'}`}></i>
              ${project.archived ? 'Restore project' : 'Archive project'}
            </button>
          `}
        </div>
      </header>

      ${project.prompt && html`
        <details class="project-prompt" open>
          <summary>Original prompt</summary>
          <p>${project.prompt}</p>
        </details>
      `}

      <div class="project-variant-heading">
        <h3>Variants</h3>
        <span>${visibleVariants.length} shown</span>
      </div>
      ${visibleVariants.length === 0
        ? html`<div class="gallery-empty compact"><i class="fa-solid fa-box-archive"></i><p>All variants are archived</p></div>`
        : html`
          <div class="gallery-grid variant-grid">
            ${visibleVariants.map(generation => html`
              <${VariantCard}
                key=${generation.id}
                generation=${generation}
                projectTitle=${project.title}
                onSelect=${onSelect}
                onMorph=${onMorph}
                onDelete=${onDelete}
                onArchive=${onArchive}
                onCompare=${onCompare}
              />
            `)}
          </div>
        `
      }
    </div>
  `;
}

export function GalleryView({
  generations,
  selectedFolder,
  onOpenProject,
  onBackProject,
  onSelect,
  hasDirectory,
  onPickDirectory,
  onMorph,
  onDelete,
  onArchive,
  onCompare,
}) {
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_PREF_KEY) === 'variants' ? 'variants' : 'projects';
    } catch (e) {
      return 'projects';
    }
  });
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const [filterModel, setFilterModel] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [collection, setCollection] = useState('all');

  const projects = useMemo(() => groupGenerationsByFolder(generations), [generations]);
  const facets = useMemo(() => collectGalleryFacets(generations), [generations]);
  const filters = { query: search, collection, model: filterModel, tag: filterTag, minRating };
  const filteredProjects = useMemo(() => sortProjects(filterProjects(projects, filters), sortBy), [projects, search, collection, filterModel, filterTag, minRating, sortBy]);
  const filteredVariants = useMemo(() => sortVariants(filterVariants(generations, filters), sortBy), [generations, search, collection, filterModel, filterTag, minRating, sortBy]);
  const projectByFolder = useMemo(() => new Map(projects.map(project => [project.folderId, project])), [projects]);
  const selectedProject = selectedFolder ? projectByFolder.get(selectedFolder) : null;

  const collectionCounts = useMemo(() => {
    const ids = ['all', 'unreviewed', 'favorites', 'recent', 'refined', 'archived'];
    return Object.fromEntries(ids.map(id => {
      const count = viewMode === 'projects'
        ? filterProjects(projects, { collection: id }).length
        : filterVariants(generations, { collection: id }).length;
      return [id, count];
    }));
  }, [projects, generations, viewMode]);

  const changeViewMode = mode => {
    setViewMode(mode);
    if (sortBy === 'variants-desc' && mode === 'variants') setSortBy('date-desc');
    try { localStorage.setItem(VIEW_PREF_KEY, mode); } catch (e) { /* optional preference */ }
  };

  const clearFilters = () => {
    setSearch('');
    setFilterModel('');
    setFilterTag('');
    setMinRating(0);
    setCollection('all');
  };

  if (!hasDirectory) {
    return html`
      <div class="gallery-view">
        <div class="gallery-empty">
          <i class="fa-solid fa-folder-open"></i>
          <p>Connect a directory to browse your prompt generations</p>
          <button class="btn btn-primary" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Pick Directory</button>
        </div>
      </div>
    `;
  }

  if (selectedFolder && selectedProject) {
    return html`
      <div class="gallery-view">
        <${ProjectDetail}
          project=${selectedProject}
          onBack=${onBackProject}
          onSelect=${onSelect}
          onMorph=${onMorph}
          onDelete=${onDelete}
          onArchive=${onArchive}
          onCompare=${onCompare}
        />
      </div>
    `;
  }

  return html`
    <div class="gallery-view">
      <${FilterBar}
        viewMode=${viewMode}
        onViewModeChange=${changeViewMode}
        search=${search}
        onSearchChange=${setSearch}
        sortBy=${sortBy}
        onSortChange=${setSortBy}
        filterModel=${filterModel}
        onFilterModelChange=${setFilterModel}
        filterTag=${filterTag}
        onFilterTagChange=${setFilterTag}
        minRating=${minRating}
        onMinRatingChange=${setMinRating}
        collection=${collection}
        onCollectionChange=${setCollection}
        models=${facets.models}
        tags=${facets.tags}
        collectionCounts=${collectionCounts}
        resultCount=${viewMode === 'projects' ? filteredProjects.length : filteredVariants.length}
        onClear=${clearFilters}
      />

      ${(viewMode === 'projects' ? filteredProjects.length : filteredVariants.length) === 0
        ? html`
          <div class="gallery-empty">
            <i class="fa-solid fa-images"></i>
            ${generations.length === 0 ? html`<p>No generations yet. Create your first one!</p>` : html`<p>No generations match your filters</p>`}
            ${generations.length > 0 && html`<button class="btn" onClick=${clearFilters}><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button>`}
          </div>
        `
        : viewMode === 'projects'
          ? html`
            <div class="gallery-grid project-grid">
              ${filteredProjects.map(project => html`<${ProjectCard} key=${project.id} project=${project} onOpen=${onOpenProject} />`)}
            </div>
          `
          : html`
            <div class="gallery-grid variant-grid">
              ${filteredVariants.map(generation => html`
                <${VariantCard}
                  key=${generation.id}
                  generation=${generation}
                  projectTitle=${projectByFolder.get(generation.folderId)?.title || generation.folderId || generation.id}
                  onSelect=${onSelect}
                  onMorph=${onMorph}
                  onDelete=${onDelete}
                  onArchive=${onArchive}
                  onCompare=${onCompare}
                />
              `)}
            </div>
          `
      }
    </div>
  `;
}

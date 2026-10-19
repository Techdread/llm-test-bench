// Searchable notebook library for tutorials, examples, and saved notebooks.

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useDialogDismiss } from './useDialogDismiss.js';
import {
  DEFAULT_LIBRARY_PREFS,
  LIBRARY_FAVOURITES_KEY,
  LIBRARY_PREFS_KEY,
  LIBRARY_RECENTS_KEY,
  collectLanguages,
  countLibraryItems,
  createLibraryItems,
  filterLibraryItems,
  loadJsonPreference,
  normaliseCategories,
  recordRecent,
} from '../services/notebookLibrary.js';

const LANG_BADGES = {
  js: 'JS', py: 'Py', c: 'C', rust: 'Rust', lua: 'Lua',
  java: 'Java', go: 'Go', scala: 'Scala', clojure: 'Clj',
  html: 'HTML', ui: 'UI', chart: 'Chart',
};

const TYPE_ICONS = {
  tutorial: 'fa-graduation-cap',
  example: 'fa-flask',
  saved: 'fa-book',
};

function LangBadges({ langs = [] }) {
  if (!langs.length) return null;
  return html`
    <span class="notebook-library-badges">
      ${langs.map(lang => html`
        <span class="notebook-library-lang" key=${lang}>${LANG_BADGES[lang] || lang}</span>
      `)}
    </span>
  `;
}

function SidebarButton({ active, count, icon, label, viewId, onClick }) {
  return html`
    <button class=${`notebook-library-nav-item ${active ? 'active' : ''}`} data-library-view=${viewId} onClick=${onClick} aria-label=${label}>
      <span><i class=${`fa-solid ${icon}`}></i>${label}</span>
      <span class="notebook-library-count">${count}</span>
    </button>
  `;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function NotebookPickerDialog({
  list,
  tutorials = [],
  examples = [],
  categories = [],
  onOpen,
  onOpenTutorial,
  onOpenExample,
  onNew,
  onDelete,
  onClose,
  hasDirectory,
  onPickDirectory,
}) {
  const initialPrefs = loadJsonPreference(globalThis.localStorage, LIBRARY_PREFS_KEY, DEFAULT_LIBRARY_PREFS);
  const [view, setView] = useState(initialPrefs.view || 'all');
  const [query, setQuery] = useState(initialPrefs.query || '');
  const [language, setLanguage] = useState(initialPrefs.language || 'all');
  const [sort, setSort] = useState(initialPrefs.sort || 'relevance');
  const [favourites, setFavourites] = useState(() => loadJsonPreference(globalThis.localStorage, LIBRARY_FAVOURITES_KEY, []));
  const [recents, setRecents] = useState(() => loadJsonPreference(globalThis.localStorage, LIBRARY_RECENTS_KEY, []));

  const items = useMemo(() => createLibraryItems({ saved: list, tutorials, examples }), [list, tutorials, examples]);
  const categoryList = useMemo(() => normaliseCategories(categories, examples), [categories, examples]);
  const counts = useMemo(() => countLibraryItems(items), [items]);
  const languages = useMemo(() => collectLanguages(items), [items]);
  const visibleItems = useMemo(() => filterLibraryItems(items, {
    view, query, language, sort, favourites, recents,
  }), [items, view, query, language, sort, favourites, recents]);
  const knownKeys = useMemo(() => new Set(items.map(item => item.key)), [items]);
  const favouriteCount = favourites.filter(key => knownKeys.has(key)).length;
  const recentCount = recents.filter(entry => knownKeys.has(typeof entry === 'string' ? entry : entry.key)).length;

  useEffect(() => {
    globalThis.localStorage?.setItem(LIBRARY_PREFS_KEY, JSON.stringify({ view, query, language, sort }));
  }, [view, query, language, sort]);
  useEffect(() => {
    globalThis.localStorage?.setItem(LIBRARY_FAVOURITES_KEY, JSON.stringify(favourites));
  }, [favourites]);
  useEffect(() => {
    globalThis.localStorage?.setItem(LIBRARY_RECENTS_KEY, JSON.stringify(recents));
  }, [recents]);

  useDialogDismiss(onClose);

  const openItem = (item) => {
    setRecents(current => recordRecent(current, item.key));
    if (item.type === 'tutorial') onOpenTutorial(item.file);
    else if (item.type === 'example') onOpenExample(item.file);
    else onOpen(item.id);
  };

  const toggleFavourite = (key) => {
    setFavourites(current => current.includes(key)
      ? current.filter(itemKey => itemKey !== key)
      : [...current, key]);
  };

  const activeCategory = view.startsWith('category:')
    ? categoryList.find(category => category.id === view.slice(9))
    : null;
  const heading = activeCategory?.label || ({
    all: 'All notebooks', recent: 'Recently opened', favourites: 'Favourites',
    tutorials: 'Tutorials', examples: 'All examples', saved: 'My notebooks',
  }[view] || 'Notebooks');
  const hasFilters = query || language !== 'all';

  return html`
    <div class="modal-overlay">
      <div class="modal notebook-library-modal" onClick=${event => event.stopPropagation()}>
        <div class="modal-header notebook-library-header">
          <div>
            <h2><i class="fa-solid fa-folder-open"></i>Notebook Library</h2>
            <p>Browse tutorials, examples, and your saved work.</p>
          </div>
          <button class="btn-icon" onClick=${onClose} aria-label="Close notebook library"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="notebook-library-shell">
          <aside class="notebook-library-sidebar" aria-label="Notebook library sections">
            <div class="notebook-library-nav-group">
              <div class="notebook-library-nav-title">Library</div>
              <${SidebarButton} viewId="all" active=${view === 'all'} count=${counts.all} icon="fa-layer-group" label="All notebooks" onClick=${() => setView('all')} />
              <${SidebarButton} viewId="recent" active=${view === 'recent'} count=${recentCount} icon="fa-clock-rotate-left" label="Recent" onClick=${() => setView('recent')} />
              <${SidebarButton} viewId="favourites" active=${view === 'favourites'} count=${favouriteCount} icon="fa-star" label="Favourites" onClick=${() => setView('favourites')} />
            </div>

            <div class="notebook-library-nav-group">
              <div class="notebook-library-nav-title">Learn</div>
              <${SidebarButton} viewId="tutorials" active=${view === 'tutorials'} count=${counts.tutorials} icon="fa-graduation-cap" label="Tutorials" onClick=${() => setView('tutorials')} />
            </div>

            <div class="notebook-library-nav-group">
              <div class="notebook-library-nav-title">Examples</div>
              <${SidebarButton} viewId="examples" active=${view === 'examples'} count=${counts.examples} icon="fa-flask" label="All examples" onClick=${() => setView('examples')} />
              ${categoryList.map(category => html`
                <${SidebarButton}
                  key=${category.id}
                  viewId=${`category:${category.id}`}
                  active=${view === `category:${category.id}`}
                  count=${counts.categories[category.id] || 0}
                  icon=${category.icon || 'fa-shapes'}
                  label=${category.label}
                  onClick=${() => setView(`category:${category.id}`)}
                />
              `)}
            </div>

            <div class="notebook-library-nav-group">
              <div class="notebook-library-nav-title">Personal</div>
              <${SidebarButton} viewId="saved" active=${view === 'saved'} count=${counts.saved} icon="fa-book" label="My notebooks" onClick=${() => setView('saved')} />
            </div>
          </aside>

          <main class="notebook-library-main">
            <div class="notebook-library-tools">
              <label class="notebook-library-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input
                  type="search"
                  value=${query}
                  onInput=${event => setQuery(event.currentTarget.value)}
                  placeholder="Search titles, descriptions, languages, and features…"
                  aria-label="Search notebooks"
                  autofocus
                />
                ${query && html`<button class="btn-icon" onClick=${() => setQuery('')} aria-label="Clear search"><i class="fa-solid fa-xmark"></i></button>`}
              </label>
              <div class="notebook-library-filters">
                <label>
                  <span>Language</span>
                  <select value=${language} onChange=${event => setLanguage(event.currentTarget.value)}>
                    <option value="all">All languages</option>
                    ${languages.map(lang => html`<option key=${lang} value=${lang}>${LANG_BADGES[lang] || lang}</option>`)}
                  </select>
                </label>
                <label>
                  <span>Sort</span>
                  <select value=${sort} onChange=${event => setSort(event.currentTarget.value)}>
                    <option value="relevance">Recommended</option>
                    <option value="title">Title A–Z</option>
                    <option value="newest">Newest</option>
                  </select>
                </label>
              </div>
            </div>

            <div class="notebook-library-results-heading">
              <div>
                <h3>${heading}</h3>
                <span>${visibleItems.length} ${visibleItems.length === 1 ? 'notebook' : 'notebooks'}</span>
              </div>
              ${hasFilters && html`
                <button class="btn btn-sm" onClick=${() => { setQuery(''); setLanguage('all'); }}>
                  <i class="fa-solid fa-filter-circle-xmark"></i> Clear filters
                </button>
              `}
            </div>

            ${view === 'saved' && !hasDirectory ? html`
              <div class="notebook-library-empty">
                <i class="fa-solid fa-folder-tree"></i>
                <h3>Connect your data root</h3>
                <p>Choose a data root to save and load your own notebooks on disk.</p>
                <button class="btn btn-primary" onClick=${onPickDirectory}><i class="fa-solid fa-folder"></i> Choose Data Root</button>
              </div>
            ` : visibleItems.length === 0 ? html`
              <div class="notebook-library-empty">
                <i class=${`fa-solid ${view === 'favourites' ? 'fa-star' : view === 'recent' ? 'fa-clock-rotate-left' : 'fa-magnifying-glass'}`}></i>
                <h3>${view === 'favourites' ? 'No favourites yet' : view === 'recent' ? 'No recently opened notebooks' : 'No matching notebooks'}</h3>
                <p>${view === 'favourites' ? 'Use the star beside a notebook to keep it close at hand.' : view === 'recent' ? 'Notebooks you open will appear here.' : 'Try a different search, category, or language.'}</p>
                ${hasFilters && html`<button class="btn" onClick=${() => { setQuery(''); setLanguage('all'); }}>Clear filters</button>`}
              </div>
            ` : html`
              <div class="notebook-library-results" aria-live="polite">
                ${visibleItems.map(item => {
                  const isFavourite = favourites.includes(item.key);
                  const date = formatDate(item.updatedAt || item.addedAt);
                  return html`
                    <article class="notebook-library-item" key=${item.key}>
                      <button class="notebook-library-open" onClick=${() => openItem(item)} title=${`Open ${item.title}`}>
                        <span class=${`notebook-library-type-icon ${item.type}`}><i class=${`fa-solid ${TYPE_ICONS[item.type]}`}></i></span>
                        <span class="notebook-library-item-copy">
                          <span class="notebook-library-item-title">
                            <strong>${item.title}</strong>
                            <${LangBadges} langs=${item.langs} />
                          </span>
                          <span class="notebook-library-description">${item.description}</span>
                          <span class="notebook-library-meta">
                            <span>${item.typeLabel}</span>
                            ${activeCategory == null && item.category && html`<span>${categoryList.find(category => category.id === item.category)?.label || item.category}</span>`}
                            ${date && html`<span>${date}</span>`}
                          </span>
                        </span>
                      </button>
                      <div class="notebook-library-actions">
                        <button
                          class=${`btn-icon notebook-library-favourite ${isFavourite ? 'active' : ''}`}
                          onClick=${() => toggleFavourite(item.key)}
                          title=${isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                          aria-pressed=${isFavourite}
                        ><i class=${`${isFavourite ? 'fa-solid' : 'fa-regular'} fa-star`}></i></button>
                        ${item.type === 'saved' && html`
                          <button class="btn-icon notebook-library-delete" title="Delete notebook" onClick=${() => onDelete(item.id, item.title)}><i class="fa-solid fa-trash"></i></button>
                        `}
                        <button class="btn-icon notebook-library-open-icon" title="Open notebook" onClick=${() => openItem(item)}><i class="fa-solid fa-arrow-right"></i></button>
                      </div>
                    </article>
                  `;
                })}
              </div>
            `}
          </main>
        </div>

        <div class="modal-footer notebook-library-footer">
          <span>${counts.tutorials} tutorials · ${counts.examples} examples · ${counts.saved} saved</span>
          <div>
            <button class="btn" onClick=${onClose}>Close</button>
            <button class="btn btn-primary" onClick=${onNew}><i class="fa-solid fa-plus"></i> New notebook</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  listWan2gpImages,
  loadWan2gpImageBlob,
} from '../services/wan2gp-image-library.js';

const ROWS_PER_PAGE = 6;
const COLUMN_CHOICES = [4, 6, 8];
const LIMIT_CHOICES = [48, 96, 200];
const COLUMN_KEY = 'devtools-hub-wan2gp-image-library-columns';

function initialColumns() {
  try {
    const value = Number(localStorage.getItem(COLUMN_KEY));
    return COLUMN_CHOICES.includes(value) ? value : 8;
  } catch {
    return 8;
  }
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function Wan2gpImageLibraryDialog({
  appId,
  nodeId,
  title = 'WAN2GP image library',
  onSelect,
  onClose,
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [limit, setLimit] = useState(96);
  const [reloadKey, setReloadKey] = useState(0);
  const [images, setImages] = useState([]);
  const [node, setNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [previews, setPreviews] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const previewUrlsRef = useRef(new Set());

  useEffect(() => {
    try { localStorage.setItem(COLUMN_KEY, String(columns)); } catch { /* private mode */ }
    setPage(0);
  }, [columns]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listWan2gpImages({ limit, nodeId, appId, signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setImages(result.images);
        setNode(result.node);
        setPage(0);
        setSelectedId('');
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason?.message || String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appId, nodeId, limit, reloadKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return images;
    return images.filter(image => [image.name, image.prompt, image.modelType, image.jobId]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [images, query]);

  const pageSize = columns * ROWS_PER_PAGE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageImages = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize],
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(0);
    setSelectedId('');
  }, [query]);

  // WAN2GP has no thumbnail endpoint, so download only the current page and
  // cap concurrency to avoid making a 48-tile view saturate the node/network.
  useEffect(() => {
    const controller = new AbortController();
    const urls = new Set();
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current = urls;
    setPreviews({});
    let cursor = 0;

    const worker = async () => {
      while (!controller.signal.aborted) {
        const image = pageImages[cursor++];
        if (!image) return;
        try {
          const blob = await loadWan2gpImageBlob(image, { nodeId, appId, signal: controller.signal });
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urls.add(url);
          setPreviews(current => ({ ...current, [image.id]: { url, blob } }));
        } catch (reason) {
          if (!controller.signal.aborted) {
            setPreviews(current => ({
              ...current,
              [image.id]: { error: reason?.message || String(reason) },
            }));
          }
        }
      }
    };

    Promise.all(Array.from({ length: Math.min(4, pageImages.length) }, worker));
    return () => {
      controller.abort();
      urls.forEach(url => URL.revokeObjectURL(url));
      if (previewUrlsRef.current === urls) previewUrlsRef.current = new Set();
    };
  }, [pageImages, nodeId, appId]);

  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowLeft' && safePage > 0 && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        setPage(value => Math.max(0, value - 1));
      }
      if (event.key === 'ArrowRight' && safePage < pageCount - 1 && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        setPage(value => Math.min(pageCount - 1, value + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, safePage, pageCount]);

  const selectedImage = images.find(image => image.id === selectedId) || null;
  const selectedPreview = selectedImage ? previews[selectedImage.id] : null;

  const chooseImage = async image => {
    const preview = previews[image?.id];
    if (!image || !preview?.blob || selecting) return;
    setSelecting(true);
    setError('');
    try {
      await onSelect?.({ image, blob: preview.blob });
      onClose?.();
    } catch (reason) {
      setError(reason?.message || String(reason));
      setSelecting(false);
    }
  };

  const firstShown = filtered.length ? safePage * pageSize + 1 : 0;
  const lastShown = Math.min(filtered.length, (safePage + 1) * pageSize);

  return html`
    <div class="modal-overlay wan-image-library-overlay">
      <div class="modal wan-image-library-dialog" role="dialog" aria-modal="true" aria-label=${title}>
        <header class="modal-header">
          <div class="wan-image-library-heading">
            <h2><i class="fa-solid fa-images"></i> ${title}</h2>
            <span>${node?.name || 'Active WAN2GP node'} · completed image outputs</span>
          </div>
          <button class="btn-icon" onClick=${onClose} title="Close" aria-label="Close image library">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>

        <div class="wan-image-library-controls">
          <label class="wan-image-library-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input
              type="search"
              value=${query}
              onInput=${event => setQuery(event.target.value)}
              placeholder="Search filename, prompt, model, or job…"
              aria-label="Search generated images"
            />
          </label>
          <label>History
            <select value=${limit} onChange=${event => setLimit(Number(event.target.value))}>
              ${LIMIT_CHOICES.map(value => html`<option value=${value}>${value} jobs</option>`)}
            </select>
          </label>
          <label>Columns
            <select value=${columns} onChange=${event => setColumns(Number(event.target.value))}>
              ${COLUMN_CHOICES.map(value => html`<option value=${value}>${value}</option>`)}
            </select>
          </label>
          <button class="btn" onClick=${() => setReloadKey(value => value + 1)} disabled=${loading}>
            <i class=${`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i> Refresh
          </button>
        </div>

        ${error && html`<div class="wan-image-library-error"><i class="fa-solid fa-triangle-exclamation"></i> ${error}</div>`}

        <div class="modal-body wan-image-library-body">
          ${loading ? html`
            <div class="wan-image-library-empty">
              <i class="fa-solid fa-spinner fa-spin"></i>
              <strong>Loading WAN2GP history…</strong>
            </div>
          ` : pageImages.length ? html`
            <div class="wan-image-library-grid" style=${`--wan-image-columns:${columns}`}>
              ${pageImages.map(image => {
                const preview = previews[image.id];
                return html`
                  <button
                    class=${`wan-image-library-tile ${selectedId === image.id ? 'selected' : ''}`}
                    onClick=${() => setSelectedId(image.id)}
                    onDblClick=${() => chooseImage(image)}
                    title=${image.prompt || image.name}
                    aria-pressed=${selectedId === image.id}
                  >
                    <span class="wan-image-library-thumb">
                      ${preview?.url
                        ? html`<img src=${preview.url} alt=${image.name} />`
                        : preview?.error
                          ? html`<i class="fa-solid fa-image-slash" title=${preview.error}></i>`
                          : html`<i class="fa-solid fa-spinner fa-spin"></i>`}
                    </span>
                    <span class="wan-image-library-name">${image.name}</span>
                    <span class="wan-image-library-meta">${image.resolution || image.modelType || formatDate(image.createdAt)}</span>
                  </button>
                `;
              })}
            </div>
          ` : html`
            <div class="wan-image-library-empty">
              <i class="fa-regular fa-images"></i>
              <strong>${query ? 'No images match this search' : 'No generated images found'}</strong>
              <span>Complete an image job on this WAN2GP node, then refresh.</span>
            </div>
          `}
        </div>

        <footer class="modal-footer wan-image-library-footer">
          <div class="wan-image-library-count">
            ${filtered.length ? `${firstShown}–${lastShown} of ${filtered.length}` : '0 images'}
            ${selectedImage && html`<strong title=${selectedImage.prompt}> · ${selectedImage.name}</strong>`}
          </div>
          <div class="wan-image-library-pages">
            <button class="btn-icon" disabled=${safePage <= 0} onClick=${() => setPage(value => value - 1)} title="Previous page">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span>Page ${safePage + 1} / ${pageCount}</span>
            <button class="btn-icon" disabled=${safePage >= pageCount - 1} onClick=${() => setPage(value => value + 1)} title="Next page">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button
            class="btn btn-primary"
            disabled=${!selectedPreview?.blob || selecting}
            onClick=${() => chooseImage(selectedImage)}
          >
            ${selecting
              ? html`<i class="fa-solid fa-spinner fa-spin"></i> Importing…`
              : html`<i class="fa-solid fa-file-import"></i> Use image`}
          </button>
        </footer>
      </div>
    </div>
  `;
}

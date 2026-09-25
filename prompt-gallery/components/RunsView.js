import { html } from 'htm/preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';
import { BatchReview, HtmlLive, HtmlLightbox } from './BatchReview.js';
import { buildRuns, canMergeRuns, extractGenTitle } from '../services/runs.js';
import { RatingWidget } from './RatingWidget.js';
import { promptSetLabel } from '../services/library.js';

// Core is the default, so it stays quiet; any other set is called out.
function SetBadge({ promptSet }) {
  const id = promptSet || 'core';
  const label = id === 'mixed' ? 'Mixed sets' : promptSetLabel(id);
  return html`<span class=${`runs-set-badge is-${id}`} title=${`Prompt set: ${label}`}>${label}</span>`;
}

// Live HTML previews are far heavier than inline SVG, so cap side-by-side
// compare lower than the SVG benchmark's 25.
export const MAX_COMPARE = 6;

const fmtScore = (s) => (s == null ? '' : `${Math.round(s * 100)}%`);
const fmtWhen = (iso) => {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleString();
};

// A balanced grid for N side-by-side runs.
//   1→1×1  2→2×1  3→3×1  4→2×2  6→3×2
export function gridShape(n) {
  if (n <= 1) return { cols: 1, rows: 1, scroll: false };
  if (n > 15) return { cols: 5, rows: Math.ceil(n / 5), scroll: true };
  const rows = n <= 3 ? 1 : n <= 8 ? 2 : 3;
  return { cols: Math.min(5, Math.ceil(n / rows)), rows, scroll: false };
}

// Full-page Past Runs browser. Every batch run is rebuilt from the generations
// already loaded in the gallery, listed here, and can be opened on its own
// (single review) or checked to compare side by side, one prompt at a time.
export function RunsView({ generations, hasDirectory, onPickDirectory, onOpen, onRefresh, onMerge, onRate, addToast, initialRunId, onRouteRun, loadHtml }) {
  const [mode, setMode] = useState('list');               // list | single | compare
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [singleId, setSingleId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [merging, setMerging] = useState(false);

  const runs = useMemo(() => buildRuns(generations), [generations]);
  // Pages are not in the scan any more, so the run being looked at fetches its
  // own — a few dozen files on open instead of every run's HTML up front.
  const [pages, setPages] = useState(() => new Map());
  const [loadingPages, setLoadingPages] = useState(false);

  const singleRun = useMemo(
    () => (singleId ? runs.find(r => r.id === singleId) || null : null),
    [runs, singleId],
  );
  const compareRuns = useMemo(
    () => runs.filter(r => selectedIds.has(r.id)),
    [runs, selectedIds],
  );
  const mergeCompatible = useMemo(() => canMergeRuns(compareRuns), [compareRuns]);

  // Fetch the pages of whichever runs are on screen, a few at a time so one
  // big run cannot flood the connection.
  useEffect(() => {
    const wanted = [...(singleRun ? [singleRun] : []), ...(mode === 'compare' ? compareRuns : [])]
      .flatMap(run => run.items || [])
      .filter(item => item.id && item.hasHtml && !item.html && !pages.has(item.id));
    if (!loadHtml || !wanted.length) return undefined;
    let live = true;
    setLoadingPages(true);
    (async () => {
      const queue = [...wanted];
      const found = new Map();
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (live && queue.length) {
          const item = queue.shift();
          try { found.set(item.id, await loadHtml(item.id)); } catch { found.set(item.id, ''); }
        }
      });
      await Promise.all(workers);
      if (!live) return;
      setPages(prev => new Map([...prev, ...found]));
      setLoadingPages(false);
    })();
    return () => { live = false; };
  }, [singleRun, compareRuns, mode, loadHtml, pages]);

  /** The page for a run item: from the run itself, or fetched on open. */
  const pageOf = useCallback((item) => (item ? (item.html || pages.get(item.id) || '') : ''), [pages]);

  // Drop selections / single view that no longer exist after a refresh.
  useEffect(() => {
    const live = new Set(runs.map(r => r.id));
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (singleId && !live.has(singleId)) { setSingleId(null); setMode('list'); }
  }, [runs, singleId]);

  // Deep link: #/runs/<runId> opens that run's review directly. The batch
  // dialog navigates here the moment it closes, before its refreshGenerations()
  // has landed, so an unknown id is treated as "not here yet" and picked up
  // when it appears in `runs` — never as an error. `honouredRef` keeps it to
  // one auto-open per id, so going back to the list doesn't bounce straight in.
  const honouredRef = useRef(null);
  useEffect(() => {
    const want = initialRunId || '';
    if (!want) { honouredRef.current = null; return; }
    if (honouredRef.current === want) return;
    if (runs.some(r => r.id === want)) {
      honouredRef.current = want;
      setSingleId(want);
      setMode('single');
    } else if (singleId && singleId !== want) {
      // The route moved on; don't keep showing the previous run while we wait.
      setSingleId(null);
      setMode('list');
    }
  }, [initialRunId, runs, singleId]);

  // Only call a requested run missing once it has had time to arrive — the
  // post-batch refresh lands a second or two after the navigation, and the
  // gallery already holds older runs, so "not in the list" proves nothing yet.
  const [missingSettled, setMissingSettled] = useState(false);
  useEffect(() => {
    setMissingSettled(false);
    const want = initialRunId || '';
    if (!want || runs.some(r => r.id === want)) return undefined;
    const timer = setTimeout(() => setMissingSettled(true), 2500);
    return () => clearTimeout(timer);
  }, [initialRunId, runs]);

  const requestedRunMissing = missingSettled
    && !!initialRunId
    && !runs.some(r => r.id === initialRunId);

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= MAX_COMPARE) {
        addToast?.(`Compare up to ${MAX_COMPARE} runs at once`, 'info');
        return prev;
      }
      next.add(id);
      return next;
    });
  }, [addToast]);

  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);

  const openSingle = useCallback((run) => {
    setSingleId(run.id);
    setMode('single');
    onRouteRun?.(run.id);
  }, [onRouteRun]);

  const backToList = useCallback(() => {
    setMode('list');
    setSingleId(null);
    onRouteRun?.('');
  }, [onRouteRun]);

  const openCompare = useCallback(() => {
    if (compareRuns.length < 2) { addToast?.('Pick at least two runs to compare', 'info'); return; }
    setMode('compare');
  }, [compareRuns, addToast]);

  const mergeSelected = useCallback(async () => {
    if (!mergeCompatible || !onMerge || merging) return;
    setMerging(true);
    try {
      const merged = await onMerge(compareRuns);
      if (merged) setSelectedIds(new Set());
    } finally {
      setMerging(false);
    }
  }, [compareRuns, mergeCompatible, merging, onMerge]);

  // ── Rows for a single-run review (reuses BatchReview) ──
  const singleRows = useMemo(() => (singleRun?.items || []).map((it, i) => ({
    key: it.id || String(i),
    id: it.id,
    title: it.title || it.slug,
    subtitle: it.genTitle || extractGenTitle(pageOf(it)),
    prompt: it.prompt,
    html: pageOf(it),
    icon: it.hasHtml ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation',
    cls: it.hasHtml ? 'ok' : 'error',
    label: 'Saved',
    autoScore: it.autoScore,
    healed: it.healed,
    stats: it.stats,
    paramsLabel: it.paramsLabel,
    error: it.hasHtml ? '' : 'HTML file missing',
    verification: it.verification,
    parentId: it.parentId,
    rating: it.rating,
  })), [singleRun, pageOf]);

  if (!hasDirectory) {
    return html`
      <div class="runs-view">
        <div class="runs-empty">
          <i class="fa-solid fa-folder-open"></i>
          <p>Connect a directory to browse the batch runs saved there.</p>
          <button class="btn btn-primary" onClick=${onPickDirectory}>
            <i class="fa-solid fa-folder-plus"></i> Pick Directory
          </button>
        </div>
      </div>
    `;
  }

  if (mode === 'single' && singleRun) {
    return html`
      <div class="runs-view">
        <div class="runs-subhead">
          <button class="btn btn-sm" onClick=${backToList}>
            <i class="fa-solid fa-arrow-left"></i> All Runs
          </button>
          <div class="runs-subhead-title">
            <strong>${singleRun.model} <${SetBadge} promptSet=${singleRun.promptSet} /></strong>
            <span>${fmtWhen(singleRun.startedAt)} · ${singleRun.count} generation${singleRun.count === 1 ? '' : 's'}</span>
          </div>
        </div>
        <${BatchReview} rows=${singleRows} resetKey=${singleRun.id} onOpen=${onOpen} onRate=${onRate} />
      </div>
    `;
  }

  if (mode === 'compare' && compareRuns.length >= 2) {
    return html`<${CompareRuns}
      compareRuns=${compareRuns}
      onBack=${() => setMode('list')}
      onOpen=${onOpen}
      onRate=${onRate}
    />`;
  }

  // ── List mode ──
  const selectedCount = selectedIds.size;
  return html`
    <div class="runs-view">
      ${requestedRunMissing && html`
        <div class="runs-missing-note">
          <i class="fa-solid fa-circle-info"></i>
          <span>That run isn't in this gallery folder — nothing was saved under <code>${initialRunId}</code>. Refresh, or pick a run below.</span>
        </div>
      `}
      <div class="runs-toolbar">
        <div class="runs-intro">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <span>Every past batch run, rebuilt from the generations in your gallery folder. Check runs to compare them side by side or merge runs made with the same model (up to ${MAX_COMPARE}).</span>
        </div>
        <div class="runs-actions">
          ${selectedCount > 0 && html`
            <button class="btn btn-sm" onClick=${() => setSelectedIds(new Set())} title="Clear selection">
              Clear (${selectedCount})
            </button>`}
          <button class="btn btn-sm" onClick=${refresh} title="Reload from disk" disabled=${refreshing}>
            <i class=${`fa-solid fa-rotate ${refreshing ? 'fa-spin' : ''}`}></i>
          </button>
          <button class="btn btn-sm" onClick=${mergeSelected}
            disabled=${!mergeCompatible || merging}
            title=${selectedCount < 2
              ? 'Select two or more runs to merge'
              : !mergeCompatible
                ? 'Only runs made with the same model and prompt set can be merged'
                : `Merge ${selectedCount} same-model runs`}>
            <i class=${`fa-solid ${merging ? 'fa-spinner fa-spin' : 'fa-code-merge'}`}></i>
            ${merging ? 'Merging…' : `Merge${selectedCount >= 2 ? ` (${selectedCount})` : ''}`}
          </button>
          <button class="btn btn-primary" onClick=${openCompare}
            disabled=${selectedCount < 2}
            title=${selectedCount < 2 ? 'Select two or more runs' : `Compare ${selectedCount} runs`}>
            <i class="fa-solid fa-table-columns"></i> Compare${selectedCount >= 2 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      </div>

      ${runs.length === 0
        ? html`<div class="runs-empty"><i class="fa-solid fa-layer-group"></i><p>No batch runs found yet. Use the Batch button to run a model over your prompt library — those generations get grouped into runs here.</p></div>`
        : html`
          <div class="runs-list">
            ${runs.map(r => {
              const checked = selectedIds.has(r.id);
              const atLimit = !checked && selectedCount >= MAX_COMPARE;
              return html`
                <div class=${`runs-row ${checked ? 'is-checked' : ''}`} key=${r.id}>
                  <label class="runs-check" title=${atLimit ? `Select up to ${MAX_COMPARE} runs` : 'Select to compare or merge'} onClick=${(e) => e.stopPropagation()}>
                    <input type="checkbox" checked=${checked} disabled=${atLimit}
                      onChange=${() => toggleSelect(r.id)} />
                  </label>
                  <button class="runs-row-open" onClick=${() => openSingle(r)} title="Open this run">
                    <i class="fa-solid fa-layer-group runs-row-icon"></i>
                    <span class="runs-row-model" title=${r.modelId || r.model}>${r.model}</span>
                    <${SetBadge} promptSet=${r.promptSet} />
                    <span class="runs-row-when">${fmtWhen(r.startedAt)}</span>
                    <span class="runs-row-meta">
                      <span class=${`runs-row-rated ${r.ratedCount === r.count ? 'is-done' : ''}`} title="Generations you have rated">
                        <i class="fa-solid fa-star"></i> ${r.ratedCount}/${r.count} rated
                      </span>
                      ${r.count} generation${r.count === 1 ? '' : 's'}
                      <i class="fa-solid fa-chevron-right"></i>
                    </span>
                  </button>
                </div>
              `;
            })}
          </div>
        `}
    </div>
  `;
}

// Per-prompt side-by-side comparison: one prompt at a time, every selected run
// in its own column, with a prompt list on the left and ‹ › to step through.
function CompareRuns({ compareRuns, onBack, onOpen, onRate }) {
  const [pos, setPos] = useState(0);
  const [zoom, setZoom] = useState(null);

  // Union of prompts across the selected runs, in first-seen order.
  const prompts = useMemo(() => {
    const seen = new Map();
    for (const r of compareRuns) {
      for (const it of (r.items || [])) {
        if (!seen.has(it.slug)) seen.set(it.slug, { slug: it.slug, title: it.title || it.slug, prompt: it.prompt });
      }
    }
    return [...seen.values()];
  }, [compareRuns]);

  const maps = useMemo(() => compareRuns.map(r => {
    const m = new Map();
    for (const it of (r.items || [])) if (!m.has(it.slug)) m.set(it.slug, it);
    return m;
  }), [compareRuns]);

  useEffect(() => { setPos(0); }, [compareRuns]);

  const n = prompts.length;
  const step = useCallback((delta) => {
    setPos(prev => (n === 0 ? 0 : (prev + delta + n) % n));
  }, [n]);

  useEffect(() => {
    if (n < 2) return;
    const onKey = (e) => {
      if (e.target?.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, step]);

  const cur = prompts[Math.min(pos, Math.max(0, n - 1))] || null;

  const shape = gridShape(compareRuns.length);
  const gridStyle = shape.scroll
    ? { gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridAutoRows: '260px' }
    : { gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))` };

  const statsBits = (s) => {
    if (!s) return null;
    const bits = [];
    if (s.tokensPerSecond != null) bits.push(`${s.tokensPerSecond} tok/s`);
    if (s.thought) bits.push('thought');
    return bits.length ? bits.join(' · ') : null;
  };

  return html`
    <div class="runs-view">
      <div class="runs-subhead">
        <button class="btn btn-sm" onClick=${onBack}>
          <i class="fa-solid fa-arrow-left"></i> All Runs
        </button>
        <div class="runs-subhead-title">
          <strong><i class="fa-solid fa-table-columns"></i> Comparing ${compareRuns.length} runs</strong>
          <span>${compareRuns.map(r => r.model).join('  ·  ')}</span>
        </div>
      </div>

      <div class="rcmp-body">
        <div class="batch-run-list rcmp-prompt-list">
          ${prompts.map((p, i) => html`
            <div class=${`batch-run-item is-reviewable ${i === pos ? 'is-active' : ''}`} key=${p.slug}
              onClick=${() => setPos(i)}>
              <span class="batch-run-title" title=${p.prompt || p.title}>${p.title}</span>
            </div>
          `)}
        </div>

        <div class="rcmp-panel">
          ${!cur ? html`
            <div class="batch-preview"><div class="batch-preview-empty"><i class="fa-solid fa-image"></i><span>Nothing to compare</span></div></div>
          ` : html`
            <div class="rcmp-head">
              <span class="rcmp-head-title" title=${cur.prompt || cur.title}>${cur.title}</span>
            </div>

            <div class=${`rcmp-grid ${shape.scroll ? 'is-scroll' : ''}`} style=${gridStyle}>
              ${compareRuns.map((r, i) => {
                const it = maps[i].get(cur.slug);
                const page = pageOf(it);
                const hasHtml = !!page.trim();
                return html`
                  <div class="rcmp-col" key=${r.id}>
                    <div class="rcmp-col-head" title=${r.modelId || r.model}>${r.model}</div>
                    ${(it?.genTitle || extractGenTitle(page)) ? html`<div class="rcmp-gen" title=${`Generated: ${it?.genTitle || extractGenTitle(page)}`}>${it?.genTitle || extractGenTitle(page)}</div>` : null}
                    <div class=${`rcmp-cell ${hasHtml ? 'is-zoomable' : ''}`}
                      title=${hasHtml ? 'Click to enlarge' : ''}
                      onClick=${hasHtml ? () => setZoom({ html: page, title: cur.title, subtitle: r.model }) : null}>
                      ${hasHtml
                        ? html`<${HtmlLive} html=${page} /><div class="preview-hitbox"></div><span class="zoom-hint"><i class="fa-solid fa-magnifying-glass-plus"></i></span>`
                        : html`<div class="rcmp-cell-empty"><i class=${`fa-solid ${it?.hasHtml && loadingPages ? 'fa-spinner fa-spin' : 'fa-ban'}`}></i><span>${
                            it?.hasHtml ? (loadingPages ? 'loading' : 'no HTML') : it ? 'no HTML' : 'not in this run'}</span></div>`}
                    </div>
                    ${onRate && it?.id ? html`
                      <div class="rcmp-col-rate">
                        <${RatingWidget} rating=${it.rating || 0} onChange=${(value) => onRate(it.id, value)} size=${12} />
                      </div>
                    ` : null}
                    <div class="rcmp-col-meta">
                      ${it?.healed ? html`<span class="batch-healed-chip">fixed</span>` : null}
                      ${it?.paramsLabel && it.paramsLabel !== 'defaults' ? html`<span class="batch-params-chip"><i class="fa-solid fa-sliders"></i> ${it.paramsLabel}</span>` : null}
                      ${statsBits(it?.stats) ? html`<span class="batch-stats-line">${statsBits(it.stats)}</span>` : null}
                      ${onOpen && it?.id ? html`<button class="btn btn-xs" title="Open this generation" onClick=${(e) => { e.stopPropagation(); onOpen(it.id); }}><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : null}
                    </div>
                  </div>
                `;
              })}
            </div>

            <div class="batch-review-nav">
              <button class="btn btn-sm" title="Previous (←)" onClick=${() => step(-1)} disabled=${n < 2}>
                <i class="fa-solid fa-chevron-left"></i>
              </button>
              <span class="batch-review-count">${pos + 1} / ${n}</span>
              <button class="btn btn-sm" title="Next (→)" onClick=${() => step(1)} disabled=${n < 2}>
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          `}
        </div>
      </div>
      ${zoom && html`<${HtmlLightbox}
        html=${zoom.html}
        title=${zoom.title}
        subtitle=${zoom.subtitle}
        onClose=${() => setZoom(null)}
      />`}
    </div>
  `;
}

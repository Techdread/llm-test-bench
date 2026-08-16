import { html } from 'htm/preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { BatchReview, SvgLive, SvgLightbox } from './BatchReview.js';
import { paramsSignature } from '../../shared/services/gen-params.js';

export const MAX_COMPARE = 25;

const fmtScore = (s) => (s == null ? '' : `${Math.round(s * 100)}%`);
const fmtWhen = (iso) => {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleString();
};

// A balanced grid for N side-by-side runs. Up to 15 fits without scrolling
// (1 row ≤3, 2 rows ≤8, 3 rows ≤15); beyond that we cap at 5 columns and let
// the extra rows scroll vertically. cols = ceil(N / rows), never more than 5.
//   1→1×1  2→2×1  3→3×1  4→2×2  6→3×2  8→4×2  9→3×3  12→4×3  15→5×3  16+→5×n(scroll)
export function gridShape(n) {
  if (n <= 1) return { cols: 1, rows: 1, scroll: false };
  if (n > 15) return { cols: 5, rows: Math.ceil(n / 5), scroll: true };
  const rows = n <= 3 ? 1 : n <= 8 ? 2 : 3;
  return { cols: Math.min(5, Math.ceil(n / rows)), rows, scroll: false };
}

// Full-page Past Runs browser. Every past batch run is rebuilt from the saved
// submissions, listed here, and can be opened on its own (single review) or
// checked (up to six) to compare side by side, one prompt at a time.
//
// deps: { listRuns(): Run[], loadRunSvgs(items): items+svg }
//   Run: { id, model, modelId, count, startedAt, avgScore, items:[{ slug, prompt, title, ... }] }
export function RunsView({ deps, hasDirectory, onPickDirectory, onOpenBenchmark, addToast }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('list');               // list | single | compare
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [singleRun, setSingleRun] = useState(null);        // { ...run, items:[...+svg] }
  const [compareRuns, setCompareRuns] = useState([]);      // [{ ...run, loaded:[...+svg] }]

  const refresh = useCallback(async () => {
    if (!hasDirectory) { setRuns([]); return; }
    setLoading(true);
    try {
      setRuns(await deps.listRuns());
    } catch (e) {
      addToast?.('Could not read past runs: ' + e.message, 'error');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [deps, hasDirectory, addToast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Drop any selections that no longer exist after a refresh.
  useEffect(() => {
    setSelectedIds(prev => {
      const live = new Set(runs.map(r => r.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [runs]);

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

  const openSingle = useCallback(async (run) => {
    setBusy(true);
    try {
      const withSvgs = await deps.loadRunSvgs(run.items);
      setSingleRun({ ...run, items: withSvgs });
      setMode('single');
    } catch (e) {
      addToast?.('Could not load that run: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  }, [deps, addToast]);

  const openCompare = useCallback(async () => {
    const chosen = runs.filter(r => selectedIds.has(r.id));
    if (chosen.length < 2) { addToast?.('Pick at least two runs to compare', 'info'); return; }
    setBusy(true);
    try {
      const loaded = await Promise.all(chosen.map(async (r) => ({
        ...r,
        loaded: await deps.loadRunSvgs(r.items),
      })));
      setCompareRuns(loaded);
      setMode('compare');
    } catch (e) {
      addToast?.('Could not load runs to compare: ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  }, [runs, selectedIds, deps, addToast]);

  // ── Rows for a single-run review (reuses BatchReview) ──
  const singleRows = useMemo(() => (singleRun?.items || []).map((it, i) => ({
    key: it.submissionId || String(i),
    title: it.title || it.slug,
    prompt: it.prompt,
    slug: it.slug,
    svg: it.svg || '',
    icon: it.svg ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation',
    cls: it.svg ? 'ok' : 'error',
    label: it.valid === false ? 'Invalid' : 'Saved',
    autoScore: it.autoScore,
    healed: it.healed,
    stats: it.stats,
    paramsLabel: it.params && Object.keys(it.params).length ? (it.paramsLabel || paramsSignature(it.params)) : null,
    error: it.svg ? '' : 'SVG file missing',
  })), [singleRun]);

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
          <button class="btn btn-sm" onClick=${() => setMode('list')}>
            <i class="fa-solid fa-arrow-left"></i> All Runs
          </button>
          <div class="runs-subhead-title">
            <strong>${singleRun.model}</strong>
            <span>${fmtWhen(singleRun.startedAt)} · ${singleRun.count} SVG${singleRun.count === 1 ? '' : 's'}${singleRun.avgScore != null ? ` · avg ${fmtScore(singleRun.avgScore)}` : ''}</span>
          </div>
        </div>
        <${BatchReview} rows=${singleRows} resetKey=${singleRun.id} onOpenBenchmark=${onOpenBenchmark} />
      </div>
    `;
  }

  if (mode === 'compare' && compareRuns.length) {
    return html`<${CompareRuns}
      compareRuns=${compareRuns}
      onBack=${() => setMode('list')}
      onOpenBenchmark=${onOpenBenchmark}
    />`;
  }

  // ── List mode ──
  const selectedCount = selectedIds.size;
  return html`
    <div class="runs-view">
      <div class="runs-toolbar">
        <div class="runs-intro">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <span>Every past batch run, rebuilt from the saved submissions in your data folder. Check runs to compare them side by side (up to ${MAX_COMPARE}).</span>
        </div>
        <div class="runs-actions">
          ${selectedCount > 0 && html`
            <button class="btn btn-sm" onClick=${() => setSelectedIds(new Set())} title="Clear selection">
              Clear (${selectedCount})
            </button>`}
          <button class="btn btn-sm" onClick=${refresh} title="Reload from disk" disabled=${loading}>
            <i class=${`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i>
          </button>
          <button class="btn btn-primary" onClick=${openCompare}
            disabled=${selectedCount < 2 || busy}
            title=${selectedCount < 2 ? 'Select two or more runs' : `Compare ${selectedCount} runs`}>
            <i class="fa-solid fa-table-columns"></i> Compare${selectedCount >= 2 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      </div>

      ${loading
        ? html`<div class="runs-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Reading submissions…</p></div>`
        : runs.length === 0
          ? html`<div class="runs-empty"><i class="fa-solid fa-layer-group"></i><p>No batch runs found yet. Older, non-batch generations aren't grouped into runs.</p></div>`
          : html`
            <div class="runs-list">
              ${runs.map(r => {
                const checked = selectedIds.has(r.id);
                const atLimit = !checked && selectedCount >= MAX_COMPARE;
                return html`
                  <div class=${`runs-row ${checked ? 'is-checked' : ''}`} key=${r.id}>
                    <label class="runs-check" title=${atLimit ? `Compare up to ${MAX_COMPARE} runs` : 'Select to compare'} onClick=${(e) => e.stopPropagation()}>
                      <input type="checkbox" checked=${checked} disabled=${atLimit}
                        onChange=${() => toggleSelect(r.id)} />
                    </label>
                    <button class="runs-row-open" onClick=${() => openSingle(r)} title="Open this run">
                      <i class="fa-solid fa-layer-group runs-row-icon"></i>
                      <span class="runs-row-model" title=${r.modelId || r.model}>${r.model}</span>
                      <span class="runs-row-when">${fmtWhen(r.startedAt)}</span>
                      <span class="runs-row-meta">
                        ${r.count} SVG${r.count === 1 ? '' : 's'}
                        ${r.avgScore != null ? html`<span class="batch-score-chip" title="Average auto-score">avg ${fmtScore(r.avgScore)}</span>` : null}
                        <i class="fa-solid fa-chevron-right"></i>
                      </span>
                    </button>
                  </div>
                `;
              })}
            </div>
          `}
      ${busy && html`<div class="runs-busy"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>`}
    </div>
  `;
}

// Per-prompt side-by-side comparison: one prompt at a time, every selected run
// in its own column, with a prompt list on the left and ‹ › to step through.
function CompareRuns({ compareRuns, onBack, onOpenBenchmark }) {
  const [pos, setPos] = useState(0);
  const [zoom, setZoom] = useState(null);

  // Union of prompts across the selected runs, in first-seen order.
  const prompts = useMemo(() => {
    const seen = new Map();
    for (const r of compareRuns) {
      for (const it of (r.loaded || [])) {
        if (!seen.has(it.slug)) seen.set(it.slug, { slug: it.slug, title: it.title || it.slug, prompt: it.prompt });
      }
    }
    return [...seen.values()];
  }, [compareRuns]);

  const maps = useMemo(() => compareRuns.map(r => {
    const m = new Map();
    for (const it of (r.loaded || [])) m.set(it.slug, it);
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
    ? { gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridAutoRows: '210px' }
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

      <div class="compare-body">
        <div class="batch-run-list compare-prompt-list">
          ${prompts.map((p, i) => {
            const best = maps.reduce((acc, m) => {
              const s = m.get(p.slug)?.autoScore;
              return s != null && (acc == null || s > acc) ? s : acc;
            }, null);
            return html`
              <div class=${`batch-run-item is-reviewable ${i === pos ? 'is-active' : ''}`} key=${p.slug}
                onClick=${() => setPos(i)}>
                <span class="batch-run-title" title=${p.prompt || p.title}>${p.title}</span>
                ${best != null ? html`<span class="batch-score-chip">${fmtScore(best)}</span>` : null}
              </div>
            `;
          })}
        </div>

        <div class="compare-panel">
          ${!cur ? html`
            <div class="batch-preview"><div class="batch-preview-empty"><i class="fa-solid fa-image"></i><span>Nothing to compare</span></div></div>
          ` : html`
            <div class="compare-head">
              <span class="compare-head-title" title=${cur.prompt || cur.title}>${cur.title}</span>
              ${onOpenBenchmark && cur.slug && html`
                <button class="btn btn-xs" title="Open this benchmark" onClick=${() => onOpenBenchmark(cur.slug)}>
                  <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
                </button>`}
            </div>

            <div class=${`compare-grid ${shape.scroll ? 'is-scroll' : ''}`} style=${gridStyle}>
              ${compareRuns.map((r, i) => {
                const it = maps[i].get(cur.slug);
                const hasSvg = !!(it?.svg || '').trim();
                return html`
                  <div class="compare-col" key=${r.id}>
                    <div class="compare-col-head" title=${r.modelId || r.model}>${r.model}</div>
                    <div class=${`compare-cell ${hasSvg ? 'is-zoomable' : ''}`}
                      title=${hasSvg ? 'Click to enlarge' : ''}
                      onClick=${hasSvg ? () => setZoom({ svg: it.svg, title: cur.title, subtitle: r.model }) : null}>
                      ${hasSvg
                        ? html`<${SvgLive} svg=${it.svg} /><span class="zoom-hint"><i class="fa-solid fa-magnifying-glass-plus"></i></span>`
                        : html`<div class="compare-cell-empty"><i class="fa-solid fa-ban"></i><span>${it ? 'no SVG' : 'not in this run'}</span></div>`}
                    </div>
                    <div class="compare-col-meta">
                      ${it?.autoScore != null ? html`<span class="batch-score-chip">${fmtScore(it.autoScore)}</span>` : null}
                      ${it?.healed ? html`<span class="batch-healed-chip">fixed</span>` : null}
                      ${it?.paramsLabel && it.paramsLabel !== 'defaults' ? html`<span class="batch-params-chip"><i class="fa-solid fa-sliders"></i> ${it.paramsLabel}</span>` : null}
                      ${statsBits(it?.stats) ? html`<span class="batch-stats-line">${statsBits(it.stats)}</span>` : null}
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
      ${zoom && html`<${SvgLightbox}
        svg=${zoom.svg}
        title=${zoom.title}
        subtitle=${zoom.subtitle}
        onClose=${() => setZoom(null)}
      />`}
    </div>
  `;
}

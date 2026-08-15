import { html } from 'htm/preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { paramsSignature } from '../../shared/services/gen-params.js';
import { BatchReview } from './BatchReview.js';
import { CanvasPreview } from './CanvasPreview.js';
import { MAX_COMPARE_RUNS, collectRunJobs, gridShape, runItemKey } from '../services/runComparison.js';

function fmtWhen(value) {
  if (!value) return 'unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toLocaleString();
}

function statsLine(stats) {
  if (!stats) return '';
  const bits = [];
  if (stats.tokensPerSecond != null) bits.push(`${stats.tokensPerSecond} tok/s`);
  if (stats.completionTokens != null) bits.push(`${stats.completionTokens} tokens`);
  if (stats.thought) bits.push('thought');
  return bits.join(' · ');
}

export function RunsView({ deps, hasDirectory, onPickDirectory, onOpenProject, addToast }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('list');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [singleRun, setSingleRun] = useState(null);
  const [compareRuns, setCompareRuns] = useState([]);

  const refresh = useCallback(async () => {
    if (!hasDirectory) { setRuns([]); return; }
    setLoading(true);
    try { setRuns(await deps.listRuns()); }
    catch (error) {
      setRuns([]);
      addToast?.('Could not read past runs: ' + error.message, 'error');
    } finally { setLoading(false); }
  }, [deps, hasDirectory, addToast]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setSelectedIds(current => {
      const liveIds = new Set(runs.map(run => run.id));
      const next = new Set([...current].filter(id => liveIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [runs]);

  const toggleSelected = useCallback(id => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= MAX_COMPARE_RUNS) {
        addToast?.(`Compare up to ${MAX_COMPARE_RUNS} live p5 runs at once`, 'info');
        return current;
      }
      next.add(id);
      return next;
    });
  }, [addToast]);

  const openSingle = useCallback(async run => {
    setBusy(true);
    try {
      setSingleRun({ ...run, items: await deps.loadRunProjects(run.items) });
      setMode('single');
    } catch (error) { addToast?.('Could not load that run: ' + error.message, 'error'); }
    finally { setBusy(false); }
  }, [deps, addToast]);

  const openCompare = useCallback(async () => {
    const selected = runs.filter(run => selectedIds.has(run.id));
    if (selected.length < 2) { addToast?.('Pick at least two runs to compare', 'info'); return; }
    setBusy(true);
    try {
      setCompareRuns(await Promise.all(selected.map(async run => ({
        ...run,
        loaded: await deps.loadRunProjects(run.items),
      }))));
      setMode('compare');
    } catch (error) { addToast?.('Could not load runs to compare: ' + error.message, 'error'); }
    finally { setBusy(false); }
  }, [runs, selectedIds, deps, addToast]);

  const singleRows = useMemo(() => (singleRun?.items || []).map((project, index) => ({
    key: project.projectId || index,
    title: project.metadata?.title || project.title || project.projectId,
    code: project.code || '',
    params: project.params || {},
    seed: project.metadata?.seed || 1,
    paramsLabel: paramsSignature(project.metadata?.generationParams || project.generationParams || {}),
    stats: project.metadata?.generationStats || project.generationStats,
    savedId: project.projectId,
    statusClass: project.error ? 'error' : 'ok',
    statusLabel: project.error || 'Saved',
    icon: project.error ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check',
  })), [singleRun]);

  if (!hasDirectory) return html`
    <div class="runs-view"><div class="runs-empty">
      <i class="fa-solid fa-folder-open"></i>
      <p>Connect a data root to browse the p5 batch runs saved there.</p>
      <button class="btn btn-primary" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Connect</button>
    </div></div>
  `;

  if (mode === 'single' && singleRun) return html`
    <div class="runs-view">
      <div class="runs-subhead">
        <button class="btn btn-sm" onClick=${() => setMode('list')}><i class="fa-solid fa-arrow-left"></i> All Runs</button>
        <div class="runs-subhead-title"><strong>${singleRun.model}</strong><span>${fmtWhen(singleRun.startedAt)} · ${singleRun.count} sketch${singleRun.count === 1 ? '' : 'es'}</span></div>
      </div>
      <${BatchReview} rows=${singleRows} resetKey=${singleRun.id} onOpenProject=${onOpenProject} />
    </div>
  `;

  if (mode === 'compare' && compareRuns.length) return html`
    <${CompareRuns} runs=${compareRuns} onBack=${() => setMode('list')} onOpenProject=${onOpenProject} />
  `;

  const selectedCount = selectedIds.size;
  return html`
    <div class="runs-view">
      <div class="runs-toolbar">
        <div class="runs-intro"><i class="fa-solid fa-clock-rotate-left"></i><span>Past batches rebuilt from append-only sketch metadata. Select runs to compare matching prompts and parameter sweeps.</span></div>
        <div class="runs-actions">
          ${selectedCount ? html`<button class="btn btn-sm" onClick=${() => setSelectedIds(new Set())}>Clear (${selectedCount})</button>` : null}
          <button class="btn btn-sm" onClick=${refresh} disabled=${loading} title="Reload from disk"><i class=${`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i></button>
          <button class="btn btn-primary" onClick=${openCompare} disabled=${selectedCount < 2 || busy}><i class="fa-solid fa-table-columns"></i> Compare${selectedCount >= 2 ? ` (${selectedCount})` : ''}</button>
        </div>
      </div>
      ${loading ? html`<div class="runs-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Reading projects…</p></div>`
        : runs.length === 0 ? html`<div class="runs-empty"><i class="fa-solid fa-layer-group"></i><p>No batch runs yet. Start one with the Batch button.</p></div>`
        : html`<div class="runs-list">${runs.map(run => {
          const checked = selectedIds.has(run.id);
          const atLimit = !checked && selectedCount >= MAX_COMPARE_RUNS;
          return html`<div class=${`runs-row ${checked ? 'is-checked' : ''}`} key=${run.id}>
            <label class="runs-check" title=${atLimit ? `Compare up to ${MAX_COMPARE_RUNS} runs` : 'Select to compare'}><input type="checkbox" checked=${checked} disabled=${atLimit} onChange=${() => toggleSelected(run.id)} /></label>
            <button class="runs-row-open" onClick=${() => openSingle(run)}>
              <i class="fa-solid fa-layer-group runs-row-icon"></i>
              <span class="runs-row-model" title=${run.modelId || run.model}>${run.model}</span>
              <span class="runs-row-when">${fmtWhen(run.startedAt)}</span>
              <span class="runs-row-meta">${run.count} sketch${run.count === 1 ? '' : 'es'} <i class="fa-solid fa-chevron-right"></i></span>
            </button>
          </div>`;
        })}</div>`}
      ${busy && html`<div class="runs-busy"><i class="fa-solid fa-spinner fa-spin"></i> Loading live sketches…</div>`}
    </div>
  `;
}

function CompareRuns({ runs, onBack, onOpenProject }) {
  const [position, setPosition] = useState(0);
  const jobs = useMemo(() => collectRunJobs(runs), [runs]);
  const maps = useMemo(() => runs.map(run => new Map((run.loaded || []).map(item => [runItemKey(item), item]))), [runs]);
  const current = jobs[Math.min(position, Math.max(0, jobs.length - 1))] || null;
  const shape = gridShape(runs.length);
  const step = delta => setPosition(value => jobs.length ? (value + delta + jobs.length) % jobs.length : 0);

  useEffect(() => { setPosition(0); }, [runs]);
  useEffect(() => {
    if (jobs.length < 2) return undefined;
    const onKey = event => {
      if (event.target?.closest?.('input, select, textarea')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobs.length]);

  return html`
    <div class="runs-view">
      <div class="runs-subhead">
        <button class="btn btn-sm" onClick=${onBack}><i class="fa-solid fa-arrow-left"></i> All Runs</button>
        <div class="runs-subhead-title"><strong><i class="fa-solid fa-table-columns"></i> Comparing ${runs.length} runs</strong><span>${runs.map(run => run.model).join(' · ')}</span></div>
      </div>
      <div class="runs-compare-body">
        <div class="batch-run-list runs-job-list">
          ${jobs.map((job, index) => html`<button class=${`batch-run-item ${index === position ? 'is-active' : ''}`} onClick=${() => setPosition(index)} key=${job.key}><span class="batch-run-title" title=${job.prompt || job.title}>${job.title}</span><span class="batch-run-status">${job.paramsLabel}</span></button>`)}
        </div>
        <div class="runs-compare-panel">
          ${current ? html`
            <div class="runs-compare-head"><strong title=${current.prompt || current.title}>${current.title}</strong><span>${current.paramsLabel}</span></div>
            <div class="runs-compare-grid" style=${{ gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(220px, 1fr))` }}>
              ${runs.map((run, index) => {
                const item = maps[index].get(current.key);
                const hasCode = !!item?.code?.trim();
                return html`<div class="runs-compare-card" key=${run.id}>
                  <div class="runs-compare-card-head" title=${run.modelId || run.model}>${run.model}</div>
                  <div class="runs-compare-canvas">
                    ${hasCode ? html`<${CanvasPreview} code=${item.code} params=${item.params || {}} seed=${item.metadata?.seed || 1} playing=${true} />`
                      : html`<div class="runs-compare-empty"><i class="fa-solid fa-ban"></i><span>${item?.error || 'Not in this run'}</span></div>`}
                  </div>
                  <div class="runs-compare-meta">
                    ${statsLine(item?.metadata?.generationStats || item?.generationStats) && html`<span>${statsLine(item?.metadata?.generationStats || item?.generationStats)}</span>`}
                    ${item?.projectId && html`<button class="btn btn-xs" onClick=${() => onOpenProject?.(item.projectId)}><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</button>`}
                  </div>
                </div>`;
              })}
            </div>
            <div class="batch-review-nav"><button class="btn btn-sm" onClick=${() => step(-1)} disabled=${jobs.length < 2}><i class="fa-solid fa-chevron-left"></i></button><span>${position + 1} / ${jobs.length}</span><button class="btn btn-sm" onClick=${() => step(1)} disabled=${jobs.length < 2}><i class="fa-solid fa-chevron-right"></i></button></div>
          ` : html`<div class="runs-empty"><i class="fa-solid fa-code"></i><p>No comparable sketches in these runs.</p></div>`}
        </div>
      </div>
    </div>
  `;
}

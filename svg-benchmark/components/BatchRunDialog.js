import { html } from 'htm/preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import { runBatch } from '../services/batchRunner.js';
import { BatchReview, SvgLive } from './BatchReview.js';
import { PARAM_SPEC, expandSweep, paramsSignature } from '../../shared/services/gen-params.js';

// Each parameter field takes a comma-separated list: one value pins it, several
// sweep it, empty sends nothing (server default). "0, 0.7, 1.2" on temperature
// runs every selected prompt three times.
function buildGrid(paramText) {
  const grid = {};
  for (const spec of PARAM_SPEC) {
    const raw = (paramText[spec.key] || '').trim();
    if (!raw) continue;
    const values = raw.split(',').map(s => s.trim()).filter(Boolean).map((token) => {
      if (spec.type === 'bool') return /^(true|1|yes|on)$/i.test(token);
      if (spec.type === 'enum') return token;
      const n = Number(token);
      return Number.isNaN(n) ? null : n;
    }).filter(v => v !== null);
    if (values.length) grid[spec.key] = values;
  }
  return grid;
}

function paramPlaceholder(spec) {
  if (spec.type === 'enum') return spec.values.join(' | ');
  if (spec.type === 'bool') return 'true | false';
  return 'server default';
}

const STATUS_META = {
  queued:     { icon: 'fa-regular fa-circle',            cls: 'queued',  label: 'Queued' },
  generating: { icon: 'fa-solid fa-bolt',               cls: 'active',  label: 'Generating' },
  validating: { icon: 'fa-solid fa-check-double',       cls: 'active',  label: 'Validating' },
  healing:    { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active',  label: 'Fixing' },
  scoring:    { icon: 'fa-solid fa-ruler-combined',     cls: 'active',  label: 'Scoring' },
  saved:      { icon: 'fa-solid fa-circle-check',       cls: 'ok',      label: 'Saved' },
  skipped:    { icon: 'fa-solid fa-forward',            cls: 'skipped', label: 'Skipped' },
  error:      { icon: 'fa-solid fa-triangle-exclamation', cls: 'error', label: 'Failed' },
  stopped:    { icon: 'fa-solid fa-hand',               cls: 'skipped', label: 'Stopped' },
};

export function BatchRunDialog({
  prompts,               // merged benchmark prompts: [{ slug, title, prompt, existingSubmissions }]
  model,                 // { providerId, modelId, label }
  allModels,
  modelsLoading,
  onModelChange,
  onProviderSettingsClick,
  hasDirectory,
  onPickDirectory,
  deps,
  onOpenBenchmarks,
  onOpenBenchmark,
  onOpenRuns,
  onClose,
  addToast,
}) {
  const [phase, setPhase] = useState('config'); // config | running | done | history | past

  const [selectedIds, setSelectedIds] = useState(() => new Set(prompts.map(p => p.slug)));

  const [heal, setHeal] = useState(false);
  const [healAttempts, setHealAttempts] = useState(1);
  const [saveBothOnHeal] = useState(true);
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(1);
  const [delaySec, setDelaySec] = useState(0);

  const [paramText, setParamText] = useState({});
  const [showParams, setShowParams] = useState(false);

  const [items, setItems] = useState([]);
  const [runList, setRunList] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [summary, setSummary] = useState(null);
  const [previewSvg, setPreviewSvg] = useState('');
  const [results, setResults] = useState([]);   // run index -> final SVG markup
  const [reviewNav, setReviewNav] = useState(null); // ‹ › nav lifted from BatchReview into the footer
  const stopRef = useRef(false);
  const listEndRef = useRef(null);

  // Past runs (rebuilt from saved submissions)
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [pastRun, setPastRun] = useState(null);   // { id, model, startedAt, items: [...with svg] }

  const hasModel = !!(model?.providerId && model?.modelId);
  const selectedCount = selectedIds.size;

  const combos = useMemo(() => expandSweep(buildGrid(paramText)), [paramText]);
  const isSweep = combos.length > 1;
  const totalRuns = selectedCount * combos.length;

  const alreadyRunCount = useMemo(() => {
    if (!hasModel) return 0;
    let n = 0;
    for (const p of prompts) {
      if (!selectedIds.has(p.slug)) continue;
      try { if (deps.hasExistingForModel?.(p, model)) n++; } catch (e) { /* ignore */ }
    }
    return n;
  }, [prompts, selectedIds, model, hasModel, deps]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'running') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const toggleOne = useCallback((slug) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => setSelectedIds(new Set(prompts.map(p => p.slug))), [prompts]);
  const selectNone = useCallback(() => setSelectedIds(new Set()), []);

  const handleEvent = useCallback((event) => {
    if (event.type === 'item') {
      if (event.status === 'start') { setActiveIndex(event.index); return; }
      setItems(prev => {
        const next = prev.slice();
        const cur = next[event.index] || {};
        next[event.index] = {
          ...cur,
          status: event.status,
          message: event.message || cur.message || '',
          healAttempt: event.healAttempt || cur.healAttempt || 0,
          healed: event.healed ?? cur.healed,
          valid: event.valid ?? cur.valid,
          autoScore: event.autoScore ?? cur.autoScore,
        };
        return next;
      });
    } else if (event.type === 'preview' || event.type === 'chunk') {
      setPreviewSvg(event.svg || '');
      if (event.type === 'preview') {
        setResults(prev => {
          const next = prev.slice();
          next[event.index] = event.svg || '';
          return next;
        });
      }
    } else if (event.type === 'stats') {
      setItems(prev => {
        const next = prev.slice();
        next[event.index] = { ...(next[event.index] || {}), stats: event.stats };
        return next;
      });
    } else if (event.type === 'done') {
      setSummary(event.summary);
    }
  }, []);

  useEffect(() => {
    if (phase === 'running') listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [items, phase]);

  // ── Review rows for the run that just finished ──
  const doneRows = useMemo(() => runList.map((p, idx) => {
    const it = items[idx] || { status: 'queued' };
    const m = STATUS_META[it.status] || STATUS_META.queued;
    return {
      key: p.jobKey || p.slug, title: p.title, prompt: p.prompt, slug: p.slug,
      svg: results[idx] || '',
      icon: m.icon, cls: m.cls, label: m.label,
      autoScore: it.autoScore, healed: it.healed, stats: it.stats,
      paramsLabel: p.params && Object.keys(p.params).length ? paramsSignature(p.params) : null,
      error: it.status === 'error' ? it.message : '',
    };
  }), [runList, items, results]);

  // ── Past runs ──
  const openHistory = useCallback(async () => {
    setPhase('history');
    setRunsLoading(true);
    try {
      setRuns(await deps.listRuns());
    } catch (e) {
      addToast('Could not read past runs: ' + e.message, 'error');
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [deps, addToast]);

  const openPastRun = useCallback(async (run) => {
    setRunsLoading(true);
    try {
      const withSvgs = await deps.loadRunSvgs(run.items);
      setPastRun({ ...run, items: withSvgs });
      setPhase('past');
    } catch (e) {
      addToast('Could not load that run: ' + e.message, 'error');
    } finally {
      setRunsLoading(false);
    }
  }, [deps, addToast]);

  const pastRows = useMemo(() => (pastRun?.items || []).map((it, i) => ({
    key: it.submissionId || String(i),
    title: it.title || it.slug,
    prompt: it.prompt,
    slug: it.slug,
    svg: it.svg || '',
    icon: it.svg ? STATUS_META.saved.icon : STATUS_META.error.icon,
    cls: it.svg ? 'ok' : 'error',
    label: it.valid === false ? 'Invalid' : 'Saved',
    autoScore: it.autoScore,
    healed: it.healed,
    stats: it.stats,
    paramsLabel: it.params && Object.keys(it.params).length ? (it.paramsLabel || paramsSignature(it.params)) : null,
    error: it.svg ? '' : 'SVG file missing',
  })), [pastRun]);

  const start = useCallback(async () => {
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    if (!hasDirectory) { addToast('Connect a directory first — submissions are saved there', 'error'); return; }
    const chosen = prompts.filter(p => selectedIds.has(p.slug));
    if (chosen.length === 0) { addToast('Select at least one prompt', 'error'); return; }

    // One job per prompt × parameter set. With no sweep this is just the prompts.
    const list = [];
    for (const p of chosen) {
      for (const params of combos) {
        list.push({
          ...p,
          params,
          jobKey: `${p.slug}#${paramsSignature(params)}`,
          title: combos.length > 1 ? `${p.title} · ${paramsSignature(params)}` : p.title,
        });
      }
    }

    setRunList(list);
    setItems(list.map(() => ({ status: 'queued' })));
    setSummary(null);
    setPreviewSvg('');
    setResults([]);
    setActiveIndex(-1);
    stopRef.current = false;
    setPhase('running');

    try {
      await runBatch({
        prompts: list,
        model,
        options: {
          heal, healAttempts, saveBothOnHeal, skipExisting,
          delayMs: Math.max(0, Math.round(delaySec * 1000)),
          apiRetries,
        },
        deps,
        onEvent: handleEvent,
        shouldStop: () => stopRef.current,
      });
    } catch (e) {
      addToast('Batch run error: ' + e.message, 'error');
    } finally {
      setActiveIndex(-1);
      setPhase('done');
    }
  }, [hasModel, hasDirectory, prompts, selectedIds, combos, model, heal, healAttempts, saveBothOnHeal,
      skipExisting, delaySec, apiRetries, deps, handleEvent, addToast]);

  const stop = useCallback(() => {
    stopRef.current = true;
    addToast('Stopping after the current prompt…', 'info');
  }, [addToast]);

  const doneCount = items.filter(it => ['saved', 'skipped', 'error', 'stopped'].includes(it.status)).length;
  const progressPct = runList.length ? Math.round((doneCount / runList.length) * 100) : 0;

  const fmtScore = (s) => (s == null ? '' : `${Math.round(s * 100)}%`);

  // ── Renderers ──

  const renderConfig = () => html`
    <div class="modal-body batch-config">
      <div class=${`batch-model-row ${hasModel ? '' : 'warn'}`}>
        <div class="batch-model-label">
          <i class=${`fa-solid ${hasModel ? 'fa-microchip' : 'fa-triangle-exclamation'}`}></i>
          ${hasModel
            ? html`<span>Model: <strong>${model.label || model.modelId}</strong></span>`
            : html`<span>No model loaded — pick one to run the batch</span>`}
        </div>
        <${ProviderModelSelector}
          models=${allModels}
          providerId=${model?.providerId || ''}
          modelId=${model?.modelId || ''}
          onChange=${onModelChange}
          disabled=${allModels.length === 0 && !modelsLoading}
          loading=${modelsLoading}
          onSettingsClick=${onProviderSettingsClick}
        />
      </div>

      ${!hasDirectory && html`
        <div class="batch-dir-hint">
          <i class="fa-solid fa-circle-info"></i>
          Connect a directory — submissions are saved there.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Pick Directory</button>
        </div>
      `}

      <div class="batch-section">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-list-check"></i> Prompts (${selectedCount}/${prompts.length})</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${selectAll}>All</button>
            <button class="btn btn-xs" onClick=${selectNone}>None</button>
          </span>
        </div>
        <div class="batch-prompt-list">
          ${prompts.length === 0
            ? html`<div class="batch-empty">No prompts found. Harvest fails silently if data/prompts.json is missing.</div>`
            : prompts.map(p => html`
              <label class="batch-prompt-row" key=${p.slug}>
                <input type="checkbox" checked=${selectedIds.has(p.slug)} onChange=${() => toggleOne(p.slug)} />
                <span class="batch-prompt-title" title=${p.prompt}>${p.title}</span>
                ${hasModel && (() => { try { return deps.hasExistingForModel?.(p, model); } catch (e) { return false; } })()
                  ? html`<span class="batch-prompt-badge" title="Already has a submission for this model">has run</span>`
                  : (p.existingSubmissions > 0
                    ? html`<span class="batch-prompt-badge subtle" title="Existing submissions from other models">${p.existingSubmissions}</span>`
                    : null)}
              </label>
            `)}
        </div>
        ${skipExisting && alreadyRunCount > 0 && html`
          <div class="batch-note"><i class="fa-solid fa-forward"></i> ${alreadyRunCount} selected prompt${alreadyRunCount === 1 ? '' : 's'} will be skipped (already run for this model).</div>
        `}
      </div>

      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-sliders"></i> Options</span></div>
        <div class="batch-options">
          <label class="batch-opt">
            <input type="checkbox" checked=${heal} onChange=${(e) => setHeal(e.target.checked)} />
            <span>Auto-fix invalid SVG</span>
          </label>
          ${heal && html`
            <label class="batch-opt batch-opt-indent">
              <span>Max attempts</span>
              <select class="form-input batch-num" value=${healAttempts} onChange=${(e) => setHealAttempts(Number(e.target.value))}>
                ${[1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
              <span class="batch-opt-hint">keeps both the original and fixed versions</span>
            </label>
          `}
          <label class="batch-opt">
            <input type="checkbox" checked=${skipExisting} onChange=${(e) => setSkipExisting(e.target.checked)} />
            <span>Skip prompts already run for this model</span>
          </label>
          <label class="batch-opt">
            <span>Retry on API failure</span>
            <select class="form-input batch-num" value=${apiRetries} onChange=${(e) => setApiRetries(Number(e.target.value))}>
              ${[0, 1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
            </select>
          </label>
          <label class="batch-opt">
            <span>Delay between prompts</span>
            <input class="form-input batch-num" type="number" min="0" max="120" step="1"
              value=${delaySec} onChange=${(e) => setDelaySec(Math.max(0, Number(e.target.value) || 0))} />
            <span class="batch-opt-hint">seconds</span>
          </label>
        </div>
        <div class="batch-note"><i class="fa-solid fa-ruler-combined"></i> Benchmarks with a reference image are auto-scored as they run.</div>
      </div>

      <div class="batch-section">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-sliders-up"></i> Parameters</span>
          <button class="btn btn-xs" onClick=${() => setShowParams(v => !v)}>
            <i class=${`fa-solid ${showParams ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            ${showParams ? 'Hide' : (isSweep ? `Sweep · ${combos.length} sets` : 'Server defaults')}
          </button>
        </div>

        ${showParams && html`
          <div class="batch-params">
            <div class="batch-note">
              <i class="fa-solid fa-circle-info"></i>
              Leave blank to use the model's settings in LM Studio. One value pins it;
              a comma-separated list sweeps it — e.g. <code>0, 0.7, 1.2</code>.
            </div>
            <div class="batch-param-grid">
              ${PARAM_SPEC.map(spec => html`
                <label class="batch-param" key=${spec.key} title=${spec.hint || ''}>
                  <span class="batch-param-label">${spec.label}</span>
                  <input
                    class="form-input"
                    type="text"
                    placeholder=${paramPlaceholder(spec)}
                    value=${paramText[spec.key] || ''}
                    onInput=${(e) => setParamText(prev => ({ ...prev, [spec.key]: e.target.value }))}
                  />
                </label>
              `)}
            </div>
            ${paramText.max_tokens && html`
              <div class="batch-note batch-warn">
                <i class="fa-solid fa-triangle-exclamation"></i>
                A thinking model can spend the whole Max Tokens budget reasoning and return nothing —
                leave it blank unless you mean it.
              </div>
            `}
            <div class="batch-note">
              <i class="fa-solid fa-layer-group"></i>
              ${combos.length === 1
                ? html`One parameter set: <strong>${paramsSignature(combos[0])}</strong>`
                : html`<strong>${combos.length}</strong> parameter sets × ${selectedCount} prompt${selectedCount === 1 ? '' : 's'} = <strong>${totalRuns}</strong> generations`}
            </div>
          </div>
        `}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary btn-generate" onClick=${start} disabled=${!hasModel || !hasDirectory || selectedCount === 0}>
        <i class="fa-solid fa-play"></i> Go — run ${totalRuns} generation${totalRuns === 1 ? '' : 's'}
      </button>
    </div>
  `;

  const renderRunning = () => html`
    <div class="modal-body batch-running">
      <div class="batch-progress">
        <div class="batch-progress-bar"><div class="batch-progress-fill" style=${{ width: progressPct + '%' }}></div></div>
        <div class="batch-progress-text">${doneCount} / ${runList.length} done${activeIndex >= 0 ? ` · running "${runList[activeIndex]?.title || ''}"` : ''}</div>
      </div>

      <div class="batch-run-body">
        <div class="batch-run-list">
          ${runList.map((p, idx) => {
            const it = items[idx] || { status: 'queued' };
            const m = STATUS_META[it.status] || STATUS_META.queued;
            const isActive = idx === activeIndex;
            return html`
              <div class=${`batch-run-item ${m.cls} ${isActive ? 'is-active' : ''}`} key=${p.jobKey || p.slug}>
                <i class=${`batch-run-icon fa ${m.icon} ${m.cls === 'active' ? 'fa-fade' : ''}`}></i>
                <span class="batch-run-title" title=${p.title}>${p.title}</span>
                <span class="batch-run-status">
                  ${it.status === 'healing' && it.healAttempt ? `fix ${it.healAttempt}` : m.label}
                  ${it.status === 'saved' && it.autoScore != null ? html` <span class="batch-score-chip">${fmtScore(it.autoScore)}</span>` : null}
                  ${it.healed && it.status === 'saved' ? html` <span class="batch-healed-chip">fixed</span>` : null}
                </span>
              </div>
            `;
          })}
          <div ref=${listEndRef}></div>
        </div>
        <div class="batch-preview">
          ${previewSvg
            ? html`<${SvgLive} svg=${previewSvg} />`
            : html`<div class="batch-preview-empty"><i class="fa-solid fa-hourglass-half"></i><span>Live preview appears here</span></div>`}
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-danger" onClick=${stop} disabled=${stopRef.current}>
        <i class="fa-solid fa-stop"></i> ${stopRef.current ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  `;

  const renderDone = () => html`
    <div class="modal-body batch-done">
      <div class="batch-summary">
        <div class="batch-summary-icon"><i class="fa-solid fa-flag-checkered"></i></div>
        <div class="batch-summary-grid">
          <div class="batch-stat"><strong>${summary?.generated || 0}</strong><span>generated</span></div>
          <div class="batch-stat"><strong>${summary?.scored || 0}</strong><span>scored</span></div>
          <div class="batch-stat"><strong>${summary?.healed || 0}</strong><span>fixed</span></div>
          <div class="batch-stat"><strong>${summary?.saved || 0}</strong><span>saved</span></div>
          <div class="batch-stat"><strong>${summary?.skipped || 0}</strong><span>skipped</span></div>
          <div class=${`batch-stat ${summary?.failed ? 'is-bad' : ''}`}><strong>${summary?.failed || 0}</strong><span>failed</span></div>
        </div>
        ${summary?.stopped ? html`<div class="batch-note"><i class="fa-solid fa-hand"></i> Run stopped early.</div>` : null}
      </div>

      <${BatchReview} rows=${doneRows} resetKey=${'current'} onOpenBenchmark=${onOpenBenchmark}
        hideNav=${true} onNav=${setReviewNav} />
    </div>

    <div class="modal-footer">
      ${reviewNav && reviewNav.count > 0 && html`
        <div class="batch-footer-nav">
          <button class="btn btn-sm" title="Previous (←)" onClick=${() => reviewNav.step(-1)} disabled=${!reviewNav.canStep}>
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="batch-review-count">${reviewNav.current} / ${reviewNav.count}</span>
          <button class="btn btn-sm" title="Next (→)" onClick=${() => reviewNav.step(1)} disabled=${!reviewNav.canStep}>
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      `}
      <button class="btn" onClick=${() => setPhase('config')}><i class="fa-solid fa-rotate-left"></i> New Run</button>
      <button class="btn btn-primary" onClick=${() => { onOpenBenchmarks?.(); onClose(); }}>
        <i class="fa-solid fa-grid-2"></i> View Benchmarks
      </button>
    </div>
  `;

  const fmtWhen = (iso) => {
    if (!iso) return 'unknown date';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleString();
  };

  const renderHistory = () => html`
    <div class="modal-body batch-history">
      <div class="batch-note">
        <i class="fa-solid fa-clock-rotate-left"></i>
        Every past batch run, rebuilt from the saved submissions in your data folder.
      </div>

      ${runsLoading
        ? html`<div class="batch-empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading submissions…</div>`
        : runs.length === 0
          ? html`<div class="batch-empty">No batch runs found yet — submissions from older, non-batch generations aren't grouped into runs.</div>`
          : html`
            <div class="batch-run-list batch-history-list">
              ${runs.map(r => html`
                <div class="batch-run-item is-reviewable" key=${r.id} onClick=${() => openPastRun(r)}>
                  <i class="batch-run-icon fa fa-solid fa-layer-group"></i>
                  <span class="batch-history-model" title=${r.modelId || r.model}>${r.model}</span>
                  <span class="batch-history-when">${fmtWhen(r.startedAt)}</span>
                  <span class="batch-run-status">
                    ${r.count} SVG${r.count === 1 ? '' : 's'}
                    ${r.avgScore != null ? html` <span class="batch-score-chip" title="Average auto-score">avg ${fmtScore(r.avgScore)}</span>` : null}
                    <i class="fa-solid fa-chevron-right"></i>
                  </span>
                </div>
              `)}
            </div>
          `}
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${() => setPhase(summary ? 'done' : 'config')}>
        <i class="fa-solid fa-arrow-left"></i> Back
      </button>
    </div>
  `;

  const renderPastRun = () => html`
    <div class="modal-body batch-done">
      <div class="batch-summary">
        <div class="batch-summary-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
        <div class="batch-past-head">
          <strong>${pastRun?.model}</strong>
          <span>${fmtWhen(pastRun?.startedAt)} · ${pastRun?.count} SVG${pastRun?.count === 1 ? '' : 's'}${pastRun?.avgScore != null ? ` · avg ${fmtScore(pastRun.avgScore)}` : ''}</span>
        </div>
      </div>

      <${BatchReview} rows=${pastRows} resetKey=${pastRun?.id} onOpenBenchmark=${onOpenBenchmark} />
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${() => setPhase('history')}><i class="fa-solid fa-arrow-left"></i> All Runs</button>
      <button class="btn btn-primary" onClick=${() => { onOpenBenchmarks?.(); onClose(); }}>
        <i class="fa-solid fa-grid-2"></i> View Benchmarks
      </button>
    </div>
  `;

  const HEADINGS = {
    history: { icon: 'fa-clock-rotate-left', text: 'Past Runs' },
    past:    { icon: 'fa-clock-rotate-left', text: 'Past Run' },
  };
  const heading = HEADINGS[phase] || { icon: 'fa-layer-group', text: 'Batch Run' };

  return html`
    <div class="modal-overlay">
      <div class="modal batch-dialog" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2><i class=${`fa-solid ${heading.icon}`}></i> ${heading.text}</h2>
          <div class="batch-header-actions">
            ${(phase === 'config' || phase === 'done') && hasDirectory && html`
              <button class="btn btn-sm" onClick=${onOpenRuns || openHistory}
                title="Browse and compare batch runs saved earlier, from any model">
                <i class="fa-solid fa-clock-rotate-left"></i> Past Runs
              </button>
            `}
            ${phase !== 'running' && html`
              <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
            `}
          </div>
        </div>
        ${phase === 'config' ? renderConfig()
          : phase === 'running' ? renderRunning()
          : phase === 'history' ? renderHistory()
          : phase === 'past' ? renderPastRun()
          : renderDone()}
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import { PARAM_SPEC, expandSweep, paramsSignature } from '../../shared/services/gen-params.js';
import { runBatch } from '../services/batchRunner.js';
import { CanvasPreview } from './CanvasPreview.js';
import { BatchReview } from './BatchReview.js';

const STATUS = {
  queued: { icon: 'fa-regular fa-circle', className: 'queued', label: 'Queued' },
  generating: { icon: 'fa-solid fa-bolt', className: 'active', label: 'Generating' },
  validating: { icon: 'fa-solid fa-check-double', className: 'active', label: 'Validating' },
  rendering: { icon: 'fa-solid fa-camera', className: 'active', label: 'Rendering' },
  saving: { icon: 'fa-solid fa-floppy-disk', className: 'active', label: 'Saving' },
  saved: { icon: 'fa-solid fa-circle-check', className: 'ok', label: 'Saved' },
  skipped: { icon: 'fa-solid fa-forward', className: 'skipped', label: 'Skipped' },
  error: { icon: 'fa-solid fa-triangle-exclamation', className: 'error', label: 'Failed' },
  stopped: { icon: 'fa-solid fa-hand', className: 'skipped', label: 'Stopped' },
};

function parseGrid(values) {
  const grid = {};
  for (const spec of PARAM_SPEC) {
    const raw = String(values[spec.key] || '').trim();
    if (!raw) continue;
    const parsed = raw.split(',').map(token => token.trim()).filter(Boolean).map(token => {
      if (spec.type === 'bool') return /^(true|1|yes|on)$/i.test(token);
      if (spec.type === 'enum') return token;
      const number = Number(token);
      return Number.isNaN(number) ? null : number;
    }).filter(value => value !== null);
    if (parsed.length) grid[spec.key] = parsed;
  }
  return grid;
}

function placeholder(spec) {
  if (spec.type === 'enum') return spec.values.join(' | ');
  if (spec.type === 'bool') return 'true | false';
  return 'server default';
}

export function BatchRunDialog({
  prompts,
  model,
  allModels,
  modelsLoading,
  onModelChange,
  onProviderSettingsClick,
  hasApiKey,
  onApiKeyClick,
  hasDirectory,
  onPickDirectory,
  deps,
  onOpenProject,
  onOpenGallery,
  onOpenRuns,
  onClose,
  addToast,
}) {
  const [phase, setPhase] = useState('config');
  const [selectedIds, setSelectedIds] = useState(() => new Set((prompts || []).map(prompt => prompt.id)));
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(1);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [captureThumbnails, setCaptureThumbnails] = useState(true);
  const [warmupSeconds, setWarmupSeconds] = useState(1);
  const [showParams, setShowParams] = useState(false);
  const [paramText, setParamText] = useState({});

  const [runList, setRunList] = useState([]);
  const [items, setItems] = useState([]);
  const [results, setResults] = useState([]);
  const [preview, setPreview] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [summary, setSummary] = useState(null);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRef = useRef(false);
  const previewApiRef = useRef(null);

  const [pastRuns, setPastRuns] = useState([]);
  const [pastRun, setPastRun] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const hasModel = !!(model?.providerId && model?.modelId);
  const needsApiKey = model?.providerType === 'openrouter' && !hasApiKey;
  const selectedCount = selectedIds.size;
  const combinations = useMemo(() => expandSweep(parseGrid(paramText)), [paramText]);
  const totalJobs = selectedCount * combinations.length;

  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const togglePrompt = useCallback(id => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleEvent = useCallback(event => {
    if (event.type === 'item') {
      if (event.status === 'start') { setActiveIndex(event.index); return; }
      setItems(current => {
        const next = current.slice();
        next[event.index] = {
          ...(next[event.index] || {}),
          status: event.status,
          message: event.message || next[event.index]?.message || '',
          savedId: event.savedId || next[event.index]?.savedId || '',
        };
        return next;
      });
    } else if (event.type === 'chunk') {
      setPreview(current => ({ ...(current || {}), code: event.code || '', params: current?.params || {}, seed: current?.seed || 1 }));
    } else if (event.type === 'preview') {
      const value = { code: event.code || '', params: event.params || {}, seed: event.seed || 1 };
      setPreview(value);
      setResults(current => {
        const next = current.slice();
        next[event.index] = { ...(next[event.index] || {}), ...value };
        return next;
      });
    } else if (event.type === 'stats') {
      setItems(current => {
        const next = current.slice();
        next[event.index] = { ...(next[event.index] || {}), stats: event.stats };
        return next;
      });
    } else if (event.type === 'done') {
      setSummary(event.summary);
    }
  }, []);

  const start = useCallback(async () => {
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    if (needsApiKey) { addToast('Set your OpenRouter API key first', 'error'); onApiKeyClick?.(); return; }
    if (!hasDirectory) { addToast('Connect a directory first', 'error'); return; }
    const selected = (prompts || []).filter(prompt => selectedIds.has(prompt.id));
    if (!selected.length) { addToast('Select at least one prompt', 'error'); return; }

    const jobs = [];
    for (const prompt of selected) {
      for (const generationParams of combinations) {
        const signature = paramsSignature(generationParams);
        jobs.push({
          ...prompt,
          generationParams,
          jobKey: `${prompt.id}#${signature}`,
          runTitle: combinations.length > 1 ? `${prompt.title} · ${signature}` : prompt.title,
        });
      }
    }

    deps.beginRun?.();

    setRunList(jobs);
    setItems(jobs.map(() => ({ status: 'queued' })));
    setResults([]);
    setSummary(null);
    setPreview(null);
    setActiveIndex(-1);
    setStopRequested(false);
    stopRef.current = false;
    setPhase('running');

    const capture = async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (warmupSeconds > 0) await new Promise(resolve => setTimeout(resolve, warmupSeconds * 1000));
      return previewApiRef.current?.capture?.() || null;
    };

    try {
      await runBatch({
        prompts: jobs,
        model,
        options: {
          skipExisting,
          apiRetries,
          delayMs: Math.round(delaySeconds * 1000),
          captureThumbnails,
        },
        deps: { ...deps, capture },
        onEvent: handleEvent,
        shouldStop: () => stopRef.current,
      });
    } catch (error) {
      addToast('Batch run failed: ' + error.message, 'error');
    } finally {
      setActiveIndex(-1);
      setPhase('done');
    }
  }, [hasModel, needsApiKey, hasDirectory, prompts, selectedIds, combinations, model, skipExisting, apiRetries,
    delaySeconds, captureThumbnails, warmupSeconds, deps, handleEvent, addToast, onApiKeyClick]);

  const requestStop = () => {
    stopRef.current = true;
    setStopRequested(true);
    addToast('Stopping after the current generation…', 'info');
  };

  const openHistory = useCallback(async () => {
    setPhase('history');
    setHistoryLoading(true);
    try { setPastRuns(await deps.listRuns()); }
    catch (error) { addToast('Could not read past batch runs: ' + error.message, 'error'); }
    finally { setHistoryLoading(false); }
  }, [deps, addToast]);

  const openPastRun = useCallback(async run => {
    setHistoryLoading(true);
    try {
      const projects = await deps.loadRunProjects(run.items);
      setPastRun({ ...run, items: projects });
      setPhase('past');
    } catch (error) {
      addToast('Could not load that batch run: ' + error.message, 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [deps, addToast]);

  const finished = items.filter(item => ['saved', 'skipped', 'error', 'stopped'].includes(item.status)).length;
  const progress = runList.length ? Math.round((finished / runList.length) * 100) : 0;
  const alreadyRun = (prompts || []).filter(prompt => selectedIds.has(prompt.id) && deps.hasExistingForModel?.(prompt, model)).length;

  const currentRows = runList.map((job, index) => {
    const item = items[index] || { status: 'queued' };
    const status = STATUS[item.status] || STATUS.queued;
    return {
      key: job.jobKey,
      title: job.runTitle,
      code: results[index]?.code || '',
      params: results[index]?.params || {},
      seed: results[index]?.seed || 1,
      paramsLabel: paramsSignature(job.generationParams),
      stats: item.stats,
      savedId: item.savedId,
      statusClass: status.className,
      statusLabel: item.message || status.label,
      icon: status.icon,
    };
  });

  const pastRows = (pastRun?.items || []).map((project, index) => ({
    key: project.projectId || index,
    title: project.metadata?.title || project.title,
    code: project.code || '',
    params: project.params || {},
    seed: project.metadata?.seed || 1,
    paramsLabel: paramsSignature(project.metadata?.generationParams || project.generationParams || {}),
    stats: project.metadata?.generationStats || project.generationStats,
    savedId: project.projectId,
    statusClass: project.error ? 'error' : 'ok',
    statusLabel: project.error || 'Saved',
    icon: project.error ? STATUS.error.icon : STATUS.saved.icon,
  }));

  const renderConfig = () => html`
    <div class="modal-body batch-config">
      <div class=${`batch-model-row ${hasModel && !needsApiKey ? '' : 'warn'}`}>
        <div class="batch-model-label"><i class="fa-solid fa-microchip"></i><span>Model: <strong>${model?.label || 'not selected'}</strong>${needsApiKey ? ' · API key required' : ''}</span></div>
        <${ProviderModelSelector}
          models=${allModels}
          providerId=${model?.providerId || ''}
          modelId=${model?.modelId || ''}
          onChange=${onModelChange}
          disabled=${allModels.length === 0 && !modelsLoading}
          loading=${modelsLoading}
          onSettingsClick=${onProviderSettingsClick}
        />
        ${needsApiKey && html`<button class="btn btn-sm" onClick=${onApiKeyClick}><i class="fa-solid fa-key"></i> Set key</button>`}
      </div>

      ${!hasDirectory && html`
        <div class="batch-dir-hint"><i class="fa-solid fa-circle-info"></i> Batch sketches need a data root.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Connect</button>
        </div>
      `}

      <div class="batch-section">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-list-check"></i> Prompts (${selectedCount}/${prompts.length})</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${() => setSelectedIds(new Set(prompts.map(prompt => prompt.id)))}>All</button>
            <button class="btn btn-xs" onClick=${() => setSelectedIds(new Set())}>None</button>
          </span>
        </div>
        <div class="batch-prompt-list">
          ${prompts.map(prompt => html`
            <label class="batch-prompt-row" key=${prompt.id}>
              <input type="checkbox" checked=${selectedIds.has(prompt.id)} onChange=${() => togglePrompt(prompt.id)} />
              <span class="batch-prompt-title" title=${prompt.prompt}>${prompt.title}</span>
              <span class="batch-prompt-category">${prompt.category}</span>
              ${deps.hasExistingForModel?.(prompt, model) && html`<span class="batch-prompt-badge">has run</span>`}
            </label>
          `)}
        </div>
        ${skipExisting && alreadyRun > 0 && html`<div class="batch-note"><i class="fa-solid fa-forward"></i> ${alreadyRun} selected prompt${alreadyRun === 1 ? '' : 's'} will be skipped.</div>`}
      </div>

      <div class="batch-section batch-config-columns">
        <div>
          <div class="batch-section-head"><span><i class="fa-solid fa-sliders"></i> Options</span></div>
          <div class="batch-options">
            <label class="batch-opt"><input type="checkbox" checked=${skipExisting} onChange=${event => setSkipExisting(event.target.checked)} /> Skip prompts already run by this model</label>
            <label class="batch-opt"><input type="checkbox" checked=${captureThumbnails} onChange=${event => setCaptureThumbnails(event.target.checked)} /> Capture gallery thumbnails</label>
            ${captureThumbnails && html`<label class="batch-opt batch-opt-indent">Warm-up <input class="form-input batch-num" type="number" min="0" max="10" step="0.5" value=${warmupSeconds} onInput=${event => setWarmupSeconds(Math.max(0, Number(event.target.value) || 0))} /> seconds</label>`}
            <label class="batch-opt">API retries <select class="form-input batch-num" value=${apiRetries} onChange=${event => setApiRetries(Number(event.target.value))}>${[0, 1, 2, 3].map(value => html`<option value=${value}>${value}</option>`)}</select></label>
            <label class="batch-opt">Delay <input class="form-input batch-num" type="number" min="0" max="120" value=${delaySeconds} onInput=${event => setDelaySeconds(Math.max(0, Number(event.target.value) || 0))} /> seconds</label>
          </div>
        </div>
        <div>
          <div class="batch-section-head"><span><i class="fa-solid fa-sliders-up"></i> Generation parameters</span>
            <button class="btn btn-xs" onClick=${() => setShowParams(value => !value)}>${showParams ? 'Hide' : combinations.length > 1 ? `${combinations.length} sets` : 'Defaults'}</button>
          </div>
          <div class="batch-note">Leave blank for provider defaults; comma-separated values create a sweep.</div>
        </div>
      </div>

      ${showParams && html`
        <div class="batch-param-grid">
          ${PARAM_SPEC.map(spec => html`
            <label class="batch-param" key=${spec.key}><span>${spec.label}</span><input class="form-input" placeholder=${placeholder(spec)} value=${paramText[spec.key] || ''} onInput=${event => setParamText(current => ({ ...current, [spec.key]: event.target.value }))} /></label>
          `)}
        </div>
      `}
      <div class="batch-note"><i class="fa-solid fa-layer-group"></i> ${selectedCount} prompts × ${combinations.length} parameter set${combinations.length === 1 ? '' : 's'} = <strong>${totalJobs} append-only generations</strong>.</div>
    </div>
    <div class="modal-footer"><button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary btn-generate" onClick=${start} disabled=${!hasModel || needsApiKey || !hasDirectory || !selectedCount}><i class="fa-solid fa-play"></i> Run ${totalJobs}</button></div>
  `;

  const renderRunning = () => html`
    <div class="modal-body batch-running">
      <div class="batch-progress"><div class="batch-progress-bar"><div class="batch-progress-fill" style=${{ width: progress + '%' }}></div></div><div class="batch-progress-text">${finished} / ${runList.length} done${activeIndex >= 0 ? ` · ${runList[activeIndex]?.runTitle}` : ''}</div></div>
      <div class="batch-run-body">
        <div class="batch-run-list">
          ${runList.map((job, index) => {
            const item = items[index] || { status: 'queued' };
            const status = STATUS[item.status] || STATUS.queued;
            return html`<div class=${`batch-run-item ${status.className} ${activeIndex === index ? 'is-active' : ''}`} key=${job.jobKey}><i class=${`batch-run-icon fa ${status.icon} ${status.className === 'active' ? 'fa-fade' : ''}`}></i><span class="batch-run-title">${job.runTitle}</span><span class="batch-run-status" title=${item.message}>${status.label}</span></div>`;
          })}
        </div>
        <div class="batch-live-preview">
          ${preview ? html`<${CanvasPreview} code=${preview.code} params=${preview.params || {}} seed=${preview.seed || 1} playing=${true} registerApi=${api => { previewApiRef.current = api; }} />`
            : html`<div class="batch-preview-empty"><i class="fa-solid fa-hourglass-half"></i><span>Streaming preview appears here</span></div>`}
        </div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-danger" onClick=${requestStop} disabled=${stopRequested}><i class="fa-solid fa-stop"></i> ${stopRequested ? 'Stopping…' : 'Stop'}</button></div>
  `;

  const renderDone = () => html`
    <div class="modal-body batch-done">
      <div class="batch-summary"><i class="batch-summary-icon fa-solid fa-flag-checkered"></i><div class="batch-summary-grid">
        <div class="batch-stat"><strong>${summary?.generated || 0}</strong><span>generated</span></div>
        <div class="batch-stat"><strong>${summary?.rendered || 0}</strong><span>thumbnails</span></div>
        <div class="batch-stat"><strong>${summary?.saved || 0}</strong><span>saved</span></div>
        <div class="batch-stat"><strong>${summary?.skipped || 0}</strong><span>skipped</span></div>
        <div class=${`batch-stat ${summary?.failed ? 'is-bad' : ''}`}><strong>${summary?.failed || 0}</strong><span>failed</span></div>
      </div></div>
      ${summary?.stopped && html`<div class="batch-note"><i class="fa-solid fa-hand"></i> Run stopped early.</div>`}
      <${BatchReview} rows=${currentRows} resetKey="current" onOpenProject=${onOpenProject} />
    </div>
    <div class="modal-footer"><button class="btn" onClick=${() => setPhase('config')}><i class="fa-solid fa-rotate-left"></i> New Run</button><button class="btn btn-primary" onClick=${() => { onOpenGallery?.(); onClose(); }}><i class="fa-solid fa-images"></i> View Gallery</button></div>
  `;

  const renderHistory = () => html`
    <div class="modal-body batch-history">
      <div class="batch-note"><i class="fa-solid fa-clock-rotate-left"></i> Past runs are rebuilt from append-only project metadata.</div>
      ${historyLoading ? html`<div class="batch-empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading projects…</div>`
        : pastRuns.length ? html`<div class="batch-run-list batch-history-list">${pastRuns.map(run => html`<button class="batch-run-item is-reviewable" onClick=${() => openPastRun(run)} key=${run.id}><i class="batch-run-icon fa-solid fa-layer-group"></i><span class="batch-history-model">${run.model}</span><span class="batch-history-when">${new Date(run.startedAt).toLocaleString()}</span><span class="batch-run-status">${run.count} sketch${run.count === 1 ? '' : 'es'} <i class="fa-solid fa-chevron-right"></i></span></button>`)}</div>`
          : html`<div class="batch-empty">No saved batch runs yet.</div>`}
    </div>
    <div class="modal-footer"><button class="btn" onClick=${() => setPhase(summary ? 'done' : 'config')}><i class="fa-solid fa-arrow-left"></i> Back</button></div>
  `;

  const renderPast = () => html`
    <div class="modal-body batch-done"><div class="batch-past-title"><strong>${pastRun?.model}</strong><span>${new Date(pastRun?.startedAt).toLocaleString()} · ${pastRun?.count} sketches</span></div><${BatchReview} rows=${pastRows} resetKey=${pastRun?.id} onOpenProject=${onOpenProject} /></div>
    <div class="modal-footer"><button class="btn" onClick=${() => setPhase('history')}><i class="fa-solid fa-arrow-left"></i> All Runs</button><button class="btn btn-primary" onClick=${() => { onOpenGallery?.(); onClose(); }}><i class="fa-solid fa-images"></i> View Gallery</button></div>
  `;

  const heading = phase === 'history' ? 'Past Batch Runs' : phase === 'past' ? 'Past Batch Run' : 'Batch Generate';
  return html`
    <div class="modal-overlay">
      <div class="modal batch-dialog" onClick=${event => event.stopPropagation()}>
        <div class="modal-header"><h2><i class="fa-solid fa-layer-group"></i> ${heading}</h2><div class="batch-header-actions">${(phase === 'config' || phase === 'done') && hasDirectory && html`<button class="btn btn-sm" onClick=${onOpenRuns || openHistory}><i class="fa-solid fa-clock-rotate-left"></i> Runs</button>`}${phase !== 'running' && html`<button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>`}</div></div>
        ${phase === 'config' ? renderConfig() : phase === 'running' ? renderRunning() : phase === 'done' ? renderDone() : phase === 'history' ? renderHistory() : renderPast()}
      </div>
    </div>
  `;
}

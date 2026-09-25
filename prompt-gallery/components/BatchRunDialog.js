import { html } from 'htm/preact';
import { Fragment } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CellEditor } from '../../shared/components/CellEditor.js';
import { HtmlLightbox } from './BatchReview.js';
import { runBatch } from '../services/batchRunner.js';
import { PROMPT_SETS, promptSetOf } from '../services/library.js';
import {
  completionTokenCount,
  estimatedTokenCount,
  formatTokensPerSecond,
  tokensPerSecond,
} from '../services/batchMetrics.js';

const STATUS_META = {
  queued:     { icon: 'fa-regular fa-circle',        cls: 'queued',  label: 'Queued' },
  planning:   { icon: 'fa-solid fa-list-check',      cls: 'active',  label: 'Planning' },
  generating: { icon: 'fa-solid fa-bolt',            cls: 'active',  label: 'Generating' },
  checking:   { icon: 'fa-solid fa-flask',           cls: 'active',  label: 'Checking' },
  healing:    { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active', label: 'Healing' },
  auditing:   { icon: 'fa-solid fa-magnifying-glass-chart', cls: 'active', label: 'Auditing' },
  repairing:  { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active', label: 'Repairing' },
  verified:   { icon: 'fa-solid fa-circle-check',    cls: 'ok',      label: 'Verified' },
  warned:     { icon: 'fa-solid fa-circle-question', cls: 'warn',    label: 'Needs review' },
  no_progress:{ icon: 'fa-solid fa-equals',          cls: 'warn',    label: 'No progress' },
  saved:      { icon: 'fa-solid fa-circle-check',    cls: 'ok',      label: 'Saved' },
  skipped:    { icon: 'fa-solid fa-forward',         cls: 'skipped', label: 'Skipped' },
  error:      { icon: 'fa-solid fa-triangle-exclamation', cls: 'error', label: 'Failed' },
  stopped:    { icon: 'fa-solid fa-hand',            cls: 'skipped', label: 'Stopped' },
};

export function BatchRunDialog({
  prompts,               // filtered library prompts available to run
  model,                 // { providerId, modelId, label }
  allModels,             // for the in-dialog model picker
  modelsLoading,
  backend = '',
  selectedProviderId = '',
  selectedModelId = '',
  agentId = 'claude-code',
  agentModelId = '',
  onExecutorChange,
  onProviderSettingsClick,
  hasDirectory,
  onPickDirectory,
  deps,                  // { generate, runSandbox, heal, save, load, hasExistingForModel }
  runId,
  theme = 'dark',
  onOpenGallery,
  onOpenRuns,
  onClose,
  addToast,
}) {
  // phase: 'config' | 'running' | 'done'
  const [phase, setPhase] = useState('config');

  // Selection — start with everything ticked so "just press Go" runs all.
  const [selectedIds, setSelectedIds] = useState(() => new Set(prompts.map(p => p.id)));

  // One prompt set at a time. Ticks are remembered per prompt, but only the set
  // on screen is counted or run, so Core and Advanced never get lumped together.
  const [promptSet, setPromptSet] = useState('core');
  const availableSets = useMemo(
    () => PROMPT_SETS
      .map(s => ({ ...s, count: prompts.filter(p => promptSetOf(p) === s.id).length }))
      .filter(s => s.id === 'core' || s.count > 0),
    [prompts],
  );
  const setPrompts = useMemo(() => prompts.filter(p => promptSetOf(p) === promptSet), [prompts, promptSet]);
  const activeSetMeta = availableSets.find(s => s.id === promptSet);

  // Options
  const [mode, setMode] = useState('quick');
  const [healAttempts, setHealAttempts] = useState(1);
  const [maxRepairRounds, setMaxRepairRounds] = useState(1);
  const [saveBothOnHeal] = useState(true); // per product decision: always keep original + healed
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(1);
  const [delaySec, setDelaySec] = useState(0);
  const [showLiveOutput, setShowLiveOutput] = useState(true);

  // Run state
  const [items, setItems] = useState([]);       // aligned to the run list
  const [runList, setRunList] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inspectedIndex, setInspectedIndex] = useState(-1);
  const [outputs, setOutputs] = useState([]);
  const [outputStats, setOutputStats] = useState([]);
  const [fullscreenIndex, setFullscreenIndex] = useState(-1);
  const [fullscreenLoading, setFullscreenLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [pauseState, setPauseState] = useState('running'); // running | pausing | paused
  const [pauseContext, setPauseContext] = useState(null);
  const [rateClock, setRateClock] = useState(() => Date.now());
  const stopRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const pauseResolverRef = useRef(null);
  const listEndRef = useRef(null);
  const activeIndexRef = useRef(-1);
  const followActiveRef = useRef(true);
  const showLiveOutputRef = useRef(showLiveOutput);
  const fullscreenIndexRef = useRef(-1);
  const streamTimingsRef = useRef([]);
  showLiveOutputRef.current = showLiveOutput;
  fullscreenIndexRef.current = fullscreenIndex;

  const activeBackend = backend || model?.backend || 'model';
  const activeProviderId = selectedProviderId || (activeBackend === 'model' ? model?.providerId : '');
  const activeModelId = selectedModelId || (activeBackend === 'model' ? model?.modelId : '');
  const hasModel = !!(model?.providerId && model?.modelId);
  const selectedCount = setPrompts.filter(p => selectedIds.has(p.id)).length;

  const alreadyRunCount = useMemo(() => {
    if (!hasModel) return 0;
    let n = 0;
    for (const p of setPrompts) {
      if (!selectedIds.has(p.id)) continue;
      try { if (deps.hasExistingForModel?.(p, model)) n++; } catch (e) { /* ignore */ }
    }
    return n;
  }, [setPrompts, selectedIds, model, hasModel, deps]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'running') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const toggleOne = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // All / None touch only the set on screen.
  const selectAll = useCallback(() => setSelectedIds(prev => {
    const next = new Set(prev);
    for (const p of setPrompts) next.add(p.id);
    return next;
  }), [setPrompts]);
  const selectNone = useCallback(() => setSelectedIds(prev => {
    const next = new Set(prev);
    for (const p of setPrompts) next.delete(p.id);
    return next;
  }), [setPrompts]);

  const handleEvent = useCallback((event) => {
    if (event.type === 'item') {
      if (event.status === 'start') {
        activeIndexRef.current = event.index;
        streamTimingsRef.current[event.index] = null;
        setActiveIndex(event.index);
        if (showLiveOutputRef.current) {
          setOutputs(prev => {
            const next = prev.slice();
            next[event.index] = '';
            return next;
          });
          setOutputStats(prev => {
            const next = prev.slice();
            next[event.index] = null;
            return next;
          });
          if (followActiveRef.current) setInspectedIndex(event.index);
        }
        return;
      }
      const captureOutput = showLiveOutputRef.current || fullscreenIndexRef.current === event.index;
      if (captureOutput && ['generating', 'healing', 'repairing'].includes(event.status)) {
        streamTimingsRef.current[event.index] = null;
        setOutputStats(prev => {
          const next = prev.slice();
          next[event.index] = null;
          return next;
        });
      } else {
        const timing = streamTimingsRef.current[event.index];
        if (timing?.startedAt && !timing.endedAt) timing.endedAt = Date.now();
      }
      setItems(prev => {
        const next = prev.slice();
        const cur = next[event.index] || {};
        next[event.index] = {
          ...cur,
          status: event.status,
          message: event.message || cur.message || '',
          healAttempt: event.healAttempt || cur.healAttempt || 0,
          healed: event.healed ?? cur.healed,
          savedIds: event.savedIds || cur.savedIds || [],
          repairRound: event.repairRound || event.repairRounds || cur.repairRound || 0,
          verificationStatus: event.verificationStatus || cur.verificationStatus || '',
        };
        return next;
      });
    } else if (event.type === 'preview' || event.type === 'chunk') {
      if (!showLiveOutputRef.current && fullscreenIndexRef.current !== event.index) return;
      if (event.type === 'chunk' && event.html) {
        const now = Date.now();
        const timing = streamTimingsRef.current[event.index];
        if (!timing?.startedAt) streamTimingsRef.current[event.index] = { startedAt: now, endedAt: null };
        setRateClock(now);
      }
      // Keep every prompt's latest complete/partial output. This lets users
      // inspect earlier generations without detaching the active stream.
      setOutputs(prev => {
        const next = prev.slice();
        next[event.index] = event.html || '';
        return next;
      });
    } else if (event.type === 'stats') {
      if (!showLiveOutputRef.current && fullscreenIndexRef.current !== event.index) return;
      setOutputStats(prev => {
        const next = prev.slice();
        next[event.index] = event.stats || null;
        return next;
      });
    } else if (event.type === 'done') {
      setSummary(event.summary);
    }
  }, []);

  useEffect(() => {
    if (phase === 'running') listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [items, phase]);

  const waitAtPauseBoundary = useCallback(async (context) => {
    if (!pauseRequestedRef.current || stopRef.current) return;
    setPauseContext(context || null);
    setPauseState('paused');
    await new Promise(resolve => { pauseResolverRef.current = resolve; });
    pauseResolverRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    if (!hasDirectory) { addToast('Connect a directory first — generations are saved there', 'error'); return; }
    const list = setPrompts.filter(p => selectedIds.has(p.id));
    if (list.length === 0) { addToast('Select at least one prompt', 'error'); return; }

    setRunList(list);
    setItems(list.map(() => ({ status: 'queued' })));
    setOutputs(showLiveOutput ? list.map(() => '') : []);
    setOutputStats(showLiveOutput ? list.map(() => null) : []);
    setSummary(null);
    fullscreenIndexRef.current = -1;
    setFullscreenIndex(-1);
    setFullscreenLoading(false);
    setInspectedIndex(-1);
    setActiveIndex(-1);
    activeIndexRef.current = -1;
    followActiveRef.current = true;
    stopRef.current = false;
    pauseRequestedRef.current = false;
    pauseResolverRef.current?.();
    pauseResolverRef.current = null;
    setPauseState('running');
    setPauseContext(null);
    setPhase('running');

    try {
      await runBatch({
        prompts: list,
        model,
        options: {
          mode,
          heal: mode === 'runtime-heal',
          healAttempts,
          maxRepairRounds,
          saveBothOnHeal,
          skipExisting,
          delayMs: Math.max(0, Math.round(delaySec * 1000)),
          apiRetries,
          runId,
        },
        deps,
        onEvent: handleEvent,
        shouldStop: () => stopRef.current,
        shouldPause: () => pauseRequestedRef.current,
        waitIfPaused: waitAtPauseBoundary,
      });
    } catch (e) {
      addToast('Batch run error: ' + e.message, 'error');
    } finally {
      pauseRequestedRef.current = false;
      pauseResolverRef.current?.();
      pauseResolverRef.current = null;
      setPauseState('running');
      setPauseContext(null);
      setActiveIndex(-1);
      setPhase('done');
    }
  }, [hasModel, hasDirectory, setPrompts, selectedIds, model, mode, healAttempts, maxRepairRounds, saveBothOnHeal,
      skipExisting, delaySec, apiRetries, showLiveOutput, runId, deps, handleEvent, waitAtPauseBoundary, addToast]);

  const pause = useCallback(() => {
    if (pauseRequestedRef.current || stopRef.current) return;
    pauseRequestedRef.current = true;
    setPauseState('pausing');
    addToast('Pause requested — waiting for the current model call to finish', 'info');
  }, [addToast]);

  const resume = useCallback(() => {
    if (!pauseRequestedRef.current) return;
    pauseRequestedRef.current = false;
    setPauseState('running');
    setPauseContext(null);
    const resolve = pauseResolverRef.current;
    pauseResolverRef.current = null;
    resolve?.();
    addToast('Batch resumed', 'info');
  }, [addToast]);

  const stop = useCallback(() => {
    stopRef.current = true;
    pauseRequestedRef.current = false;
    const resolve = pauseResolverRef.current;
    pauseResolverRef.current = null;
    resolve?.();
    addToast('Stopping after the current operation…', 'info');
  }, [addToast]);

  const doneCount = items.filter(it => ['saved', 'skipped', 'error', 'stopped', 'verified', 'warned', 'no_progress'].includes(it.status)).length;
  const progressPct = runList.length ? Math.round((doneCount / runList.length) * 100) : 0;
  const activeStatus = items[activeIndex]?.status || '';
  const isStreaming = ['generating', 'healing', 'repairing'].includes(activeStatus);
  const displayedHtml = inspectedIndex >= 0 ? (outputs[inspectedIndex] || '') : '';
  const displayedCharacters = displayedHtml.length;
  const reportedTokens = inspectedIndex >= 0 ? completionTokenCount(outputStats[inspectedIndex]) : null;
  const displayedTokens = reportedTokens ?? estimatedTokenCount(displayedHtml);
  const displayedTokenLabel = `${displayedTokens.toLocaleString()} token${displayedTokens === 1 ? '' : 's'} generated`;
  const viewingActive = inspectedIndex >= 0 && inspectedIndex === activeIndex;
  const displayedTokenRate = tokensPerSecond(
    inspectedIndex >= 0 ? outputStats[inspectedIndex] : null,
    displayedTokens,
    inspectedIndex >= 0 ? streamTimingsRef.current[inspectedIndex] : null,
    rateClock,
  );
  const displayedTokenRateLabel = formatTokensPerSecond(displayedTokenRate);
  const inspectedTitle = inspectedIndex >= 0 ? (runList[inspectedIndex]?.title || '') : '';
  const fullscreenHtml = fullscreenIndex >= 0 ? (outputs[fullscreenIndex] || '') : '';
  const fullscreenTitle = fullscreenIndex >= 0 ? (runList[fullscreenIndex]?.title || 'Generation') : '';
  const fullscreenIsActive = phase === 'running' && fullscreenIndex === activeIndex;
  const fullscreenSubtitle = fullscreenIsActive
    ? 'Live generation · the batch continues in the background'
    : phase === 'running'
      ? 'Pinned generation · the batch continues in the background'
      : 'Saved batch generation';

  useEffect(() => {
    if (phase !== 'running' || !viewingActive || !isStreaming || !displayedCharacters) return undefined;
    const timer = window.setInterval(() => setRateClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase, viewingActive, isStreaming, displayedCharacters]);

  const inspectOutput = useCallback((index) => {
    if (index < 0 || (!outputs[index] && index !== activeIndexRef.current)) return;
    followActiveRef.current = index === activeIndexRef.current;
    setInspectedIndex(index);
  }, [outputs]);

  const returnToLive = useCallback(() => {
    if (activeIndexRef.current < 0) return;
    followActiveRef.current = true;
    setInspectedIndex(activeIndexRef.current);
  }, []);

  const openFullscreen = useCallback(async (index) => {
    if (index < 0 || !runList[index]) return;
    fullscreenIndexRef.current = index;
    setFullscreenIndex(index);
    setFullscreenLoading(false);
    if (outputs[index]) return;

    const savedId = items[index]?.savedIds?.at(-1);
    if (!savedId || !deps.load) return; // Active streams will populate on their next chunk/preview.
    setFullscreenLoading(true);
    try {
      const generation = await deps.load(savedId);
      if (fullscreenIndexRef.current !== index) return;
      const loadedHtml = generation?.response || '';
      setOutputs(prev => {
        const next = prev.slice();
        next[index] = loadedHtml;
        return next;
      });
      if (!loadedHtml) addToast('The saved generation has no HTML to preview', 'error');
    } catch (error) {
      if (fullscreenIndexRef.current === index) addToast('Failed to open generation: ' + error.message, 'error');
    } finally {
      if (fullscreenIndexRef.current === index) setFullscreenLoading(false);
    }
  }, [runList, outputs, items, deps, addToast]);

  const closeFullscreen = useCallback(() => {
    const index = fullscreenIndexRef.current;
    fullscreenIndexRef.current = -1;
    setFullscreenIndex(-1);
    setFullscreenLoading(false);
    if (!showLiveOutputRef.current && index >= 0) {
      setOutputs(prev => {
        const next = prev.slice();
        next[index] = '';
        return next;
      });
      setOutputStats(prev => {
        const next = prev.slice();
        next[index] = null;
        return next;
      });
    }
  }, []);

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
        <${ExecutorModelSelector}
          models=${allModels}
          backend=${activeBackend}
          providerId=${activeProviderId}
          modelId=${activeModelId}
          agentId=${agentId}
          agentModelId=${agentModelId}
          onChange=${onExecutorChange}
          disabled=${allModels.length === 0 && !modelsLoading && activeBackend !== 'agent'}
          loading=${modelsLoading}
          onSettingsClick=${onProviderSettingsClick}
        />
      </div>

      ${!hasDirectory && html`
        <div class="batch-dir-hint">
          <i class="fa-solid fa-circle-info"></i>
          Connect a directory — generations are saved there.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Pick Directory</button>
        </div>
      `}

      <div class="batch-section">
        <div class="batch-section-head">
          <span><i class="fa-solid fa-list-check"></i> Prompts (${selectedCount}/${setPrompts.length})</span>
          <span class="batch-select-actions">
            <button class="btn btn-xs" onClick=${selectAll} title="Tick every prompt in this set">All</button>
            <button class="btn btn-xs" onClick=${selectNone} title="Untick every prompt in this set">None</button>
          </span>
        </div>
        ${availableSets.length > 1 && html`
          <div class="batch-set-switch" role="group" aria-label="Prompt set">
            ${availableSets.map(s => html`
              <button
                key=${s.id}
                type="button"
                class=${`library-cat-chip ${promptSet === s.id ? 'active' : ''}`}
                aria-pressed=${promptSet === s.id}
                title=${s.hint}
                onClick=${() => setPromptSet(s.id)}
              ><i class=${`fa-solid ${s.icon}`}></i>${s.label}<span class="batch-set-count">${s.count}</span></button>
            `)}
            ${activeSetMeta?.hint && html`<span class="batch-set-hint">${activeSetMeta.hint}. Only this set runs.</span>`}
          </div>
        `}
        <div class="batch-prompt-list">
          ${setPrompts.length === 0
            ? html`<div class="batch-empty">No prompts to run in this set.</div>`
            : setPrompts.map(p => html`
              <label class="batch-prompt-row" key=${p.id}>
                <input type="checkbox" checked=${selectedIds.has(p.id)} onChange=${() => toggleOne(p.id)} />
                <span class="batch-prompt-title" title=${p.title}>${p.title}</span>
                ${hasModel && (() => { try { return deps.hasExistingForModel?.(p, model); } catch (e) { return false; } })()
                  ? html`<span class="batch-prompt-badge" title="Already has a generation for this model">has run</span>`
                  : null}
              </label>
            `)}
        </div>
        ${skipExisting && alreadyRunCount > 0 && html`
          <div class="batch-note"><i class="fa-solid fa-forward"></i> ${alreadyRunCount} selected prompt${alreadyRunCount === 1 ? '' : 's'} will be skipped (already run for this model).</div>
        `}
      </div>

      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-wand-magic-sparkles"></i> Generation mode</span></div>
        <div class="batch-options">
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="quick" checked=${mode === 'quick'} onChange=${() => setMode('quick')} />
            <span><strong>Quick</strong><small>Generate once using the existing prompt and call flow.</small></span>
          </label>
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="runtime-heal" checked=${mode === 'runtime-heal'} onChange=${() => setMode('runtime-heal')} />
            <span><strong>Runtime Heal</strong><small>Check the sandbox and repair captured runtime errors.</small></span>
          </label>
          <label class="batch-opt batch-mode-opt">
            <input type="radio" name="batch-mode" value="verified"
              checked=${mode === 'verified'} onChange=${() => setMode('verified')} />
            <span><strong>Verified</strong><small>Audit prompt requirements using deterministic sandbox evidence.</small></span>
          </label>
          ${mode === 'runtime-heal' && html`
            <label class="batch-opt batch-opt-indent">
              <span>Max attempts</span>
              <select class="form-input batch-num" value=${healAttempts} onChange=${(e) => setHealAttempts(Number(e.target.value))}>
                ${[1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
              <span class="batch-opt-hint">saves both the original and healed versions</span>
            </label>
          `}
          ${mode === 'verified' && html`
            <label class="batch-opt batch-opt-indent">
              <span>Verified repair rounds</span>
              <select class="form-input batch-num" value=${maxRepairRounds} onChange=${(e) => setMaxRepairRounds(Number(e.target.value))}>
                ${[0, 1, 2].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
            </label>
            <div class="batch-verified-cost"><i class="fa-solid fa-coins"></i> Uses an audit call and up to two repair/re-audit calls per prompt. Every candidate is saved.</div>
          `}
        </div>
      </div>

      <div class="batch-section">
        <div class="batch-section-head"><span><i class="fa-solid fa-sliders"></i> Run options</span></div>
        <div class="batch-options">
          <label class="batch-opt">
            <input type="checkbox" checked=${skipExisting} onChange=${(e) => setSkipExisting(e.target.checked)} />
            <span>Skip prompts already run for this model</span>
          </label>
          <label class="batch-opt batch-live-output-option">
            <input type="checkbox" checked=${showLiveOutput} onChange=${(e) => setShowLiveOutput(e.target.checked)} />
            <span>Show live generation in this dialog</span>
            <span class="batch-opt-hint">Turn off to reduce browser memory use during large batches.</span>
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
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary btn-generate" onClick=${start} disabled=${!hasModel || !hasDirectory || selectedCount === 0}>
        <i class="fa-solid fa-play"></i> Go — run ${selectedCount} prompt${selectedCount === 1 ? '' : 's'}
      </button>
    </div>
  `;

  const renderRunning = () => html`
    <div class="modal-body batch-running">
      <div class="batch-progress">
        <div class="batch-progress-bar"><div class="batch-progress-fill" style=${{ width: progressPct + '%' }}></div></div>
        <div class="batch-progress-meta">
          <div class="batch-progress-text">${doneCount} / ${runList.length} done${pauseState === 'paused'
            ? ` · paused${pauseContext?.prompt?.title ? ` before "${pauseContext.prompt.title}"` : ''}`
            : phase === 'running' && activeIndex >= 0 ? ` · running "${runList[activeIndex]?.title || ''}"` : ''}</div>
          <div class=${`batch-stream-count ${isStreaming ? 'is-streaming' : ''}`} aria-live="polite">
            ${!showLiveOutput
              ? html`<i class="fa-solid fa-eye-slash"></i> Live generation hidden to reduce memory use`
              : !viewingActive && inspectedIndex >= 0
              ? html`<i class="fa-solid fa-eye"></i> Viewing saved output · ${displayedCharacters.toLocaleString()} chars · ${displayedTokenLabel} · ${displayedTokenRateLabel}`
              : html`
                <i class=${`fa-solid ${isStreaming ? 'fa-spinner fa-spin' : displayedCharacters ? 'fa-code' : 'fa-hourglass-half'}`}></i>
                ${displayedCharacters
                  ? `${displayedCharacters.toLocaleString()} character${displayedCharacters === 1 ? '' : 's'} streamed · ${displayedTokenLabel} · ${displayedTokenRateLabel}`
                  : 'Waiting for the first code chunk…'}
              `}
          </div>
        </div>
      </div>

      ${pauseState !== 'running' && html`
        <div class=${`batch-pause-state ${pauseState}`} role="status" aria-live="polite">
          <i class=${`fa-solid ${pauseState === 'paused' ? 'fa-circle-pause' : 'fa-spinner fa-spin'}`}></i>
          <div>
            <strong>${pauseState === 'paused' ? 'Paused' : 'Pausing…'}</strong>
            <span>${pauseState === 'paused'
              ? `No model calls are running${pauseContext?.prompt?.title ? ` · next: ${pauseContext.prompt.title}` : ''}.`
              : 'Finishing the in-flight model call; no new call will start.'}</span>
          </div>
        </div>
      `}

      <div class="batch-run-body">
        <div class="batch-run-list">
          ${runList.map((p, idx) => {
            const it = items[idx] || { status: 'queued' };
            const m = STATUS_META[it.status] || STATUS_META.queued;
            const isActive = idx === activeIndex;
            const isInspected = idx === inspectedIndex;
            const canInspect = showLiveOutput && (!!outputs[idx] || isActive);
            const canOpenFullscreen = isActive || !!outputs[idx] || !!it.savedIds?.length;
            return html`
              <div
                class=${`batch-run-item ${m.cls} ${isActive ? 'is-active' : ''} ${isInspected ? 'is-inspected' : ''} ${canInspect ? 'is-inspectable' : ''}`}
                key=${p.id}
                role=${canInspect ? 'button' : undefined}
                tabIndex=${canInspect ? 0 : undefined}
                aria-current=${isInspected ? 'true' : undefined}
                title=${canInspect ? (isActive ? 'View the live generation' : 'Inspect this generation while the batch continues') : ''}
                onClick=${canInspect ? () => inspectOutput(idx) : undefined}
                onKeyDown=${canInspect ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    inspectOutput(idx);
                  }
                } : undefined}
              >
                <i class=${`batch-run-icon fa ${m.icon} ${m.cls === 'active' ? 'fa-fade' : ''}`}></i>
                <span class="batch-run-title" title=${p.title}>${p.title}</span>
                <span class="batch-run-status">
                  ${it.status === 'healing' && it.healAttempt ? `heal ${it.healAttempt}`
                    : it.status === 'repairing' && it.repairRound ? `Repairing · round ${it.repairRound}` : m.label}
                  ${it.healed && it.status === 'saved' ? html` <span class="batch-healed-chip">healed</span>` : null}
                  ${canOpenFullscreen ? html`
                    <button class="batch-fullscreen-button" title="Open interactive full-screen generation"
                      onClick=${(event) => { event.stopPropagation(); openFullscreen(idx); }}>
                      <i class="fa-solid fa-expand"></i>
                    </button>` : null}
                </span>
              </div>
            `;
          })}
          <div ref=${listEndRef}></div>
        </div>
        ${showLiveOutput
          ? html`
            <div class="batch-preview">
              <div class="batch-preview-head">
                <span title=${inspectedTitle}><i class="fa-solid fa-display"></i> ${inspectedTitle || 'Preview'}</span>
                <span class="batch-preview-actions">
                  ${displayedHtml ? html`
                    <button class="batch-fullscreen-button" title="Open interactive full-screen generation"
                      onClick=${() => openFullscreen(inspectedIndex)}>
                      <i class="fa-solid fa-expand"></i> Full screen
                    </button>` : null}
                  ${!viewingActive && activeIndex >= 0
                    ? html`<button class="batch-return-live" onClick=${returnToLive}><i class="fa-solid fa-tower-broadcast"></i> Return to live</button>`
                    : pauseState === 'paused'
                      ? html`<span class="batch-live-chip is-paused"><i class="fa-solid fa-circle-pause"></i> Paused</span>`
                      : html`<span class="batch-live-chip"><i class="fa-solid fa-circle"></i> Live</span>`}
                </span>
              </div>
              ${displayedHtml
                ? html`<iframe class="batch-preview-frame" sandbox="allow-scripts" srcdoc=${displayedHtml} title=${`Preview: ${inspectedTitle || 'current generation'}`}></iframe>`
                : html`<div class="batch-preview-empty"><i class="fa-solid fa-hourglass-half"></i><span>Live preview appears here</span></div>`}
            </div>`
          : html`
            <div class="batch-preview batch-preview-disabled" role="status">
              <div class="batch-preview-empty">
                <i class="fa-solid fa-eye-slash"></i>
                <strong>Live generation hidden</strong>
                <span>Preview and code rendering are off for this run.</span>
                ${activeIndex >= 0 ? html`
                  <button class="btn btn-sm batch-open-active-fullscreen" onClick=${() => openFullscreen(activeIndex)}>
                    <i class="fa-solid fa-expand"></i> Open current generation full screen
                  </button>` : null}
              </div>
            </div>`}
      </div>

      ${showLiveOutput && html`
        <section class="batch-code-stream" aria-label="Streaming HTML output">
          <div class="batch-code-stream-head">
            <span><i class="fa-solid fa-code"></i> ${viewingActive && pauseState === 'running' ? 'Live HTML stream' : 'Generated HTML'}${inspectedTitle ? ` · ${inspectedTitle}` : ''}</span>
            <span>${displayedCharacters.toLocaleString()} chars · ${displayedTokens.toLocaleString()} tokens · ${displayedTokenRateLabel}</span>
          </div>
          <${CellEditor}
            className="batch-stream-editor"
            value=${displayedHtml}
            kind="html"
            theme=${theme}
            readOnly=${true}
            minLines=${9}
            maxLines=${9}
            fontSize=${12}
            followOutput=${viewingActive}
          />
        </section>
      `}
    </div>

    <div class="modal-footer">
      ${pauseState === 'paused'
        ? html`<button class="btn btn-primary batch-resume-button" onClick=${resume}>
            <i class="fa-solid fa-play"></i> Resume
          </button>`
        : html`<button class="btn batch-pause-button" onClick=${pause} disabled=${pauseState === 'pausing' || stopRef.current}
            title="Finish the current model call, then pause before another starts">
            <i class=${`fa-solid ${pauseState === 'pausing' ? 'fa-spinner fa-spin' : 'fa-pause'}`}></i>
            ${pauseState === 'pausing' ? 'Pausing…' : 'Pause'}
          </button>`}
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
          <div class="batch-stat"><strong>${summary?.healed || 0}</strong><span>healed</span></div>
          <div class="batch-stat"><strong>${summary?.saved || 0}</strong><span>saved</span></div>
          <div class="batch-stat"><strong>${summary?.skipped || 0}</strong><span>skipped</span></div>
          <div class=${`batch-stat ${summary?.failed ? 'is-bad' : ''}`}><strong>${summary?.failed || 0}</strong><span>failed</span></div>
        </div>
        ${(summary?.verifiedPassed || summary?.verifiedWarned || summary?.verifiedFailed || summary?.roleCalls) ? html`
          <div class="batch-verified-summary">
            <span><strong>${summary?.verifiedPassed || 0}</strong> passed</span>
            <span><strong>${summary?.verifiedWarned || 0}</strong> needs review</span>
            <span><strong>${summary?.verifiedFailed || 0}</strong> verification failed</span>
            <span><strong>${summary?.roleCalls || 0}</strong> role calls</span>
            <span><strong>${summary?.repairRounds || 0}</strong> repair rounds</span>
          </div>
        ` : null}
        ${summary?.stopped ? html`<div class="batch-note"><i class="fa-solid fa-hand"></i> Run stopped early.</div>` : null}
      </div>

      <div class="batch-run-list batch-run-list-done">
        ${runList.map((p, idx) => {
          const it = items[idx] || { status: 'queued' };
          const m = STATUS_META[it.status] || STATUS_META.queued;
          return html`
            <div class=${`batch-run-item ${m.cls}`} key=${p.id}>
              <i class=${`batch-run-icon fa ${m.icon}`}></i>
              <span class="batch-run-title" title=${p.title}>${p.title}</span>
              <span class="batch-run-status">
                ${m.label}${it.healed ? html` <span class="batch-healed-chip">healed</span>` : null}
                ${it.repairRound ? html` <span class="batch-healed-chip">${it.repairRound} repair${it.repairRound === 1 ? '' : 's'}</span>` : null}
                ${it.status === 'error' && it.message ? html`<span class="batch-run-err" title=${it.message}> — ${it.message}</span>` : null}
                ${it.savedIds?.length ? html`
                  <button class="batch-fullscreen-button" title="Open interactive full-screen generation"
                    onClick=${() => openFullscreen(idx)}><i class="fa-solid fa-expand"></i></button>` : null}
              </span>
            </div>
          `;
        })}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${() => setPhase('config')}><i class="fa-solid fa-rotate-left"></i> New Run</button>
      <button class="btn" onClick=${() => { onOpenGallery?.(); onClose(); }}>
        <i class="fa-solid fa-images"></i> View in Gallery
      </button>
      ${onOpenRuns && html`
        <button class="btn btn-primary" onClick=${() => { onOpenRuns(runId); onClose(); }}
          title="Open this run's generations in the Runs tab">
          <i class="fa-solid fa-layer-group"></i> Review This Run
        </button>
      `}
    </div>
  `;

  return html`
    <${Fragment}>
      <div class="modal-overlay">
        <div class=${`modal batch-dialog ${phase === 'running' ? 'is-running' : ''}`} onClick=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2><i class="fa-solid fa-layer-group"></i> Batch Run</h2>
            ${phase !== 'running' && html`
              <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
            `}
          </div>
          ${phase === 'config' ? renderConfig() : phase === 'running' ? renderRunning() : renderDone()}
        </div>
      </div>
      ${fullscreenIndex >= 0 && html`
        <${HtmlLightbox}
          html=${fullscreenHtml}
          title=${fullscreenTitle}
          subtitle=${fullscreenSubtitle}
          emptyMessage=${fullscreenLoading ? 'Loading the saved generation…' : 'Waiting for the next output chunk…'}
          onClose=${closeFullscreen}
        />
      `}
    <//>
  `;
}

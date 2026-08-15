import { html } from 'htm/preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import { runBatch } from '../services/batchRunner.js';

const STATUS_META = {
  queued:     { icon: 'fa-regular fa-circle',        cls: 'queued',  label: 'Queued' },
  generating: { icon: 'fa-solid fa-bolt',            cls: 'active',  label: 'Generating' },
  checking:   { icon: 'fa-solid fa-flask',           cls: 'active',  label: 'Checking' },
  healing:    { icon: 'fa-solid fa-screwdriver-wrench', cls: 'active', label: 'Healing' },
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
  onModelChange,
  onProviderSettingsClick,
  hasDirectory,
  onPickDirectory,
  deps,                  // { generate, runSandbox, heal, save, hasExistingForModel }
  onOpenGallery,
  onOpenRuns,
  onClose,
  addToast,
}) {
  // phase: 'config' | 'running' | 'done'
  const [phase, setPhase] = useState('config');

  // Selection — start with everything ticked so "just press Go" runs all.
  const [selectedIds, setSelectedIds] = useState(() => new Set(prompts.map(p => p.id)));

  // Options
  const [heal, setHeal] = useState(false);
  const [healAttempts, setHealAttempts] = useState(1);
  const [saveBothOnHeal] = useState(true); // per product decision: always keep original + healed
  const [skipExisting, setSkipExisting] = useState(false);
  const [apiRetries, setApiRetries] = useState(1);
  const [delaySec, setDelaySec] = useState(0);

  // Run state
  const [items, setItems] = useState([]);       // aligned to the run list
  const [runList, setRunList] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [summary, setSummary] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const stopRef = useRef(false);
  const listEndRef = useRef(null);

  const hasModel = !!(model?.providerId && model?.modelId);
  const selectedCount = selectedIds.size;

  const alreadyRunCount = useMemo(() => {
    if (!hasModel) return 0;
    let n = 0;
    for (const p of prompts) {
      if (!selectedIds.has(p.id)) continue;
      try { if (deps.hasExistingForModel?.(p, model)) n++; } catch (e) { /* ignore */ }
    }
    return n;
  }, [prompts, selectedIds, model, hasModel, deps]);

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

  const selectAll = useCallback(() => setSelectedIds(new Set(prompts.map(p => p.id))), [prompts]);
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
          savedIds: event.savedIds || cur.savedIds || [],
        };
        return next;
      });
    } else if (event.type === 'preview') {
      setPreviewHtml(event.html || '');
    } else if (event.type === 'chunk') {
      // Keep the live preview loosely following the stream (cheap: last chunk only).
      setPreviewHtml(event.html || '');
    } else if (event.type === 'done') {
      setSummary(event.summary);
    }
  }, []);

  useEffect(() => {
    if (phase === 'running') listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [items, phase]);

  const start = useCallback(async () => {
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    if (!hasDirectory) { addToast('Connect a directory first — generations are saved there', 'error'); return; }
    const list = prompts.filter(p => selectedIds.has(p.id));
    if (list.length === 0) { addToast('Select at least one prompt', 'error'); return; }

    setRunList(list);
    setItems(list.map(() => ({ status: 'queued' })));
    setSummary(null);
    setPreviewHtml('');
    setActiveIndex(-1);
    stopRef.current = false;
    setPhase('running');

    try {
      await runBatch({
        prompts: list,
        model,
        options: {
          heal,
          healAttempts,
          saveBothOnHeal,
          skipExisting,
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
  }, [hasModel, hasDirectory, prompts, selectedIds, model, heal, healAttempts, saveBothOnHeal,
      skipExisting, delaySec, apiRetries, deps, handleEvent, addToast]);

  const stop = useCallback(() => {
    stopRef.current = true;
    addToast('Stopping after the current prompt…', 'info');
  }, [addToast]);

  const doneCount = items.filter(it => ['saved', 'skipped', 'error', 'stopped'].includes(it.status)).length;
  const progressPct = runList.length ? Math.round((doneCount / runList.length) * 100) : 0;

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
          Connect a directory — generations are saved there.
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
            ? html`<div class="batch-empty">No prompts to run — the current filter is empty.</div>`
            : prompts.map(p => html`
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
        <div class="batch-section-head"><span><i class="fa-solid fa-sliders"></i> Options</span></div>
        <div class="batch-options">
          <label class="batch-opt">
            <input type="checkbox" checked=${heal} onChange=${(e) => setHeal(e.target.checked)} />
            <span>Self-heal on runtime error</span>
          </label>
          ${heal && html`
            <label class="batch-opt batch-opt-indent">
              <span>Max attempts</span>
              <select class="form-input batch-num" value=${healAttempts} onChange=${(e) => setHealAttempts(Number(e.target.value))}>
                ${[1, 2, 3].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
              </select>
              <span class="batch-opt-hint">saves both the original and healed versions</span>
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
        <div class="batch-progress-text">${doneCount} / ${runList.length} done${phase === 'running' && activeIndex >= 0 ? ` · running "${runList[activeIndex]?.title || ''}"` : ''}</div>
      </div>

      <div class="batch-run-body">
        <div class="batch-run-list">
          ${runList.map((p, idx) => {
            const it = items[idx] || { status: 'queued' };
            const m = STATUS_META[it.status] || STATUS_META.queued;
            const isActive = idx === activeIndex;
            return html`
              <div class=${`batch-run-item ${m.cls} ${isActive ? 'is-active' : ''}`} key=${p.id}>
                <i class=${`batch-run-icon fa ${m.icon} ${m.cls === 'active' ? 'fa-fade' : ''}`}></i>
                <span class="batch-run-title" title=${p.title}>${p.title}</span>
                <span class="batch-run-status">
                  ${it.status === 'healing' && it.healAttempt ? `heal ${it.healAttempt}` : m.label}
                  ${it.healed && it.status === 'saved' ? html` <span class="batch-healed-chip">healed</span>` : null}
                </span>
              </div>
            `;
          })}
          <div ref=${listEndRef}></div>
        </div>
        <div class="batch-preview">
          ${previewHtml
            ? html`<iframe class="batch-preview-frame" sandbox="allow-scripts" srcdoc=${previewHtml} title="Live preview"></iframe>`
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
          <div class="batch-stat"><strong>${summary?.healed || 0}</strong><span>healed</span></div>
          <div class="batch-stat"><strong>${summary?.saved || 0}</strong><span>saved</span></div>
          <div class="batch-stat"><strong>${summary?.skipped || 0}</strong><span>skipped</span></div>
          <div class=${`batch-stat ${summary?.failed ? 'is-bad' : ''}`}><strong>${summary?.failed || 0}</strong><span>failed</span></div>
        </div>
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
                ${it.status === 'error' && it.message ? html`<span class="batch-run-err" title=${it.message}> — ${it.message}</span>` : null}
              </span>
            </div>
          `;
        })}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn" onClick=${() => setPhase('config')}><i class="fa-solid fa-rotate-left"></i> New Run</button>
      ${onOpenRuns && html`
        <button class="btn" onClick=${() => { onOpenRuns(); onClose(); }}>
          <i class="fa-solid fa-layer-group"></i> Review Run
        </button>
      `}
      <button class="btn btn-primary" onClick=${() => { onOpenGallery?.(); onClose(); }}>
        <i class="fa-solid fa-images"></i> View in Gallery
      </button>
    </div>
  `;

  return html`
    <div class="modal-overlay">
      <div class="modal batch-dialog" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-layer-group"></i> Batch Run</h2>
          ${phase !== 'running' && html`
            <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
          `}
        </div>
        ${phase === 'config' ? renderConfig() : phase === 'running' ? renderRunning() : renderDone()}
      </div>
    </div>
  `;
}

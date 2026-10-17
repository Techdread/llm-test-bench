import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import { ProjectLibraryBadges, ProjectLibraryPicker } from '../../shared/forge/components/ProjectLibraryPicker.js';
import { AGENTS, listAgentModels, runAgent } from '../services/agentBackend.js';
import {
  DEFAULT_LANE_MODE, LANE_MODE_LABELS, LANE_MODES,
  addUserLane, laneValidationErrors, softDeleteLane, updateUserLane,
} from '../services/lanes.js';
import { planVariantSweep, runVariantSweep } from '../services/variantSweep.js';

const MODE_HELP = {
  '': 'Each lane uses its own default — 2D lanes preserve the concept, 3D lanes transform it.',
  'held-constant': 'The prompt text is copied verbatim; only the provisioned library changes. No model is called. This is the controlled comparison — the one cell type where the library really is the only difference.',
  preserve: 'The brief is rewritten to use the library while keeping the concept, genre and presentation intent.',
  transform: 'The brief may change presentation substantially — a controller-driven scene can become a hand-tracked one. Needed when a brief is worded for one interaction model and the lane is another.',
};

/**
 * Create the (prompt × lane) grid of derived prompts.
 *
 * Deliberately preview-first: the grid, its cost and what it will overwrite are
 * all shown before anything is spent, because a careless sweep is expensive in
 * both tokens and library clutter.
 */
export function VariantSweepDialog({
  prompts = [], existing = [], lanes = [], models = [], defaultProviderId, defaultModelId,
  modelsLoading, onProviderSettings, hasRoot, onConnectRoot,
  onLanesChanged, onClose, onDone,
}) {
  const [selectedPrompts, setSelectedPrompts] = useState(() => new Set());
  const [selectedLanes, setSelectedLanes] = useState(() => new Set());
  const [mode, setMode] = useState('');
  const [intent, setIntent] = useState('');
  const [target, setTarget] = useState('provider');
  const [providerId, setProviderId] = useState(defaultProviderId);
  const [modelId, setModelId] = useState(defaultModelId);
  const [agentModel, setAgentModel] = useState('');
  const [availableAgentModels, setAvailableAgentModels] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [outcomes, setOutcomes] = useState([]);
  const [error, setError] = useState('');
  const [managingLanes, setManagingLanes] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (target === 'provider') { setAvailableAgentModels([]); return; }
    let cancelled = false;
    listAgentModels(target)
      .then(list => { if (!cancelled) setAvailableAgentModels(list); })
      .catch(() => { if (!cancelled) setAvailableAgentModels([]); });
    return () => { cancelled = true; };
  }, [target]);

  const chosenPrompts = prompts.filter(prompt => selectedPrompts.has(prompt.id));
  const chosenLanes = lanes.filter(lane => selectedLanes.has(lane.id));
  // `existing` is the whole library, variants included, so a cell that has been
  // swept before is reported as a new version rather than as new.
  const plan = planVariantSweep({
    prompts: chosenPrompts, lanes: chosenLanes, mode, existing,
  });
  const revisions = plan.cells.filter(cell => cell.status === 'new-version').length;
  const usesAgent = target !== 'provider';
  const ready = plan.cells.length > 0 && !running
    && (plan.modelCalls === 0 || (usesAgent ? !!hasRoot : !!(providerId && modelId)));

  const toggle = (set, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const start = async () => {
    setError('');
    setOutcomes([]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const record = await runVariantSweep({
        cells: plan.cells,
        prompts: chosenPrompts,
        lanes: chosenLanes,
        intent,
        executor: usesAgent
          ? { backend: 'agent', agentId: target, agentModel, runAgent }
          : {
              backend: 'model',
              providerId,
              modelId,
              modelDisplayLabel: models.find(m => m.providerId === providerId && m.modelId === modelId)?.name,
            },
        signal: controller.signal,
        onProgress: setProgress,
      });
      setOutcomes(record.cells);
      await onDone?.(record);
      if (!record.counts.failed && !record.cancelled) onClose();
    } catch (caught) {
      if (caught?.name !== 'AbortError') setError(caught.message);
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-prompt-modal">
        <div class="gf-prompt-dialog-head">
          <div>
            <h2>Create library variants</h2>
            <p>Derive one prompt per (game × lane) so the same brief can be built against different libraries.</p>
          </div>
          <button class="gf-icon-btn" title="Close" onClick=${() => { abortRef.current?.abort(); onClose(); }}>
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <div class="gf-sweep-body">
          <section class="gf-sweep-section">
            <header>
              <h3>Games <small>${selectedPrompts.size} of ${prompts.length} selected</small></h3>
              <div>
                <button class="gf-btn" onClick=${() => setSelectedPrompts(new Set(prompts.map(p => p.id)))}>Select all filtered</button>
                <button class="gf-btn" onClick=${() => setSelectedPrompts(new Set())}>Clear</button>
              </div>
            </header>
            <div class="gf-sweep-picklist">
              ${prompts.map(prompt => html`
                <label class="gf-sweep-pick" key=${prompt.id}>
                  <input type="checkbox" checked=${selectedPrompts.has(prompt.id)}
                    onChange=${() => setSelectedPrompts(current => toggle(current, prompt.id))} />
                  <span>${prompt.title}</span>
                  <small>${prompt.era}</small>
                </label>`)}
              ${prompts.length === 0 && html`<div class="gf-empty">No prompts in the current filter.</div>`}
            </div>
          </section>

          <section class="gf-sweep-section">
            <header>
              <h3>Lanes <small>${selectedLanes.size} of ${lanes.length} selected</small></h3>
              <div>
                <button class="gf-btn" onClick=${() => setSelectedLanes(new Set(lanes.map(l => l.id)))}>All lanes</button>
                <button class="gf-btn" onClick=${() => setSelectedLanes(new Set())}>Clear</button>
                <button class=${`gf-btn ${managingLanes ? 'active' : ''}`} onClick=${() => setManagingLanes(!managingLanes)}>
                  <i class="fas fa-sliders"></i> Manage lanes
                </button>
              </div>
            </header>
            <div class="gf-sweep-picklist">
              ${lanes.map(lane => html`
                <label class="gf-sweep-pick" key=${lane.id}>
                  <input type="checkbox" checked=${selectedLanes.has(lane.id)}
                    onChange=${() => setSelectedLanes(current => toggle(current, lane.id))} />
                  <span>${lane.label}</span>
                  ${lane.libraries.length
                    ? html`<${ProjectLibraryBadges} value=${lane.libraries} />`
                    : html`<small class="gf-lane-baseline">baseline · no library</small>`}
                </label>`)}
            </div>
            ${managingLanes && html`<${LaneManager} lanes=${lanes} onChanged=${onLanesChanged} />`}
          </section>

          <section class="gf-sweep-section">
            <header><h3>How the variant text is produced</h3></header>
            <label class="gf-field-wide">Mode
              <select value=${mode} onChange=${event => setMode(event.target.value)}>
                <option value="">Each lane's default</option>
                ${LANE_MODES.map(item => html`<option value=${item}>${LANE_MODE_LABELS[item]}</option>`)}
              </select>
            </label>
            <p class="gf-sweep-help">${MODE_HELP[mode] || MODE_HELP['']}</p>
            ${plan.modelCalls > 0 && html`
              <label class="gf-field-wide">Instruction for the rewrite (optional)
                <textarea rows="2" value=${intent} onInput=${event => setIntent(event.target.value)}
                  placeholder="e.g. keep the level layout identical across lanes"></textarea>
              </label>`}
          </section>

          ${plan.modelCalls > 0 && html`
            <section class="gf-sweep-section">
              <header><h3>Who rewrites the briefs</h3></header>
              <div class="gf-drafter-grid">
                ${AGENTS.map(agent => html`
                  <button class=${`gf-drafter-card ${target === agent.id ? 'active' : ''}`}
                    onClick=${() => setTarget(agent.id)}>
                    <i class=${`fas ${agent.id === 'claude-code' ? 'fa-brain' : agent.id === 'codex' ? 'fa-code' : 'fa-robot'}`}></i>
                    <span>${agent.label}</span>
                    <small>Local coding agent</small>
                  </button>`)}
                <button class=${`gf-drafter-card ${target === 'provider' ? 'active' : ''}`}
                  onClick=${() => setTarget('provider')}>
                  <i class="fas fa-magnifying-glass"></i>
                  <span>Provider / local model</span>
                  <small>Search every configured model</small>
                </button>
              </div>
              ${target === 'provider' ? html`
                <${ProviderModelSelector}
                  models=${models} providerId=${providerId} modelId=${modelId}
                  onChange=${next => { setProviderId(next.providerId); setModelId(next.modelId); }}
                  loading=${modelsLoading} onSettingsClick=${onProviderSettings} />` : html`
                <div class="gf-drafter-config">
                  <div>
                    <strong>${AGENTS.find(agent => agent.id === target)?.label} model</strong>
                    <span>Leave blank to use the CLI default.</span>
                  </div>
                  <input class="gf-agent-model-search" list="gf-sweep-agent-models"
                    value=${agentModel} onInput=${event => setAgentModel(event.target.value)}
                    placeholder="CLI default model" />
                  <datalist id="gf-sweep-agent-models">
                    ${availableAgentModels.map(item => html`<option value=${item}></option>`)}
                  </datalist>
                </div>
                ${!hasRoot && html`
                  <div class="gf-ai-error">
                    Coding agents need a connected data root for their path-jailed job.
                    <button class="gf-btn" onClick=${onConnectRoot}><i class="fas fa-folder-open"></i> Connect data root</button>
                  </div>`}`}
            </section>`}

          <section class="gf-sweep-section gf-sweep-summary">
            <header><h3>Preview</h3></header>
            <p>
              <strong>${chosenPrompts.length}</strong> brief${chosenPrompts.length === 1 ? '' : 's'} ×
              <strong>${chosenLanes.length}</strong> lane${chosenLanes.length === 1 ? '' : 's'} =
              <strong>${plan.cells.length}</strong> variant${plan.cells.length === 1 ? '' : 's'},
              of which <strong>${plan.modelCalls}</strong> need a model call.
            </p>
            <p class="gf-sweep-help">
              ${revisions > 0
                ? `${revisions} of these already exist and will gain a new version — the earlier text is kept and stays readable.`
                : 'All of these are new. Re-running a sweep later adds versions rather than duplicates.'}
            </p>
            ${plan.cells.length > 0 && html`
              <div class="gf-sweep-grid" role="table">
                ${plan.cells.slice(0, 60).map(cell => html`
                  <span class=${`gf-sweep-cell gf-mode-${cell.mode}`} key=${cell.variantId}
                    title=${`${cell.baseTitle} · ${cell.laneLabel} · ${LANE_MODE_LABELS[cell.mode]}`}>
                    ${cell.laneLabel}
                  </span>`)}
                ${plan.cells.length > 60 && html`<span class="gf-sweep-cell">+${plan.cells.length - 60} more</span>`}
              </div>`}
          </section>

          ${running && html`
            <div class="gf-ai-status">
              <i class="fas fa-spinner fa-spin"></i>
              ${progress
                ? `${progress.index + 1} of ${progress.total} — ${progress.cell.baseTitle} · ${progress.cell.laneLabel}`
                : 'Starting…'}
              <button class="gf-btn gf-danger" onClick=${() => abortRef.current?.abort()}>
                <i class="fas fa-stop"></i> Stop
              </button>
            </div>`}
          ${error && html`<div class="gf-ai-error">${error}</div>`}
          ${outcomes.filter(item => !item.ok).length > 0 && html`
            <div class="gf-ai-error">
              <strong>${outcomes.filter(item => !item.ok).length} cell(s) failed.</strong> The rest were saved.
              <ul>
                ${outcomes.filter(item => !item.ok).slice(0, 8).map(item => html`
                  <li key=${item.variantId}>${item.baseTitle} · ${item.laneLabel} — ${item.error}</li>`)}
              </ul>
            </div>`}
        </div>

        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${() => { abortRef.current?.abort(); onClose(); }}>Close</button>
          <button class="gf-btn gf-primary" disabled=${!ready} onClick=${start}>
            <i class="fas fa-code-branch"></i>
            Create ${plan.cells.length} variant${plan.cells.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>`;
}

/** Add, edit and hide user lanes without leaving the sweep. */
function LaneManager({ lanes = [], onChanged }) {
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [libraries, setLibraries] = useState([]);
  const [defaultMode, setDefaultMode] = useState(DEFAULT_LANE_MODE);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const reset = () => {
    setEditing(null); setLabel(''); setId(''); setLibraries([]);
    setDefaultMode(DEFAULT_LANE_MODE); setNote(''); setError('');
  };

  const edit = lane => {
    setEditing(lane.id); setLabel(lane.label); setId(lane.id);
    setLibraries(lane.libraries); setDefaultMode(lane.defaultMode);
    setNote(lane.note || ''); setError('');
  };

  const save = async () => {
    setError('');
    const value = { id: id || label, label, libraries, defaultMode, note };
    const errors = laneValidationErrors(value, lanes.filter(lane => lane.id !== editing));
    if (errors.length) { setError(errors.join(' ')); return; }
    try {
      if (editing) await updateUserLane(editing, value);
      else await addUserLane(value);
      await onChanged?.();
      reset();
    } catch (caught) { setError(caught.message); }
  };

  return html`
    <div class="gf-lane-manager">
      <div class="gf-lane-list">
        ${lanes.map(lane => html`
          <div class="gf-lane-row" key=${lane.id}>
            <span>${lane.label}</span>
            <small>${lane.source === 'seed' ? 'seed' : 'custom'} · ${LANE_MODE_LABELS[lane.defaultMode]}</small>
            <button class="gf-icon-btn" title=${lane.source === 'seed' ? 'Seed lanes are edited by saving a custom copy' : 'Edit lane'}
              disabled=${lane.source === 'seed'} onClick=${() => edit(lane)}>
              <i class="fas fa-pen"></i>
            </button>
            <button class="gf-icon-btn" title="Hide this lane (variants already built from it keep working)"
              onClick=${async () => { await softDeleteLane(lane.id); await onChanged?.(); }}>
              <i class="fas fa-eye-slash"></i>
            </button>
          </div>`)}
      </div>
      <div class="gf-lane-editor">
        <h4>${editing ? `Edit lane · ${editing}` : 'New lane'}</h4>
        <label>Label<input value=${label} onInput=${event => setLabel(event.target.value)} placeholder="Three.js 3D" /></label>
        <label>Id<input value=${id} onInput=${event => setId(event.target.value)} disabled=${!!editing} placeholder="three-3d" /></label>
        <label>Default mode
          <select value=${defaultMode} onChange=${event => setDefaultMode(event.target.value)}>
            ${LANE_MODES.map(item => html`<option value=${item}>${LANE_MODE_LABELS[item]}</option>`)}
          </select>
        </label>
        <label class="gf-field-wide">Note<input value=${note} onInput=${event => setNote(event.target.value)}
          placeholder="What this lane is for, or a constraint worth remembering" /></label>
        <${ProjectLibraryPicker} value=${libraries} onChange=${setLibraries} domain="vr" targetStack="web" />
        ${error && html`<div class="gf-ai-error">${error}</div>`}
        <div class="gf-modal-actions">
          ${editing && html`<button class="gf-btn" onClick=${reset}>Cancel edit</button>`}
          <button class="gf-btn gf-primary" onClick=${save}>
            <i class="fas fa-floppy-disk"></i> ${editing ? 'Save lane' : 'Add lane'}
          </button>
        </div>
      </div>
    </div>`;
}

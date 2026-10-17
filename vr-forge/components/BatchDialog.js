import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { getAllPrompts } from '../services/library.js';
import { AGENTS, listAgentModels } from '../services/agentBackend.js';
import { TurnLimitInput } from '../../shared/forge/components/TurnLimitInput.js';

const STATUS_ICON = {
  built: 'fa-check gf-ok', completed: 'fa-check gf-ok',
  passed: 'fa-circle-check gf-ok', warned: 'fa-triangle-exclamation',
  failed: 'fa-circle-xmark gf-bad',
  error: 'fa-xmark gf-bad', cancelled: 'fa-ban', skipped: 'fa-forward gf-muted',
  building: 'fa-spinner fa-spin', pending: 'fa-circle gf-muted',
};

export function BatchDialog({
  modelName, modelId, running, index, total, current, results, totals,
  initialBackend = 'model', initialAgentId = 'claude-code', initialAgentModel = '',
  onStart, onCancel, onClose,
}) {
  const [prompts, setPrompts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [skipExisting, setSkipExisting] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [maxTurns, setMaxTurns] = useState(40);
  const [backend, setBackend] = useState(initialBackend === 'agent' ? 'agent' : 'model');
  const [agentId, setAgentId] = useState(initialAgentId || 'claude-code');
  const [agentModel, setAgentModel] = useState(initialAgentModel || '');
  const [availableAgentModels, setAvailableAgentModels] = useState([]);

  useEffect(() => {
    getAllPrompts().then(ps => { setPrompts(ps); setSelected(new Set(ps.map(p => p.id))); });
  }, []);
  useEffect(() => {
    if (backend !== 'agent') return;
    let live = true;
    listAgentModels(agentId).then(models => { if (live) setAvailableAgentModels(models); });
    return () => { live = false; };
  }, [backend, agentId]);

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = prompts.length > 0 && selected.size === prompts.length;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(prompts.map(p => p.id)));

  const start = () => onStart({
    games: prompts.filter(p => selected.has(p.id)),
    backend,
    agentId: backend === 'agent' ? agentId : null,
    agentModel: backend === 'agent' ? agentModel.trim() : null,
    skipExisting, delayMs: +delayMs || 0, maxTurns: +maxTurns || 40,
  });

  const done = !!totals;
  const selectedAgent = AGENTS.find(agent => agent.id === agentId);
  const executorReady = backend === 'agent' ? !!selectedAgent : !!modelId;
  const resultByTitle = new Map((results || []).map(r => [r.title, r]));

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-batch" onClick=${e => e.stopPropagation()}>
        <div class="gf-batch-head">
          <h2><i class="fas fa-layer-group"></i> Batch build</h2>
          <button class="gf-icon-btn" onClick=${() => { if (!running) onClose(); }} disabled=${running}><i class="fas fa-xmark"></i></button>
        </div>
        <div class="gf-batch-model">
          <label>
            AI executor
            <select data-testid="batch-executor" disabled=${running || done}
              value=${backend === 'agent' ? `agent:${agentId}` : 'model'}
              onChange=${event => {
                const value = event.target.value;
                if (value === 'model') setBackend('model');
                else {
                  setBackend('agent');
                  setAgentId(value.slice('agent:'.length));
                  setAgentModel('');
                }
              }}>
              <option value="model">In-app model</option>
              ${AGENTS.map(agent => html`<option value=${`agent:${agent.id}`}>${agent.label} CLI</option>`)}
            </select>
          </label>
          ${backend === 'model'
            ? html`
              <span>Selected model: <b>${modelName || modelId || '— none selected —'}</b></span>
              ${!modelId && html`<span class="gf-bad">Pick a model in the toolbar first.</span>`}
            `
            : html`
              <label>
                CLI model <span class="gf-muted">(optional)</span>
                <input data-testid="batch-agent-model" type="text" list="vr-forge-batch-agent-models"
                  value=${agentModel} disabled=${running || done}
                  placeholder="Use CLI default" onInput=${event => setAgentModel(event.target.value)} />
              </label>
              <datalist id="vr-forge-batch-agent-models">
                ${availableAgentModels.map(model => html`<option value=${model}></option>`)}
              </datalist>
              <span class="gf-muted">${selectedAgent?.label || agentId} runs through the local serve.py agent bridge.</span>
            `}
        </div>

        ${!running && !done && html`
          <div class="gf-batch-options">
            <label><input type="checkbox" checked=${skipExisting} onChange=${e => setSkipExisting(e.target.checked)} /> Skip briefs already built by this AI executor</label>
            <label>Delay between builds (ms) <input type="number" min="0" step="500" value=${delayMs} onInput=${e => setDelayMs(e.target.value)} /></label>
            <label>Max turns <${TurnLimitInput} value=${maxTurns} onChange=${setMaxTurns} /></label>
          </div>
          <div class="gf-batch-selecthead">
            <button class="gf-chip ${allOn ? 'active' : ''}" onClick=${toggleAll}>${allOn ? 'Clear all' : 'Select all'}</button>
            <span class="gf-muted">${selected.size} / ${prompts.length} selected</span>
          </div>`}

        <div class="gf-batch-list">
          ${prompts.map(p => {
            const r = resultByTitle.get(p.title);
            let st = 'pending';
            if (running && current?.id === p.id) st = 'building';
            else if (r) st = r.status;
            const showCheck = !running && !done;
            return html`
              <div class="gf-batch-row" key=${p.id}>
                ${showCheck
                  ? html`<input type="checkbox" checked=${selected.has(p.id)} onChange=${() => toggle(p.id)} />`
                  : html`<i class=${`fas ${STATUS_ICON[st] || 'fa-circle gf-muted'}`}></i>`}
                <span class="gf-batch-title">${p.title}</span>
                <span class="gf-stack">${p.targetStack}</span>
                ${r?.telemetry && html`<span class="gf-muted">${r.telemetry.filesWritten} files · ${Math.round((r.telemetry.elapsedMs || 0) / 1000)}s</span>`}
                ${r?.error && html`<span class="gf-bad gf-batch-err" title=${r.error}>${r.error}</span>`}
              </div>`;
          })}
        </div>

        ${running && html`
          <div class="gf-batch-progress">
            <div class="gf-batch-bar"><div class="gf-batch-fill" style=${{ width: `${total ? (index / total) * 100 : 0}%` }}></div></div>
            <div class="gf-muted">Building ${index + 1} / ${total}: <b>${current?.title || ''}</b></div>
          </div>`}

        ${done && html`
          <div class="gf-done">
            <i class="fas fa-flag-checkered"></i> ${totals.built} built · ${totals.failed} failed · ${totals.skipped} skipped${totals.cancelled ? ` · ${totals.cancelled} cancelled` : ''}
          </div>`}

        <div class="gf-modal-actions">
          ${running
            ? html`<button class="gf-btn gf-danger" onClick=${onCancel}><i class="fas fa-stop"></i> Cancel</button>`
            : done
              ? html`<button class="gf-btn gf-primary" onClick=${onClose}>Close</button>`
              : html`
                <button class="gf-btn" onClick=${onClose}>Cancel</button>
                <button class="gf-btn gf-primary" disabled=${!executorReady || selected.size === 0} onClick=${start}>
                  <i class="fas fa-play"></i> Build ${selected.size} project${selected.size === 1 ? '' : 's'}
                </button>`}
        </div>
      </div>
    </div>`;
}

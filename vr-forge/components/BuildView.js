import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { TraceView } from './TraceView.js';
import { WireInspector } from './WireInspector.js';
import { AgentTrace } from './AgentTrace.js';
import { VrPreview } from './VrPreview.js';
import { XrSessionPane } from './XrSessionPane.js';
import { QuestPane } from './QuestPane.js';
import { AICoachPanel } from '../../shared/components/AICoachPanel.js';
import { AGENTS, runAgent } from '../services/agentBackend.js';
import { BudgetDialog } from './BudgetDialog.js';
import { ValidationPanel } from './ValidationPanel.js';
import { ProjectLibraryBadges } from '../../shared/forge/components/ProjectLibraryPicker.js';
import { BriefReconcileDialog } from '../../shared/forge/components/BriefReconcileDialog.js';
import { normalizeDraftResult } from '../services/promptDrafting.js';
import { defaultBudgets, normalizeBudgets } from '../services/budgets.js';
import { TurnLimitInput } from '../../shared/forge/components/TurnLimitInput.js';

const PANES = [
  { id: 'desktop', label: 'Desktop', icon: 'fa-display', title: "The project's non-XR fallback path, live as files land" },
  { id: 'xr', label: 'XR session', icon: 'fa-vr-cardboard', title: 'Enter an immersive session on an emulated Quest 3' },
  { id: 'quest', label: 'On the Quest', icon: 'fa-tower-broadcast', title: 'Open this run in the real headset over adb' },
];

export function BuildView({
  game, running, steps, telemetry, doneSummary, buildError,
  backend, agentId, agentEvents = [], agentLive = null,
  agentModel,
  onRun, onCancel, onCancelAll, onHeal, activeRunCount = 0,
  pauseState = 'running', pauseContext = null, canPause = false, onPause, onResume,
  maxTurns, onMaxTurns, imageAssets, onImageAssets,
  projectHandle, projectDir, previewNonce, rating, onRate, onDeviceOpened,
  coachPolicy, onOpenSettings, hasRoot,
  lifecycleStatus, stopReason, validation,
  budgets, onBudgets, budgetState,
  iterationRequest,
  domainAdapter,
  briefProviderId, briefModelId, briefModelDisplayLabel,
  onBriefChange, onSaveBriefVariant, onSaveBriefVersion,
}) {
  // Three ways to look at one project: its flat page, an emulated headset, and
  // the real one. The XR pane is the default because it is the reason this app
  // exists — a VR project that only looks right flat is not a VR project.
  const [activePane, setActivePane] = useState('xr');
  const [showCoach, setShowCoach] = useState(false);
  const [editBudgets, setEditBudgets] = useState(false);
  const [editLibraries, setEditLibraries] = useState(false);
  const [explainTarget, setExplainTarget] = useState(null);

  // Which executor runs the build — provider model or CLI agent — is chosen in
  // the toolbar picker; this view only reacts to it.
  const isAgent = backend === 'agent';
  const agent = AGENTS.find(a => a.id === agentId);

  // "No timeout" is not a separate setting: it is the two time budgets set to 0.
  // Un-ticking restores the shipped defaults rather than whatever they were,
  // since the previous values are gone once they have been zeroed.
  const fallback = defaultBudgets();
  const noTimeout = !budgets?.idleTimeoutSeconds && !budgets?.maxAgentSeconds;

  // 'pausing' = the pause is requested but the run has not reached a safe point
  // yet; 'paused' = nothing is in flight and nothing new will start.
  const paused = pauseState === 'paused';
  const pausing = pauseState === 'pausing';

  useEffect(() => { setExplainTarget(null); }, [projectHandle]);

  if (!game) {
    return html`<div class="gf-build gf-empty">Pick a brief in the Library, then Build it here.</div>`;
  }


  const t = telemetry;
  return html`
    <div class="gf-build">
      <div class="gf-build-header">
        <div class="gf-build-title">
          <span class="gf-era">${game.era}</span>
          <h2>${game.title}</h2>
        </div>
        <div class="gf-build-controls">
          ${!isAgent && html`<label class="gf-maxturns" title="Hard safety cap on model turns. The build normally stops earlier — either when the model reports done, or when loop-detection sees it repeating tool calls with no progress.">turn cap
            <${TurnLimitInput} value=${maxTurns} onChange=${onMaxTurns} disabled=${running} />
          </label>`}
          <label class="gf-toggle" title=${noTimeout
            ? 'No time limit: the build runs until the model finishes or you press Hard stop. Use this for slow local models — the other budgets (turns, files, bytes, tokens) still apply.'
            : `Time limits are on: a turn is abandoned after ${budgets?.idleTimeoutSeconds ?? 0}s with no output. Tick this for a slow local model that needs minutes per turn.`}>
            <input type="checkbox" checked=${noTimeout} disabled=${running}
              onChange=${e => onBudgets(normalizeBudgets(e.target.checked
                ? { ...budgets, idleTimeoutSeconds: 0, maxAgentSeconds: 0 }
                : { ...budgets, idleTimeoutSeconds: fallback.idleTimeoutSeconds, maxAgentSeconds: fallback.maxAgentSeconds }))} />
            <i class="fas fa-infinity"></i> No timeout
          </label>
          ${!isAgent && html`<label class="gf-toggle" title="Let the model generate real sprite/background art via Wan2GP (saved into the project). Each image takes several seconds; needs a Wan2GP node configured.">
            <input type="checkbox" checked=${!!imageAssets} onChange=${e => onImageAssets(e.target.checked)} disabled=${running} />
            <i class="fas fa-image"></i> AI assets
          </label>`}
          <button class="gf-btn" disabled=${running} title="Configure hard time, file, size, image, token, and native-validation limits"
            onClick=${() => setEditBudgets(true)}><i class="fas fa-gauge-high"></i> Budgets</button>
          ${String(game.targetStack || 'web').toLowerCase() === 'web' && html`
            <button class="gf-btn" disabled=${running || !!iterationRequest}
              title=${iterationRequest
                ? 'Revisions inherit the source brief and libraries'
                : 'Edit and reconcile the brief with project libraries'}
              onClick=${() => setEditLibraries(true)}>
              <i class="fas fa-file-pen"></i> Brief & libraries${game.libraries?.length ? ` · ${game.libraries.length}` : ''}
            </button>`}
          ${activeRunCount > 0 && html`
            <span class="gf-run-status status-generating">${activeRunCount} active</span>`}
          <button class="gf-btn gf-primary" disabled=${!hasRoot}
            title=${hasRoot ? 'Start a new independent run' : 'Connect a data root first'}
            onClick=${onRun}>
            <i class=${`fas ${iterationRequest ? 'fa-code-branch' : 'fa-hammer'}`}></i>
            ${activeRunCount > 0 ? 'Build another' : (iterationRequest ? iterationButtonLabel(iterationRequest.kind) : 'Build')}
          </button>
          ${running && canPause && (paused
            ? html`<button class="gf-btn gf-primary gf-resume" onClick=${onResume}
                title="Carry on from exactly where the build parked">
                <i class="fas fa-play"></i> Resume</button>`
            : html`<button class="gf-btn" onClick=${onPause} disabled=${pausing}
                title=${isAgent
                  ? 'Suspend the agent process. It keeps its context and files and carries on when you resume; its time budgets are held while parked.'
                  : 'Finish the model call or tool in flight, then park before the next one starts. Nothing is lost, and no new call is made until you resume.'}>
                <i class=${`fas ${pausing ? 'fa-spinner fa-spin' : 'fa-pause'}`}></i>
                ${pausing ? 'Pausing…' : 'Pause'}</button>`)}
          ${running && html`
            <button class="gf-btn gf-danger" onClick=${onCancel}
              title="Stop the run currently shown right now — the in-flight model request is aborted, not waited out. Files already written are kept."
              ><i class="fas fa-stop"></i> Hard stop</button>`}
          ${(activeRunCount > 1 || (activeRunCount > 0 && !running)) && html`
            <button class="gf-btn gf-danger" onClick=${onCancelAll}
              title="Cancel every active generation"><i class="fas fa-stop-circle"></i> Cancel all</button>`}
        </div>
      </div>
      ${!hasRoot && html`<div class="gf-warn"><i class="fas fa-triangle-exclamation"></i> No data root connected — click the folder icon in the toolbar. Builds are written to disk under it.</div>`}
      ${isAgent && html`<div class="gf-warn gf-warn-agent"><i class="fas fa-robot"></i> External agent (<b>${agent?.label || agentId}</b>) runs on your machine via the local bridge — it can write files${agent?.shell ? ' and run shell commands' : ''} inside this run's project directory. It uses your own CLI login.${agent?.proseOnly ? ' This CLI reports no structured events, so the trace shows its messages only — watch the preview for progress.' : ''}</div>`}
      ${running && pauseState !== 'running' && html`
        <div class=${`gf-pause-state ${pauseState}`} role="status" aria-live="polite">
          <i class=${`fas ${paused ? 'fa-circle-pause' : 'fa-spinner fa-spin'}`}></i>
          <div>
            <strong>${paused ? 'Paused' : 'Pausing…'}</strong>
            <span>${paused
              ? (isAgent
                ? `${agent?.label || 'The agent'} is suspended — it keeps its context and the files it has written, and time budgets are held until you resume.`
                : `Nothing is running${pauseLabel(pauseContext) ? ` · next: ${pauseLabel(pauseContext)}` : ''}. Files already written are on disk and previewed below.`)
              : (isAgent
                ? 'Asking the bridge to suspend the agent process…'
                : 'Finishing the call in flight; the build parks before the next one starts.')}</span>
          </div>
        </div>`}
      ${iterationRequest && html`
        <div class="gf-iteration-banner">
          <i class="fas fa-code-branch"></i>
          <span><b>${iterationButtonLabel(iterationRequest.kind)}</b> from ${iterationRequest.sources.map(source => source.runId).join(' + ')}
            ${iterationRequest.requestedChange ? html` — ${iterationRequest.requestedChange}` : ''}
            <br/>Starting this creates a new append-only run; the source run is never overwritten.</span>
        </div>`}

      <p class="gf-build-prompt">${game.prompt}</p>
      ${game.watchFor && html`<p class="gf-watch"><b>Watch for:</b> ${game.watchFor}</p>`}

      ${t && isAgent && html`
        <div class="gf-telemetry">
          <span><b>${t.files || 0}</b> files</span>
          ${t.turns != null ? html`<span><b>${t.turns}</b> turns</span>` : ''}
          <span><b>${Math.round((t.elapsedMs || 0) / 1000)}</b>s</span>
          ${t.costUsd != null ? html`<span><b>$${Number(t.costUsd).toFixed(4)}</b></span>` : ''}
        </div>`}
      ${t && !isAgent && html`
        <div class="gf-telemetry">
          <span><b>${t.filesWritten}</b> files</span>
          <span><b>${t.turns}</b> turns</span>
          <span><b>${Math.round((t.elapsedMs || 0) / 1000)}</b>s</span>
          <span><b>${(t.bytesWritten / 1024).toFixed(1)}</b> KB written</span>
          ${t.redundantWrites ? html`<span class="gf-stat-warn"><b>${t.redundantWrites}</b> redundant</span>` : ''}
          ${t.imagesGenerated ? html`<span><b>${t.imagesGenerated}</b> <i class="fas fa-image"></i> assets</span>` : ''}
          ${t.completionTokens ? html`<span><b>${t.completionTokens}</b> out tok</span>` : ''}
        </div>`}
      ${doneSummary && html`<div class="gf-done"><i class="fas fa-flag-checkered"></i> ${doneSummary}</div>`}
      ${buildError && html`<div class="gf-warn"><i class="fas fa-triangle-exclamation"></i> Build stopped: ${buildError}. The partial project is saved and previewed below — you can re-run, or try another model/provider.</div>`}
      <${ValidationPanel}
        lifecycleStatus=${lifecycleStatus}
        stopReason=${stopReason}
        validation=${validation}
        budget=${budgetState}
        running=${running}
        onHeal=${onHeal}
        onExplain=${issue => { setExplainTarget({ kind: 'validation-failure', issue }); setShowCoach(true); }}
      />

      <div class="gf-build-body">
        <div class="gf-build-left">
          <div class="gf-panel-title">${isAgent ? `${agent?.label || 'Agent'} activity` : 'Build trace'}</div>
          ${isAgent
            ? html`<${AgentTrace} events=${agentEvents} running=${running} agentLabel=${agent?.label} live=${agentLive} />`
            : html`<${TraceView} steps=${steps} running=${running}
                onExplain=${failure => { setExplainTarget({ kind: 'tool-failure', ...failure }); setShowCoach(true); }} />`}
          ${!isAgent && steps.length > 0 && html`<${WireInspector} steps=${steps} />`}
          <div class="gf-coach-toggle">
            <button class="gf-btn" onClick=${() => setShowCoach(v => !v)}>
              <i class="fas fa-robot"></i> ${showCoach ? 'Hide' : 'Ask'} Coach
            </button>
          </div>
          ${showCoach && html`
            <${AICoachPanel}
              dbName="vr-forge-coach"
              appTitle="VR Forge Coach"
              policy=${coachPolicy}
              onOpenSettings=${onOpenSettings}
              systemPrompt=${domainAdapter?.coachSystemPrompt || 'Review the generated project using only the supplied evidence.'}
              getContext=${() => domainAdapter.coachContext({
                game, projectHandle, validation, steps, agentEvents, telemetry: t, doneSummary,
              })}
              explainTarget=${explainTarget}
              autoExplain=${true}
            />`}
        </div>
        <div class="gf-build-right">
          <div class="vr-pane-tabs" role="tablist">
            ${PANES.map(pane => html`
              <button class=${`vr-pane-tab ${pane.id === activePane ? 'active' : ''}`} role="tab"
                aria-selected=${pane.id === activePane} title=${pane.title}
                onClick=${() => setActivePane(pane.id)}>
                <i class=${`fas ${pane.icon}`}></i> ${pane.label}
              </button>`)}
          </div>
          ${activePane === 'desktop' && html`
            <${VrPreview} projectHandle=${projectHandle} nonce=${previewNonce} stack=${game.targetStack} live=${running} domainAdapter=${domainAdapter} />`}
          ${activePane === 'xr' && html`
            <${XrSessionPane} projectHandle=${projectHandle} nonce=${previewNonce} running=${running}
              manifest=${validation?.projectManifest || null} />`}
          ${activePane === 'quest' && html`
            <${QuestPane} projectDir=${projectDir} entry=${validation?.projectManifest?.entry || 'index.html'}
              onOpened=${onDeviceOpened} />`}
          ${projectHandle && !running && html`
            <div class="gf-rate-row">
              <span>Rate this build:</span>
              <div class="gf-stars">
                ${[1, 2, 3, 4, 5].map(n => html`<i class=${`fa-star ${n <= (rating || 0) ? 'fas on' : 'far'}`} onClick=${() => onRate(n)}></i>`)}
              </div>
            </div>`}
        </div>
      </div>
      ${editBudgets && html`
        <${BudgetDialog} value=${budgets}
          onSave=${next => { onBudgets(next); setEditBudgets(false); }}
          onClose=${() => setEditBudgets(false)} />`}
      ${editLibraries && html`
        <${BriefReconcileDialog}
          brief=${game}
          appId="vr-forge"
          hasRoot=${hasRoot}
          domain="vr"
          domainLabel="VR Forge"
          appTitle="VR Forge Brief Reconciler"
          backend=${backend}
          agentId=${agentId}
          agentModel=${agentModel}
          runAgent=${runAgent}
          providerId=${briefProviderId}
          modelId=${briefModelId}
          modelDisplayLabel=${briefModelDisplayLabel}
          normalizeBrief=${normalizeDraftResult}
          canSaveVersion=${game.source === 'user'}
          onApply=${onBriefChange}
          onSaveVariant=${onSaveBriefVariant}
          onSaveVersion=${onSaveBriefVersion}
          onClose=${() => setEditLibraries(false)}
        />`}
    </div>`;
}

/** What the parked build was about to do, for the banner. */
function pauseLabel(context) {
  if (!context) return '';
  if (context.phase === 'before-tool') return `${context.tool} (turn ${context.turn})`;
  if (context.phase === 'before-turn') return `turn ${context.turn}`;
  return context.phase || '';
}

function iterationButtonLabel(kind) {
  return ({
    fork: 'Create fork',
    improve: 'Improve copy',
    repair: 'Repair copy',
    continue: 'Continue copy',
    merge: 'Merge into copy',
    agent: 'Open agent copy',
  })[kind] || 'Build revision';
}

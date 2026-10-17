import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import {
  listGames, listRuns, getProjectHandle, readValidation, updateMeta,
} from '../services/runStore.js';
import { GamePreview } from './GamePreview.js';
import { AGENTS } from '../services/agentBackend.js';
import { evaluationAverage } from '../services/projectWorkbench.js';
import { ProjectBrowserDialog } from './ProjectBrowserDialog.js';
import { ProjectDiffDialog } from './ProjectDiffDialog.js';
import { EvaluationDialog } from './EvaluationDialog.js';
import { IterationDialog } from './IterationDialog.js';
import { PortDialog } from './PortDialog.js';
import { PromoteToStudioButton } from '../../shared/game-refinement/components/PromoteToStudioButton.js';
import { canPromoteRun } from '../../shared/game-refinement/contracts/promotion.js';
import { promoteRunToStudio } from '../services/promotion.js';

function runLabel(meta = {}) {
  if (meta.backend === 'agent' || meta.agent) {
    const id = meta.agent || meta.telemetry?.agent;
    const label = AGENTS.find(agent => agent.id === id)?.label || id || 'agent';
    const model = meta.agentModel || meta.telemetry?.model;
    return model ? `${label} · ${model}` : label;
  }
  return meta.modelName || meta.modelId || 'unknown model';
}

export function RunsView({ domainAdapter, onIterate, suggestionOptions, focusGameSlug = null, onFocusHandled }) {
  const [games, setGames] = useState([]);
  const [game, setGame] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState([]);
  const [browser, setBrowser] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [evaluate, setEvaluate] = useState(null);
  const [iteration, setIteration] = useState(null);
  const [portRun, setPortRun] = useState(null);

  useEffect(() => { listGames().then(setGames); }, []);

  const openGame = async slug => {
    setGame(slug); setSelected([]);
    setRuns(await listRuns(slug));
  };

  // Arriving from a Library run-count badge: open that game straight away, then
  // release the focus so a later manual "← Games" is not yanked back here.
  useEffect(() => {
    if (!focusGameSlug) return;
    openGame(focusGameSlug).finally(() => onFocusHandled?.());
  }, [focusGameSlug]);

  const toggleRun = async run => {
    if (selected.find(item => item.runId === run.runId)) {
      setSelected(selected.filter(item => item.runId !== run.runId));
      return;
    }
    const { projectHandle, runDir } = await getProjectHandle(game, run.runId);
    const next = [...selected, {
      runId: run.runId, projectHandle, runDir, meta: run.meta, gameSlug: game,
    }].slice(-2);
    setSelected(next);
  };

  const rate = async (runId, rating) => {
    await updateMeta(game, runId, { rating });
    patchRun(runId, { rating });
  };

  const saveEvaluation = async value => {
    await updateMeta(game, evaluate.runId, { evaluation: value });
    patchRun(evaluate.runId, { evaluation: value });
    setEvaluate(null);
  };

  const patchRun = (runId, patch) => {
    setRuns(current => current.map(run => run.runId === runId
      ? { ...run, meta: { ...run.meta, ...patch } } : run));
    setSelected(current => current.map(run => run.runId === runId
      ? { ...run, meta: { ...run.meta, ...patch } } : run));
  };

  const openIteration = async kind => {
    const sources = kind === 'merge' ? selected.slice(0, 2) : selected.slice(0, 1);
    if (!sources.length || (kind === 'merge' && sources.length !== 2)) return;
    const validation = ['repair', 'improve'].includes(kind) ? await readValidation(sources[0].runDir) : null;
    setIteration({ kind, sources, validation });
  };

  const prepareIteration = instruction => {
    const request = {
      kind: iteration.kind,
      gameSlug: game,
      sources: iteration.sources.map(source => ({
        gameSlug: game, runId: source.runId, meta: source.meta,
      })),
      validation: iteration.validation,
      requestedChange: instruction,
      forceBackend: iteration.kind === 'agent' ? 'agent' : null,
    };
    setIteration(null);
    onIterate?.(request);
  };

  if (!game) {
    return html`
      <div class="gf-runs">
        <h2>Past builds</h2>
        ${games.length === 0 && html`<div class="gf-empty">No builds yet. Build a game from the Library.</div>`}
        <div class="gf-runlist">
          ${games.map(item => html`
            <button class="gf-runrow" key=${item.slug} onClick=${() => openGame(item.slug)}>
              <span class="gf-run-title">${item.slug}</span>
              <span class="gf-run-meta">${item.runs} run${item.runs === 1 ? '' : 's'}</span>
              <i class="fas fa-chevron-right"></i>
            </button>`)}
        </div>
      </div>`;
  }

  const one = selected.length === 1;
  const two = selected.length === 2;
  return html`
    <div class="gf-runs">
      <div class="gf-runs-head">
        <button class="gf-btn" onClick=${() => { setGame(null); setSelected([]); }}><i class="fas fa-arrow-left"></i> Games</button>
        <h2>${game}</h2>
        <span class="gf-hint">Select up to 2 runs to inspect, compare, or iterate</span>
      </div>
      <div class="gf-run-actions">
        <button class="gf-btn" disabled=${!one} onClick=${() => openIteration('fork')}><i class="fas fa-code-branch"></i> Fork</button>
        <button class="gf-btn" disabled=${!one} onClick=${() => openIteration('improve')}><i class="fas fa-wand-magic-sparkles"></i> Improve</button>
        <button class="gf-btn" disabled=${!one} onClick=${() => openIteration('repair')}><i class="fas fa-screwdriver-wrench"></i> Fix preview</button>
        <button class="gf-btn" disabled=${!one} onClick=${() => openIteration('continue')}><i class="fas fa-forward"></i> Continue</button>
        <button class="gf-btn" disabled=${!two} onClick=${() => openIteration('merge')}><i class="fas fa-code-merge"></i> Merge ideas</button>
        <span class="gf-run-action-spacer"></span>
        <button class="gf-btn" disabled=${!one} onClick=${() => setPortRun(selected[0])}><i class="fas fa-box-open"></i> Bundle / Port</button>
        <${PromoteToStudioButton}
          run=${one ? selected[0] : null}
          disabled=${!one || !canPromoteRun(selected[0]?.meta).allowed}
          onPromote=${({ run, title }) => promoteRunToStudio({ gameSlug: game, run, title })}
        />
        <button class="gf-btn" disabled=${!one} onClick=${() => setBrowser(selected[0])}><i class="fas fa-folder-tree"></i> Files / ZIP</button>
        <button class="gf-btn" disabled=${!two} onClick=${() => setShowDiff(true)}><i class="fas fa-code-compare"></i> Diff</button>
        <button class="gf-btn" disabled=${!one} onClick=${() => setEvaluate(selected[0])}><i class="fas fa-clipboard-check"></i> Evaluate</button>
        <button class="gf-btn" disabled=${!one} onClick=${() => openIteration('agent')}><i class="fas fa-robot"></i> Open in agent</button>
      </div>
      <div class="gf-compare-layout">
        <div class="gf-runlist gf-runlist-narrow">
          ${runs.map(run => {
            const on = !!selected.find(item => item.runId === run.runId);
            const meta = run.meta || {};
            const rubric = evaluationAverage(meta.evaluation);
            return html`
              <div class=${`gf-runrow ${on ? 'active' : ''}`} key=${run.runId} onClick=${() => toggleRun(run)}>
                <div class="gf-run-title">${runLabel(meta)}</div>
                <span class=${`gf-run-status status-${meta.status || 'legacy'}`}>${meta.status || 'legacy'}</span>
                <div class="gf-run-meta">
                  ${meta.telemetry
                    ? html`${meta.telemetry.filesWritten ?? meta.telemetry.files ?? 0} files · ${Math.round((meta.telemetry.elapsedMs || 0) / 1000)}s${meta.telemetry.turns != null ? ` · ${meta.telemetry.turns} turns` : ''}`
                    : run.runId}
                </div>
                ${meta.parentRunId && html`<div class="gf-lineage"><i class="fas fa-code-branch"></i> ${meta.iterationKind || 'fork'} from ${meta.parentRunId}</div>`}
                ${rubric != null && html`<div class="gf-rubric-average"><i class="fas fa-clipboard-check"></i> ${rubric.toFixed(1)}/5 rubric</div>`}
                <${Stars} rating=${meta.rating || 0} onRate=${value => rate(run.runId, value)} />
              </div>`;
          })}
        </div>
        <div class=${`gf-compare-panes ${selected.length === 2 ? 'two' : ''}`}>
          ${selected.map(item => html`
            <div class="gf-compare-pane" key=${item.runId}>
              <div class="gf-pane-label">${item.meta ? runLabel(item.meta) : item.runId}</div>
              <${GamePreview} projectHandle=${item.projectHandle} nonce=${item.runId} stack=${item.meta?.targetStack} domainAdapter=${domainAdapter} />
            </div>`)}
          ${selected.length === 0 && html`<div class="gf-preview-msg">Pick a run on the left to preview it.</div>`}
        </div>
      </div>
      ${browser && html`<${ProjectBrowserDialog} projectHandle=${browser.projectHandle}
        title=${browser.meta?.gameTitle || game} runId=${browser.runId} onClose=${() => setBrowser(null)} />`}
      ${showDiff && two && html`<${ProjectDiffDialog} left=${selected[0]} right=${selected[1]} onClose=${() => setShowDiff(false)} />`}
      ${evaluate && html`<${EvaluationDialog} value=${evaluate.meta?.evaluation}
        title=${evaluate.runId} criteria=${domainAdapter?.evaluationRubric}
        onSave=${saveEvaluation} onClose=${() => setEvaluate(null)} />`}
      ${iteration && html`<${IterationDialog} kind=${iteration.kind} sources=${iteration.sources}
        suggestionOptions=${suggestionOptions}
        validation=${iteration.validation} onSubmit=${prepareIteration} onClose=${() => setIteration(null)} />`}
      ${portRun && html`<${PortDialog} gameSlug=${game} run=${portRun} onClose=${() => setPortRun(null)} />`}
    </div>`;
}

function Stars({ rating, onRate }) {
  return html`<div class="gf-stars" onClick=${event => event.stopPropagation()}>
    ${[1, 2, 3, 4, 5].map(value => html`
      <i class=${`fa-star ${value <= rating ? 'fas on' : 'far'}`} onClick=${() => onRate(value)}></i>`)}
  </div>`;
}

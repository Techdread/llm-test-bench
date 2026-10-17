import { parseRunProjectPath } from '../shared/forge/services/runNaming.js';
import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { Toolbar } from './components/Toolbar.js';
import { LibraryView } from './components/LibraryView.js';
import { BuildView } from './components/BuildView.js';
import { RunsView } from './components/RunsView.js';
import { MatrixView } from './components/MatrixView.js';
import { BatchDialog } from './components/BatchDialog.js';
import { ApiKeyDialog } from './components/ApiKeyDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { useExecutorSelection } from '../shared/forge/components/useExecutorSelection.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { getApiKey, hasApiKey, saveApiKey } from '../shared/services/providers-openrouter.js';
import { subscribeSuite } from '../shared/services/suite-prefs.js';
import { ensureAppNamespace, getRoot } from '../shared/services/data-root-manager.js';
import {
  agentPauseSupported, attachAgentRun, getAgentModelEffort, listAgentRuns,
  runAgent, setAgentRunPaused,
} from './services/agentBackend.js';
import { readProjectTree } from './services/previewer.js';
import { runBatch } from './services/batchRunner.js';
import {
  createRun, writeMeta, patchMeta, writeTrace, readTrace, createTraceAppender,
  getRunHandles, readMeta, updateMeta, writeValidation, writeRunArtifact,
} from './services/runStore.js';
import { loadBudgets, normalizeBudgets, saveBudgets } from './services/budgets.js';
import {
  copyProject, iterationTask, projectManifest,
} from './services/projectWorkbench.js';
import {
  provisionProjectLibraries, withProjectLibraryBudget,
} from './services/projectLibraries.js';
import { createForgeKernel } from './services/forgeKernel.js';
import { getDomainAdapter } from './adapters/registry.js';
import { addUserPrompt, promptGameSlug, updateUserPrompt } from './services/library.js';
import {
  bindRunSetters, createRunCoordinator,
} from '../shared/forge/services/runConcurrency.js';
import { mountGenerationStatus } from '../shared/components/GenerationStatus.js';
import { mountShowcasePlayer } from '../shared/forge/components/ShowcasePlayer.js';

const DOMAIN_ADAPTER = getDomainAdapter('vr');
const FORGE = createForgeKernel(DOMAIN_ADAPTER);
const APP_ID = 'vr-forge';

function App() {
  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('vr-forge-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vr-forge-theme', theme);
  }, [theme]);

  const [showHelp, setShowHelp] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());
  const [view, setView] = useState('library');

  // The api-keys suite-prefs hydrate is async, so the initial read can miss a
  // key that is already on disk. Subscribe so the icon flips green once it lands.
  useEffect(() => {
    const sync = () => setApiKeySet(hasApiKey());
    sync();
    return subscribeSuite('api-keys', sync);
  }, []);

  // Provider/model
  const sel = modelProviders.getEffectiveSelection('vr-forge-provider', 'vr-forge-model');
  const [allModels, setAllModels] = useState([]);
  const [providerId, setProviderId] = useState(sel.provider);
  const [modelId, setModelId] = useState(sel.model);
  const [modelsLoading, setModelsLoading] = useState(false);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
    } catch (e) { console.warn('load models failed', e); }
    setModelsLoading(false);
  }, [providerId]);
  useEffect(() => { loadModels(); }, []);
  useEffect(() => {
    if (providerId) localStorage.setItem('vr-forge-provider', providerId);
    if (modelId) localStorage.setItem('vr-forge-model', modelId);
  }, [providerId, modelId]);

  // Data root
  const [hasRoot, setHasRoot] = useState(false);
  const [rootName, setRootName] = useState('');
  const [appHandle, setAppHandle] = useState(null);
  useEffect(() => { (async () => {
    try {
      const r = await getRoot();
      if (r) {
        setHasRoot(true);
        setRootName(r.name);
        setAppHandle(await ensureAppNamespace(APP_ID));
      }
    } catch { /* none */ }
  })(); }, []);
  const pickDirectory = useCallback(async () => {
    try {
      const root = await (await import('../shared/services/data-root-manager.js')).connectRoot();
      if (root) {
        setHasRoot(true);
        setRootName(root.name);
        setAppHandle(await ensureAppNamespace(APP_ID));
      }
    } catch (e) { console.warn('connect root failed', e); }
  }, []);

  // Build/run state
  const [game, setGame] = useState(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]);
  const [telemetry, setTelemetry] = useState(null);
  const [doneSummary, setDoneSummary] = useState(null);
  const [buildError, setBuildError] = useState(null);
  const [budgets, setBudgets] = useState(() => loadBudgets());
  const [maxTurns, setMaxTurns] = useState(() => loadBudgets().maxTurns);
  const [budgetState, setBudgetState] = useState(null);
  const [lifecycleStatus, setLifecycleStatus] = useState('created');
  const [stopReason, setStopReason] = useState(null);
  const [validation, setValidation] = useState(null);
  const [projectHandle, setProjectHandle] = useState(null);
  // The run's path under the data root — what the headset opens through the
  // adb reverse (`/_data/<projectDir>/index.html`).
  const [projectDir, setProjectDir] = useState(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [rating, setRating] = useState(0);
  const [backend, setBackend] = useState(() => localStorage.getItem('vr-forge-backend') || 'model'); // 'model' | 'agent'
  const [agentId, setAgentId] = useState(() => localStorage.getItem('vr-forge-agent') || 'claude-code');
  // Per-agent model choice ({ [agentId]: modelId }); '' = let the CLI decide.
  const [agentModels, setAgentModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vr-forge-agent-models') || '{}'); } catch { return {}; }
  });
  const [imageAssets, setImageAssets] = useState(() => localStorage.getItem('vr-forge-image-assets') === 'true');
  const [agentEvents, setAgentEvents] = useState([]);
  // The tokens of the block the agent is composing right now. Deliberately not
  // part of agentEvents: it is provisional, is superseded by the event that
  // carries the finished block, and never reaches the persisted trace.
  const [agentLive, setAgentLive] = useState(null);
  const [iterationRequest, setIterationRequest] = useState(null);
  const [activeRunCount, setActiveRunCount] = useState(0);
  // Pause belongs to the run on screen: 'running' | 'pausing' | 'paused', plus
  // what the build was about to do when it parked (for the banner).
  const [pauseState, setPauseState] = useState('running');
  const [pauseContext, setPauseContext] = useState(null);
  // Whether the run currently on screen can be paused at all. The in-app model
  // loop always can; an external agent can only once its bridge run exists and
  // that bridge advertises pause/resume.
  const [canPause, setCanPause] = useState(false);
  const agentModel = agentModels[agentId] || '';
  const currentRunRef = useRef(null); // { gameSlug, runId }
  const runCoordinatorRef = useRef(null);
  if (!runCoordinatorRef.current) {
    runCoordinatorRef.current = createRunCoordinator(({ activeCount, currentPauseState, currentPauseContext }) => {
      setActiveRunCount(activeCount);
      setPauseState(currentPauseState);
      setPauseContext(currentPauseContext);
    });
  }
  const runUiSettersRef = useRef(null);
  if (!runUiSettersRef.current) {
    runUiSettersRef.current = {
      setRunning, setSteps, setTelemetry, setDoneSummary, setBuildError,
      setBudgetState, setLifecycleStatus, setStopReason, setValidation,
      setProjectHandle, setPreviewNonce, setRating, setAgentEvents, setAgentLive,
      setIterationRequest, setGame, setBackend, setAgentId, setAgentModels,
      setView, setCanPause, setProjectDir,
    };
  }
  // A one-click Heal has to hand its iteration to handleRun immediately. Going
  // through state would make handleRun read the value from before the click,
  // so the request travels in a ref and the state copy only drives the banner.
  const iterationOverrideRef = useRef(null);
  const recoveryAttemptedRef = useRef(false);
  useEffect(() => { localStorage.setItem('vr-forge-backend', backend); }, [backend]);
  useEffect(() => { localStorage.setItem('vr-forge-agent', agentId); }, [agentId]);
  useEffect(() => { localStorage.setItem('vr-forge-agent-models', JSON.stringify(agentModels)); }, [agentModels]);
  useEffect(() => { localStorage.setItem('vr-forge-image-assets', String(imageAssets)); }, [imageAssets]);

  // Recover a run whose agent outlived a reload. The bridge stream resumes after
  // the JSONL event count already on disk, so activity is neither lost nor
  // duplicated, and the recovered run still receives its validation pass.
  useEffect(() => {
    if (!hasRoot || recoveryAttemptedRef.current) return;
    recoveryAttemptedRef.current = true;
    let disposed = false;
    let recoveryLease = null;
    (async () => {
      const listing = await listAgentRuns();
      if (!listing.reachable) return;
      const candidates = [...(listing.runs || [])]
        .filter(item => parseRunProjectPath('vr-forge', item.projectDir || ''))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      let recovered = null;
      for (const bridge of candidates) {
        const match = parseRunProjectPath('vr-forge', bridge.projectDir);
        if (!match) continue;
        try {
          const handles = await getRunHandles(match.gameSlug, match.runId);
          const meta = await readMeta(handles.runDir);
          // An active bridge process is authoritative. This also repairs runs
          // incorrectly marked failed by the pre-fix V2 stream regression while
          // their agent was still writing in the background.
          const emptyPrematureFailure = meta?.status === 'failed'
            && (meta?.telemetry?.files ?? meta?.telemetry?.filesWritten ?? 0) === 0
            && (bridge.events || 0) > 0;
          if (!bridge.done || meta?.status === 'created' || meta?.status === 'generating' || emptyPrematureFailure) {
            recovered = { bridge, gameSlug: match.gameSlug, runId: match.runId, meta, ...handles };
            break;
          }
        } catch { /* stale bridge entry */ }
      }
      if (!recovered || disposed) return;

      const lease = runCoordinatorRef.current.begin();
      recoveryLease = lease;
      const {
        setRunning, setTelemetry, setDoneSummary, setBuildError,
        setLifecycleStatus, setStopReason, setValidation, setProjectHandle,
        setPreviewNonce, setAgentEvents, setAgentLive, setGame, setBackend,
        setAgentId, setAgentModels, setView, setCanPause, setProjectDir,
      } = bindRunSetters(lease, runUiSettersRef.current);
      const { bridge, gameSlug, runId, meta, runDir, projectHandle: recoveredProject } = recovered;
      const journal = await readTrace(runDir);
      const persistedEvents = journal.map(record => record?.event || record).filter(Boolean);
      const traceAppender = createTraceAppender(runDir);
      const recoveredBudgets = normalizeBudgets(meta.budgets || budgets);
      let recoveredStopReason = bridge.budgetStop ? 'budget' : 'done';
      const events = [...persistedEvents];

      setGame({
        id: meta.gameId || gameSlug, title: meta.gameTitle || gameSlug,
        era: meta.era || 'Recovered', targetStack: meta.targetStack || 'web',
        prompt: meta.prompt || 'Recovered external-agent build',
        watchFor: meta.watchFor || '',
        libraries: meta.libraries || meta.promptSnapshot?.libraries || [],
        authoring: meta.promptSnapshot?.authoring || { source: 'human' },
      });
      setBackend('agent');
      setAgentId(meta.agent || bridge.agent || 'claude-code');
      if (meta.agentModel || bridge.model) {
        const recoveredModel = meta.agentModel || bridge.model;
        setAgentModels(current => ({ ...current, [meta.agent || bridge.agent || 'claude-code']: recoveredModel }));
      }
      setAgentEvents(events);
      setProjectHandle(recoveredProject);
      setProjectDir(bridge.projectDir);
      setLifecycleStatus('generating');
      setStopReason(null);
      setValidation(null);
      setRunning(true);
      setView('build');
      lease.guard(() => {
        currentRunRef.current = { gameSlug, runId, runDir, projectDir: bridge.projectDir };
      });
      // A run recovered after a reload is still a live bridge process, so it can
      // be parked exactly like one this page started.
      agentPauseSupported().then((supported) => {
        if (!supported) return;
        lease.setPauseHook(paused => setAgentRunPaused(bridge.runId, paused));
        setCanPause(true);
      }).catch(() => { /* old bridge: no pause button */ });

      const result = await attachAgentRun({
        runId: bridge.runId,
        fromIndex: persistedEvents.length,
        signal: lease.controller.signal,
        onEvent: event => {
          events.push(event);
          traceAppender.append({ backend: 'agent', bridgeRunId: bridge.runId, index: events.length - 1, event, timestamp: new Date().toISOString() });
          if (event.budgetCode) recoveredStopReason = 'budget';
          if (event.type === 'error') setBuildError(event.message);
          if (event.type === 'done' && event.summary) setDoneSummary(event.summary);
          setAgentEvents(current => [...current, event]);
          setAgentLive(null);
          if (event.type === 'file') setPreviewNonce(value => value + 1);
        },
        onLive: setAgentLive,
      });
      if (disposed) { lease.finish(); return; }
      if (!result.doneEvent && recoveredStopReason !== 'budget') recoveredStopReason = 'bridge_finished_without_done';
      else if ((result.doneEvent?.exitCode ?? 0) !== 0 && recoveredStopReason !== 'budget') recoveredStopReason = 'agent_error';

      await traceAppender.flush();
      await writeTrace(runDir, events);
      setCanPause(false); // generation is over; validation is not pausable
      const tree = await readProjectTree(recoveredProject).catch(() => new Map());
      let totalBytes = 0;
      for (const file of tree.values()) totalBytes += file.size || 0;
      const telemetry = {
        agent: meta.agent || bridge.agent, model: meta.agentModel || bridge.model || null,
        files: tree.size, bytesWritten: totalBytes,
        elapsedMs: bridge.elapsedMs || 0,
        costUsd: result.doneEvent?.costUsd ?? null,
        turns: result.doneEvent?.numTurns ?? null,
      };
      setTelemetry(telemetry);
      setStopReason(recoveredStopReason);
      setLifecycleStatus('stopped');
      await patchMeta(runDir, {
        status: 'stopped', stopReason: recoveredStopReason,
        bridgeRunId: bridge.runId, telemetry,
        doneSummary: result.doneEvent?.summary || null,
        generationStoppedAt: new Date().toISOString(),
      });

      setLifecycleStatus('validating');
      await patchMeta(runDir, { status: 'validating', validationStartedAt: new Date().toISOString() });
      const report = await FORGE.validate({
        projectHandle: recoveredProject, projectDir: bridge.projectDir,
        stack: meta.targetStack || 'web', budgets: recoveredBudgets,
        libraries: meta.libraries || meta.promptSnapshot?.libraries || [],
        brief: meta.promptSnapshot || null,
        stopReason: recoveredStopReason,
      }).catch(error => ({
        schemaVersion: 1, kind: 'validator', checkedAt: new Date().toISOString(),
        status: 'failed', issues: [{ severity: 'error', code: 'validator_crash', message: error.message }],
        screenshot: null,
      }));
      await writeValidation(runDir, report);
      if (report.screenshot) await writeRunArtifact(runDir, 'preview.png', report.screenshot);
      setValidation({ ...report, screenshot: undefined, screenshotCaptured: !!report.screenshot });
      setLifecycleStatus(report.status);
      await patchMeta(runDir, {
        status: report.status,
        validation: {
          status: report.status, checkedAt: report.checkedAt,
          issueCount: report.issues.length,
          errorCount: report.issues.filter(issue => issue.severity === 'error').length,
          warningCount: report.issues.filter(issue => issue.severity === 'warning').length,
          screenshot: !!report.screenshot,
        },
        validationFinishedAt: new Date().toISOString(),
      });
      setRunning(false);
      setPreviewNonce(value => value + 1);
      lease.finish();
    })().catch(error => {
      console.warn('agent recovery failed', error);
      if (!disposed && recoveryLease?.isCurrent()) setRunning(false);
      recoveryLease?.finish();
    });
    return () => { disposed = true; };
  }, [hasRoot]);

  // Batch state
  const [runsFocus, setRunsFocus] = useState(null);
  const [showBatch, setShowBatch] = useState(false);
  const [batch, setBatch] = useState({ running: false, index: 0, total: 0, current: null, results: [], totals: null });
  const batchAbortRef = useRef(null);

  const handleBuildFromLibrary = useCallback((prompt) => {
    runCoordinatorRef.current.detachCurrent();
    currentRunRef.current = null;
    setCanPause(false);
    setGame(prompt);
    setProjectDir(null);
    setIterationRequest(null);
    setRunning(false); setSteps([]); setAgentEvents([]); setAgentLive(null); setTelemetry(null); setDoneSummary(null);
    setProjectHandle(null); setRating(0);
    setBudgetState(null); setLifecycleStatus('created'); setStopReason(null); setValidation(null); setBuildError(null);
    setView('build');
  }, []);

  const handlePrepareIteration = useCallback((request) => {
    const source = request.sources?.[0];
    if (!source) return;
    runCoordinatorRef.current.detachCurrent();
    currentRunRef.current = null;
    setCanPause(false);
    const meta = source.meta || {};
    setGame({
      id: meta.gameId || request.gameSlug,
      title: meta.gameTitle || request.gameSlug,
      era: meta.era || 'Saved run',
      targetStack: meta.targetStack || 'web',
      prompt: meta.prompt || 'Continue the saved project.',
      watchFor: meta.watchFor || '',
      promptVersion: meta.sourcePromptVersion || meta.promptVersion || 1,
      libraries: meta.libraries || meta.promptSnapshot?.libraries || [],
      tags: meta.promptSnapshot?.tags || [],
      authoring: meta.promptSnapshot?.authoring || { source: 'human' },
    });
    const nextBackend = request.forceBackend || meta.backend || backend;
    setBackend(nextBackend);
    if (nextBackend === 'agent' && meta.agent) setAgentId(meta.agent);
    if (nextBackend === 'model') {
      if (meta.providerId) setProviderId(meta.providerId);
      if (meta.modelId) setModelId(meta.modelId);
    }
    setIterationRequest(request);
    setRunning(false); setSteps([]); setAgentEvents([]); setAgentLive(null); setTelemetry(null); setDoneSummary(null);
    setProjectHandle(null); setRating(0); setBudgetState(null);
    setLifecycleStatus('created'); setStopReason(null); setValidation(null); setBuildError(null);
    setView('build');
  }, [backend]);

  const handleRun = useCallback(async () => {
    if (!game) return;
    const iteration = iterationOverrideRef.current || iterationRequest;
    iterationOverrideRef.current = null;
    if (iteration?.kind !== 'fork' && backend === 'model' && !modelId) return;
    const lease = runCoordinatorRef.current.begin();
    const {
      setRunning, setSteps, setTelemetry, setDoneSummary, setBuildError,
      setBudgetState, setLifecycleStatus, setStopReason, setValidation,
      setProjectHandle, setPreviewNonce, setRating, setAgentEvents, setAgentLive,
      setIterationRequest, setCanPause, setProjectDir,
    } = bindRunSetters(lease, runUiSettersRef.current);
    const gameSlug = promptGameSlug(game);
    const runBudgets = withProjectLibraryBudget(
      normalizeBudgets({ ...budgets, maxTurns }),
      game.libraries,
    );
    setRunning(true); setSteps([]); setAgentEvents([]); setAgentLive(null);
    setTelemetry(null); setDoneSummary(null);
    setBuildError(null); setProjectHandle(null); setRating(0); setValidation(null);
    setLifecycleStatus('created'); setStopReason(null); setBudgetState({
      limits: runBudgets, usage: {}, decision: { allowed: true },
      remaining: {
        turns: runBudgets.maxTurns, files: runBudgets.maxFiles,
        bytes: runBudgets.maxTotalBytes, images: runBudgets.maxImages,
        imagePixels: runBudgets.maxImagePixels, tokens: runBudgets.maxTokens,
        costUsd: runBudgets.maxCostUsd,
      },
    });

    const ac = lease.controller;

    let run;
    try {
      run = await createRun(gameSlug, { backend, modelId, agentId, agentModel });
    } catch (e) {
      console.error('createRun failed', e);
      setRunning(false);
      lease.finish();
      return;
    }
    const projectDir = `vr-forge/projects/${gameSlug}/${run.runId}/project`;
    const traceAppender = createTraceAppender(run.runDir);
    lease.guard(() => {
      currentRunRef.current = { gameSlug, runId: run.runId, runDir: run.runDir, projectDir };
    });
    const createdAt = new Date().toISOString();
    let revisionTask = '';
    let lineage = {};
    let copied = null;
    if (iteration?.sources?.length) {
      try {
        const sourceIds = iteration.sources.map(source => source.runId);
        const parent = iteration.sources[0];
        const parentHandles = await getRunHandles(parent.gameSlug || gameSlug, parent.runId);
        copied = await copyProject(parentHandles.projectHandle, run.projectHandle);
        let referenceContext = '';
        if (iteration.kind === 'merge' && iteration.sources[1]) {
          const other = iteration.sources[1];
          const otherHandles = await getRunHandles(other.gameSlug || gameSlug, other.runId);
          const otherManifest = await projectManifest(otherHandles.projectHandle, {
            includeText: true, sourceLimit: 24 * 1024,
          });
          referenceContext = `\n\nSecondary run ${other.runId} project manifest:\n${JSON.stringify({
            files: otherManifest.files.map(file => ({
              path: file.path, size: file.size,
              excerpt: file.text == null ? null : file.text.slice(0, 2400),
            })),
            totalBytes: otherManifest.totalBytes,
          }, null, 2).slice(0, 24000)}`;
        }
        if (iteration.kind === 'continue') {
          const priorTrace = await readTrace(parentHandles.runDir);
          referenceContext += `\n\nRecent durable trace from ${parent.runId}:\n${JSON.stringify(priorTrace.slice(-5), null, 2).slice(0, 12000)}`;
        }
        revisionTask = iterationTask({
          kind: iteration.kind,
          requestedChange: iteration.requestedChange,
          validation: iteration.validation,
          sourceRunIds: sourceIds,
        }) + referenceContext;
        lineage = FORGE.iterationMetadata({
          kind: iteration.kind,
          parentRunId: parent.runId,
          sourceRunIds: sourceIds,
          requestedChange: iteration.requestedChange,
          promptVersion: game.promptVersion || parent.meta?.sourcePromptVersion || parent.meta?.promptVersion || 1,
        });
      } catch (copyError) {
        const failedAt = new Date().toISOString();
        await writeMeta(run.runDir, {
          ...FORGE.baseRunMetadata({
            task: game, runId: run.runId, artifactSlug: gameSlug, backend,
            budgets: runBudgets, createdAt,
          }),
          status: 'failed', stopReason: 'copy_error', error: copyError.message,
          updatedAt: failedAt,
        });
        setLifecycleStatus('failed');
        setStopReason('copy_error');
        setBuildError(`could not copy the saved parent: ${copyError.message}`);
        setRunning(false);
        lease.finish();
        return;
      }
    }
    const baseMeta = {
      ...FORGE.baseRunMetadata({
        task: game, runId: run.runId, artifactSlug: gameSlug, backend,
        budgets: runBudgets, createdAt,
      }),
      agent: backend === 'agent' ? agentId : null,
      providerId: backend === 'model' ? providerId : null,
      modelId: backend === 'model' ? modelId : null,
      agentModel: backend === 'agent' ? agentModel || null : null,
      capabilityPolicy: backend === 'model'
        ? {
          allowed: FORGE.capabilities(game, { imageAssets, revision: !!iteration }),
          policies: DOMAIN_ADAPTER.capabilityPolicies,
        }
        : { allowed: ['external-agent.project-shell'], enforcedBy: 'serve.py bridge' },
      ...lineage,
    };
    await writeMeta(run.runDir, baseMeta);

    try {
      const provisioned = await provisionProjectLibraries(
        run.projectHandle,
        game.libraries,
        { targetStack: game.targetStack || 'web' },
      );
      if (provisioned.length) {
        await patchMeta(run.runDir, { provisionedLibraries: provisioned });
        await traceAppender.append({
          type: 'provision',
          libraries: provisioned,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (provisionError) {
      const failedAt = new Date().toISOString();
      const records = provisionError.records || [{
        id: 'unknown', label: 'Project library', version: null,
        files: [], bytes: 0, status: 'failed', error: provisionError.message,
      }];
      await traceAppender.append({
        type: 'provision',
        libraries: records,
        error: provisionError.message,
        timestamp: failedAt,
      });
      await traceAppender.flush();
      await patchMeta(run.runDir, {
        status: 'failed',
        stopReason: 'library_provision_error',
        error: provisionError.message,
        provisionedLibraries: records,
        generationStoppedAt: failedAt,
      });
      setLifecycleStatus('failed');
      setStopReason('library_provision_error');
      setBuildError(provisionError.message);
      setRunning(false);
      lease.finish();
      return;
    }

    // A fork is a complete append-only attempt by itself: copy, validate, and
    // preserve lineage without spending a model/agent call.
    if (iteration?.kind === 'fork') {
      setProjectHandle(run.projectHandle);
      setPreviewNonce(value => value + 1);
      const forkTelemetry = {
        files: copied?.files || 0, filesWritten: copied?.files || 0,
        bytesWritten: copied?.bytes || 0,
        elapsedMs: Date.now() - Date.parse(createdAt), turns: 0,
      };
      await writeTrace(run.runDir, [{
        type: 'fork',
        parentRunId: lineage.parentRunId,
        sourceRunIds: lineage.sourceRunIds,
        filesCopied: copied?.files || 0,
        bytesCopied: copied?.bytes || 0,
        timestamp: new Date().toISOString(),
      }]);
      await writeRunArtifact(run.runDir, 'capability-audit.json', JSON.stringify({
        schemaVersion: 1,
        backend: 'kernel',
        adapterId: DOMAIN_ADAPTER.id,
        allowedCapabilities: ['project.copy', 'project.validate'],
        records: [{
          timestamp: new Date().toISOString(),
          capability: 'project.copy',
          permission: 'project-read-write',
          outcome: 'allowed',
          arguments: { parentRunId: lineage.parentRunId },
          result: { files: copied?.files || 0, bytes: copied?.bytes || 0 },
        }],
      }, null, 2));
      setTelemetry(forkTelemetry);
      setStopReason('forked');
      setLifecycleStatus('stopped');
      await patchMeta(run.runDir, {
        status: 'stopped', stopReason: 'forked', telemetry: forkTelemetry,
        generationStoppedAt: new Date().toISOString(),
      });
      setLifecycleStatus('validating');
      await patchMeta(run.runDir, { status: 'validating', validationStartedAt: new Date().toISOString() });
      const report = await FORGE.validate({
        projectHandle: run.projectHandle, projectDir,
        stack: game.targetStack || 'web', budgets: runBudgets,
        libraries: game.libraries, brief: game, stopReason: 'done',
      }).catch(error => ({
        schemaVersion: 1, kind: 'validator', checkedAt: new Date().toISOString(),
        status: 'failed', issues: [{ severity: 'error', code: 'validator_crash', message: error.message }],
        screenshot: null,
      }));
      await writeValidation(run.runDir, report);
      if (report.screenshot) await writeRunArtifact(run.runDir, 'preview.png', report.screenshot);
      const uiReport = { ...report, screenshot: undefined, screenshotCaptured: !!report.screenshot };
      setValidation(uiReport);
      setLifecycleStatus(report.status);
      await patchMeta(run.runDir, {
        status: report.status,
        validation: {
          status: report.status, checkedAt: report.checkedAt,
          issueCount: report.issues.length,
          errorCount: report.issues.filter(issue => issue.severity === 'error').length,
          warningCount: report.issues.filter(issue => issue.severity === 'warning').length,
          screenshot: !!report.screenshot,
        },
        validationFinishedAt: new Date().toISOString(),
      });
      setRunning(false);
      setIterationRequest(null);
      lease.finish();
      return;
    }

    await patchMeta(run.runDir, { status: 'generating', generationStartedAt: new Date().toISOString() });
    setLifecycleStatus('generating');

    // Attach the (empty) project dir to the preview now so it streams to life as
    // files land — the svg-benchmark / prompt-gallery live-preview behaviour.
    setProjectHandle(run.projectHandle);
    setProjectDir(projectDir);
    setPreviewNonce(n => n + 1);

    let generationStopReason = 'done', error = null, meta = {};
    if (backend === 'agent') {
      // ── External coding agent (spec 304) via the serve.py bridge ──
      const t0 = Date.now();
      let files = 0; let doneEvent = null; let bridgeRunId = null;
      const eventLog = [];
      // Poll the dir so the preview boots as the agent writes files (no onStep here).
      const previewPoll = setInterval(() => setPreviewNonce(n => n + 1), 1500);
      // Read at run time: the toolbar picker writes the effort straight to
      // localStorage, so a render-time copy could be one change behind.
      const agentEffort = getAgentModelEffort(agentId, agentModel);
      try {
        const r = await runAgent({
          agent: agentId,
          // A bridge too old to understand an unlimited time budget would read 0
          // as its 10-second floor. runAgent sends that bridge its maximum
          // instead and tells us here, so the downgrade is visible rather than
          // arriving later disguised as "Agent time budget exceeded".
          onNotice: (notice) => setBuildError(notice.message),
          prompt: FORGE.externalAgentTask(game, { revisionTask }),
          projectDir,
          // Effort is stored beside the model by the toolbar picker, not folded
          // into the model id, so it has to be read back at run time.
          options: {
            ...(agentModel ? { model: agentModel } : {}),
            ...(agentEffort ? { effort: agentEffort } : {}),
          },
          budgets: runBudgets,
          signal: ac.signal,
          onStart: (id) => {
            bridgeRunId = id;
            patchMeta(run.runDir, { bridgeRunId: id }).catch(e => console.warn('bridge id metadata failed', e));
            // An external agent is a process, not a loop we can gate: pausing it
            // suspends the process tree through the bridge. Only offered once the
            // run exists AND this bridge advertises pause/resume.
            agentPauseSupported().then((supported) => {
              if (!supported) return;
              lease.setPauseHook(paused => setAgentRunPaused(id, paused));
              setCanPause(true);
            }).catch(() => { /* old bridge: no pause button */ });
          },
          onLive: setAgentLive,
          onEvent: (ev) => {
            eventLog.push(ev);
            traceAppender.append({ backend: 'agent', bridgeRunId, index: eventLog.length - 1, event: ev, timestamp: new Date().toISOString() });
            setAgentEvents(prev => [...prev, ev]);
            setAgentLive(null);
            if (ev.type === 'file') { files++; setPreviewNonce(n => n + 1); }
            if (ev.type === 'done' && ev.summary) setDoneSummary(ev.summary);
            if (ev.type === 'error') {
              error = ev.message;
              setBuildError(ev.message);
              if (ev.budgetCode) {
                generationStopReason = 'budget';
                setBudgetState(current => current ? {
                  ...current, decision: { allowed: false, code: ev.budgetCode, reason: ev.message, at: new Date().toISOString() },
                } : current);
              } else generationStopReason = 'agent_error';
            }
          },
        });
        doneEvent = r.doneEvent;
        bridgeRunId = r.runId || bridgeRunId;
        if (ac.signal.aborted) generationStopReason = 'cancelled';
        else if (!doneEvent && generationStopReason !== 'budget') generationStopReason = 'bridge_finished_without_done';
        else if (generationStopReason !== 'budget' && (doneEvent?.exitCode ?? 0) !== 0) generationStopReason = 'agent_error';
      } catch (e) {
        generationStopReason = ac.signal.aborted ? 'cancelled' : 'bridge_error';
        error = e.message; setBuildError(e.message); console.error('agent build failed', e);
      } finally {
        clearInterval(previewPoll);
        setAgentLive(null);
      }
      // Agents that report no file events (prose-only CLIs) would otherwise
      // record 0 files however much they wrote, so count what actually landed.
      if (!files && run.projectHandle) {
        try { files = (await readProjectTree(run.projectHandle)).size; } catch { /* dir gone */ }
      }
      let actualBytes = 0;
      let actualImages = 0;
      let actualImagePixels = 0;
      try {
        const tree = await readProjectTree(run.projectHandle);
        files = tree.size;
        for (const file of tree.values()) actualBytes += file.size || 0;
      } catch { /* validation reports inaccessible output */ }
      try {
        const bridgeState = (await listAgentRuns()).runs?.find(item => item.runId === bridgeRunId);
        const usage = bridgeState?.projectUsage;
        if (usage) {
          files = usage.files ?? files;
          actualBytes = usage.totalBytes ?? actualBytes;
          actualImages = usage.images || 0;
          actualImagePixels = usage.imagePixels || 0;
        }
        if (bridgeState?.budgetStop) {
          generationStopReason = 'budget';
          error = bridgeState.budgetStop.reason;
        }
      } catch { /* event stream still contains the authoritative decision */ }
      const tel = {
        agent: agentId, model: agentModel || null, files, bytesWritten: actualBytes,
        elapsedMs: Date.now() - t0, costUsd: doneEvent?.costUsd ?? null,
        turns: doneEvent?.numTurns ?? null,
        promptTokens: doneEvent?.usage?.inputTokens ?? null,
        completionTokens: doneEvent?.usage?.outputTokens ?? null,
      };
      const actualTokens = (tel.promptTokens || 0) + (tel.completionTokens || 0);
      const agentBudget = {
        limits: runBudgets,
        usage: {
          files, totalBytes: actualBytes, images: actualImages,
          imagePixels: actualImagePixels, tokens: actualTokens,
          costUsd: tel.costUsd, turns: tel.turns,
        },
        decision: generationStopReason === 'budget'
          ? { allowed: false, code: 'agent_budget', reason: error || 'Agent budget exceeded' }
          : { allowed: true, reason: null },
        remaining: {
          turns: Math.max(0, runBudgets.maxTurns - (tel.turns || 0)),
          files: Math.max(0, runBudgets.maxFiles - files),
          bytes: Math.max(0, runBudgets.maxTotalBytes - actualBytes),
          images: Math.max(0, runBudgets.maxImages - actualImages),
          imagePixels: Math.max(0, runBudgets.maxImagePixels - actualImagePixels),
          tokens: Math.max(0, runBudgets.maxTokens - actualTokens),
          costUsd: runBudgets.maxCostUsd === null || tel.costUsd == null ? null : Math.max(0, runBudgets.maxCostUsd - tel.costUsd),
        },
      };
      setBudgetState(agentBudget);
      setTelemetry(tel);
      meta = {
        backend: 'agent', agent: agentId, agentModel: agentModel || null,
        bridgeRunId, telemetry: tel, doneSummary: doneEvent?.summary || null,
        budget: agentBudget,
        capabilityPolicy: {
          allowed: ['external-agent.project-shell'],
          enforcedBy: 'serve.py bridge',
          auditedBy: 'trace.jsonl',
        },
      };
      await writeRunArtifact(run.runDir, 'capability-audit.json', JSON.stringify({
        schemaVersion: 1,
        backend: 'agent',
        capabilities: meta.capabilityPolicy,
        bridgeRunId,
        traceArtifact: 'trace.jsonl',
      }, null, 2));
      await writeTrace(run.runDir, eventLog);
    } else {
      // ── In-app tool-calling loop ──
      setCanPause(true);
      const modelObj = allModels.find(m => m.providerId === providerId && m.modelId === modelId);
      const modelName = modelObj?.name || modelId;
      const traceSteps = []; // local mirror so we can persist the trace even on error
      let result;
      try {
        result = await FORGE.runModelBuild({
          task: game,
          revisionTask,
          providerId, modelId,
          directoryHandle: run.projectHandle,
          maxTurns,
          imageAssets,
          budgets: runBudgets,
          abortSignal: ac.signal,
          // Pause is cooperative here: the loop finishes the model call or tool
          // it is in and parks at the next boundary, so nothing is lost.
          shouldPause: () => lease.isPauseRequested(),
          waitIfPaused: context => lease.waitIfPaused(context),
          onBudget: setBudgetState,
          onStep: (step) => {
            traceAppender.append({ backend: 'model', event: 'step', step, timestamp: new Date().toISOString() });
            const j = traceSteps.findIndex(s => s.turn === step.turn);
            if (j >= 0) traceSteps[j] = step; else traceSteps.push(step);
            setSteps(prev => {
              const next = [...prev];
              const i = next.findIndex(s => s.turn === step.turn);
              if (i >= 0) next[i] = step; else next.push(step);
              return next;
            });
            if (step.toolCalls?.some(tc => tc.name === 'write_file' || tc.name === 'edit_file')) {
              setPreviewNonce(n => n + 1);
            }
          },
        });
        setTelemetry(result.telemetry);
        setBudgetState(result.budget);
        setDoneSummary(result.doneSummary);
        if (result.stopReason === 'stuck') {
          setBuildError('the model got stuck repeating the same writes with no new progress, so the build was stopped early');
        } else if (result.stopReason === 'max_turns') {
          setBuildError(`hit the ${maxTurns}-turn safety cap before the model reported done`);
        } else if (result.stopReason === 'budget') {
          setBuildError(result.budget?.decision?.reason || 'a build budget was exceeded');
        } else if (result.stopReason === 'no_tool_calls') {
          setBuildError('the model repeatedly answered with prose instead of the required file tool call, so the partial project was preserved');
        }
        generationStopReason = result.stopReason;
      } catch (e) {
        if (ac.signal.aborted || e.message === 'Run cancelled') generationStopReason = 'cancelled';
        else if (e.name === 'TimeoutError' || /timed out|no model output/i.test(e.message)) generationStopReason = 'idle_timeout';
        else generationStopReason = 'model_error';
        error = e.message;
        if (generationStopReason !== 'cancelled') setBuildError(e.message);
        console.error('build failed', e);
      }
      meta = {
        backend: 'model', providerId, modelId, modelName,
        telemetry: result?.telemetry || null, doneSummary: result?.doneSummary || null,
        budget: result?.budget || null,
        capabilityPolicy: {
          allowed: result?.capabilities || FORGE.capabilities(game, { imageAssets, revision: !!iteration }),
          policies: result?.capabilityPolicies || {},
          auditCount: result?.capabilityAudit?.length || 0,
          auditArtifact: 'capability-audit.json',
        },
      };
      await writeRunArtifact(run.runDir, 'capability-audit.json', JSON.stringify({
        schemaVersion: 1,
        backend: 'model',
        adapterId: DOMAIN_ADAPTER.id,
        allowedCapabilities: meta.capabilityPolicy.allowed,
        policies: meta.capabilityPolicy.policies,
        records: result?.capabilityAudit || [],
      }, null, 2));
      await writeTrace(run.runDir, result?.steps || traceSteps);
    }

    await traceAppender.flush();
    setCanPause(false);
    setStopReason(generationStopReason);
    setLifecycleStatus('stopped');
    await patchMeta(run.runDir, {
      status: 'stopped', stopReason: generationStopReason, error,
      generationStoppedAt: new Date().toISOString(), ...meta,
    });

    // Model/agent completion is only a stop signal. Trust comes from this pass.
    setLifecycleStatus('validating');
    await patchMeta(run.runDir, { status: 'validating', validationStartedAt: new Date().toISOString() });
    let report;
    try {
      report = await FORGE.validate({
        projectHandle: run.projectHandle, projectDir,
        stack: game.targetStack || 'web', budgets: runBudgets,
        libraries: game.libraries, brief: game,
        stopReason: generationStopReason,
      });
    } catch (validationError) {
      report = {
        schemaVersion: 1, kind: 'validator', checkedAt: new Date().toISOString(),
        status: 'failed', issues: [{
          severity: 'error', code: 'validator_crash',
          message: validationError.message,
        }], screenshot: null,
      };
    }
    await writeValidation(run.runDir, report);
    if (report.screenshot) await writeRunArtifact(run.runDir, 'preview.png', report.screenshot);
    setValidation({ ...report, screenshot: undefined, screenshotCaptured: !!report.screenshot });
    setLifecycleStatus(report.status);
    await patchMeta(run.runDir, {
      status: report.status,
      validation: {
        status: report.status, checkedAt: report.checkedAt,
        issueCount: report.issues.length,
        errorCount: report.issues.filter(issue => issue.severity === 'error').length,
        warningCount: report.issues.filter(issue => issue.severity === 'warning').length,
        screenshot: !!report.screenshot,
      },
      validationFinishedAt: new Date().toISOString(),
    });

    setProjectHandle(run.projectHandle);
    setPreviewNonce(n => n + 1);
    setRunning(false);
    setIterationRequest(null);
    lease.finish();
  }, [game, backend, agentId, agentModel, modelId, providerId, allModels, maxTurns, imageAssets, budgets, iterationRequest]);

  /**
   * Heal the run on screen: copy its project into a fresh run and hand the
   * backend the failures the validator recorded.
   *
   * The copy is the point — the failed run keeps its files, trace and evidence
   * exactly as they were, so a heal that makes things worse costs nothing. It
   * is the Runs view's "Fix preview" without the trip through Runs, and without
   * the dialog, because at this moment the issues are already on screen.
   */
  const handleHeal = useCallback(async () => {
    const current = currentRunRef.current;
    if (!current || running) return;
    const meta = await readMeta(current.runDir).catch(() => null);
    const request = {
      kind: 'repair',
      gameSlug: current.gameSlug,
      sources: [{ gameSlug: current.gameSlug, runId: current.runId, meta: meta || {} }],
      // The on-screen report is the same object the run wrote, minus its
      // screenshot; `iterationTask` only reads `issues`.
      validation,
      requestedChange: '',
    };
    iterationOverrideRef.current = request;
    setIterationRequest(request);
    await handleRun();
  }, [running, validation, handleRun]);

  const handlePause = useCallback(async () => {
    try {
      await runCoordinatorRef.current.pauseCurrent();
    } catch (e) {
      setBuildError(`could not pause this run — ${e.message}`);
    }
  }, []);
  const handleResume = useCallback(async () => {
    try {
      await runCoordinatorRef.current.resumeCurrent();
    } catch (e) {
      setBuildError(`could not resume this run — ${e.message}. Use Hard stop if it stays parked.`);
    }
  }, []);

  /**
   * The run was opened in the headset. Recorded as provenance in the run's
   * metadata and on the report — never as validation evidence, because the hub
   * cannot see what happened after Quest Browser loaded the page.
   */
  const handleDeviceOpened = useCallback(async (device) => {
    setValidation(current => (current ? { ...current, device } : current));
    const current = currentRunRef.current;
    if (!current) return;
    try { await patchMeta(current.runDir, { device }); }
    catch (e) { console.warn('device provenance not saved', e); }
  }, []);

  const handleCancel = useCallback(() => runCoordinatorRef.current.cancelCurrent(), []);
  const handleCancelAll = useCallback(() => runCoordinatorRef.current.cancelAll(), []);

  const handleRate = useCallback(async (n) => {
    setRating(n);
    const r = currentRunRef.current;
    if (r) { try { await updateMeta(r.gameSlug, r.runId, { rating: n }); } catch (e) { console.warn(e); } }
  }, []);

  const handleStartBatch = useCallback(async (config) => {
    if (config.backend !== 'agent' && !modelId) return;
    const modelObj = allModels.find(m => m.providerId === providerId && m.modelId === modelId);
    const modelName = modelObj?.name || modelId;
    const ac = new AbortController();
    batchAbortRef.current = ac;
    setBatch({ running: true, index: 0, total: config.games.length, current: config.games[0] || null, results: [], totals: null });

    try {
      const totals = await runBatch({
        games: config.games,
        backend: config.backend,
        providerId, modelId, modelName,
        agentId: config.agentId,
        agentModel: config.agentModel,
        maxTurns: config.maxTurns, skipExisting: config.skipExisting, delayMs: config.delayMs,
        budgets: normalizeBudgets({ ...budgets, maxTurns: config.maxTurns }),
        abortSignal: ac.signal,
        onProgress: (ev) => {
          if (ev.phase === 'start') setBatch(b => ({ ...b, index: ev.index, current: ev.game }));
          else if (ev.phase === 'end') setBatch(b => ({
            ...b,
            results: [...b.results.filter(r => r.title !== ev.game.title), { title: ev.game.title, ...ev.result }],
          }));
        },
      });
      setBatch(b => ({ ...b, running: false, current: null, totals }));
    } catch (error) {
      setBatch(b => ({
        ...b, running: false, current: null,
        totals: { built: 0, failed: config.games.length, skipped: 0, cancelled: 0 },
        results: config.games.map(game => ({ title: game.title, status: 'error', error: error.message })),
      }));
    } finally {
      batchAbortRef.current = null;
    }
  }, [modelId, providerId, allModels, budgets]);

  const openBatch = useCallback(() => {
    setBatch({ running: false, index: 0, total: 0, current: null, results: [], totals: null });
    setShowBatch(true);
  }, []);

  const coachPolicy = { providerId, modelId };

  // One toolbar picker drives both executors: a CLI-agent row switches the
  // backend and records that agent's model, a provider row switches back.
  // One picker for in-app models and CLI agents; also repairs a CLI agent left
  // stored as the in-app provider, which the tool-calling build loop cannot drive.
  const handleExecutorChange = useExecutorSelection({
    backend, providerId, modelId, providerModels: allModels,
    setBackend, setAgentId, setAgentModels, setProviderId, setModelId,
  });

  const handleApiKeySave = useCallback((key) => {
    saveApiKey(key);
    setApiKeySet(hasApiKey());
    setShowApiKey(false);
    // A new key changes which OpenRouter models are reachable.
    loadModels();
  }, [loadModels]);

  return html`
    <${Toolbar}
      theme=${theme} onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      onHelp=${() => setShowHelp(true)}
      models=${allModels} providerId=${providerId} modelId=${modelId}
      backend=${backend} agentId=${agentId} agentModelId=${agentModel}
      onExecutorChange=${handleExecutorChange}
      hasApiKey=${apiKeySet} onApiKeyClick=${() => setShowApiKey(true)}
      modelsLoading=${modelsLoading}
      onProviderSettings=${() => setShowProviderSettings(true)}
      view=${view} onViewChange=${setView}
      directoryName=${rootName} onPickDirectory=${pickDirectory}
      onBatch=${openBatch}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'VR Forge',
        appHandle,
        className: 'gf-btn btn-record-video',
        sourceArtefactId: () => currentRunRef.current?.runId || game?.id || null,
        metadata: () => ({
          route: view,
          view,
          gameId: game?.id || null,
          gameTitle: game?.title || null,
          runId: currentRunRef.current?.runId || null,
          lifecycleStatus,
          backend,
          providerId: providerId || null,
          modelId: modelId || null,
        }),
        onNeedDirectory: pickDirectory,
        onError: error => console.error('[vr-forge recording]', error),
      }}
    />
    <div class="gf-body">
      ${view === 'library' && html`
        <${LibraryView}
          onBuild=${handleBuildFromLibrary}
          models=${allModels}
          providerId=${providerId}
          modelId=${modelId}
          modelsLoading=${modelsLoading}
          onProviderSettings=${() => setShowProviderSettings(true)}
          hasRoot=${hasRoot}
          onConnectRoot=${pickDirectory}
          onOpenRuns=${slug => { setRunsFocus(slug); setView('runs'); }}
        />`}
      ${view === 'build' && html`
        <${BuildView}
          game=${game} running=${running} steps=${steps} telemetry=${telemetry} doneSummary=${doneSummary} buildError=${buildError}
          backend=${backend} agentId=${agentId} agentEvents=${agentEvents} agentLive=${agentLive}
          agentModel=${agentModel}
          onRun=${handleRun} onCancel=${handleCancel} onHeal=${handleHeal} maxTurns=${maxTurns} onMaxTurns=${setMaxTurns}
          activeRunCount=${activeRunCount} onCancelAll=${handleCancelAll}
          pauseState=${pauseState} pauseContext=${pauseContext} canPause=${canPause}
          onPause=${handlePause} onResume=${handleResume}
          imageAssets=${imageAssets} onImageAssets=${setImageAssets}
          projectHandle=${projectHandle} projectDir=${projectDir} previewNonce=${previewNonce}
          onDeviceOpened=${handleDeviceOpened}
          rating=${rating} onRate=${handleRate}
          coachPolicy=${coachPolicy} onOpenSettings=${() => setShowProviderSettings(true)} hasRoot=${hasRoot}
          lifecycleStatus=${lifecycleStatus} stopReason=${stopReason} validation=${validation}
          budgets=${budgets} budgetState=${budgetState}
          iterationRequest=${iterationRequest}
          domainAdapter=${DOMAIN_ADAPTER}
          briefProviderId=${providerId} briefModelId=${modelId}
          briefModelDisplayLabel=${allModels.find(model => model.providerId === providerId && model.modelId === modelId)?.displayLabel}
          onBriefChange=${setGame}
          onSaveBriefVariant=${addUserPrompt}
          onSaveBriefVersion=${value => updateUserPrompt(game.id, value)}
          onBudgets=${next => {
            const saved = saveBudgets(next);
            setBudgets(saved);
            setMaxTurns(saved.maxTurns);
          }} />`}
      ${view === 'runs' && html`<${RunsView} domainAdapter=${DOMAIN_ADAPTER} onIterate=${handlePrepareIteration}
        focusGameSlug=${runsFocus} onFocusHandled=${() => setRunsFocus(null)} />`}
      ${view === 'matrix' && html`<${MatrixView} domainAdapter=${DOMAIN_ADAPTER} onBuild=${handleBuildFromLibrary} />`}
    </div>
    ${showBatch && html`
      <${BatchDialog}
        modelName=${allModels.find(m => m.providerId === providerId && m.modelId === modelId)?.name}
        modelId=${modelId}
        initialBackend=${backend}
        initialAgentId=${agentId}
        initialAgentModel=${agentModel}
        running=${batch.running} index=${batch.index} total=${batch.total}
        current=${batch.current} results=${batch.results} totals=${batch.totals}
        onStart=${handleStartBatch}
        onCancel=${() => batchAbortRef.current?.abort()}
        onClose=${() => setShowBatch(false)} />`}
    ${showApiKey && html`
      <${ApiKeyDialog}
        currentKey=${getApiKey()}
        onSave=${handleApiKeySave}
        onClose=${() => setShowApiKey(false)} />`}
    ${showHelp && html`<${HelpDialog} src="./HELP.md" title="VR Forge — Help" onClose=${() => setShowHelp(false)} />`}
    ${showProviderSettings && html`<${ProviderSettingsDialog} onClose=${() => { setShowProviderSettings(false); loadModels(); }} />`}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
// Spec 340: live phase chip (Starting / Thinking / Writing) for any model call in flight.
mountGenerationStatus();
// Showcase: #/showcase/<id> plays a published run over the app (public site).
mountShowcasePlayer({ appTitle: 'VR Forge' });

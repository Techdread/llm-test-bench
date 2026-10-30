import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { CellList } from './components/CellList.js';
import { VariablesPanel } from './components/VariablesPanel.js';
import { ApiKeyDialog } from './components/ApiKeyDialog.js';
import { RuntimeBackendsDialog } from './components/RuntimeBackendsDialog.js';
import { GenerateDialog } from './components/GenerateDialog.js';
import { GenerateNotebookDialog } from './components/GenerateNotebookDialog.js';
import { NotebookPickerDialog } from './components/NotebookPickerDialog.js';
import { Toast } from './components/Toast.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { useCodingAgentRun } from '../shared/components/CodingAgentRun.js';

import * as modelProviders from '../shared/services/model-providers.js';
import * as openrouter from './services/openrouter.js';
import * as store from './services/notebookStore.js';
import {
  NOTEBOOK_AGENT_OUTPUT_FILE,
  buildNotebookAgentTask,
  buildNotebookRepairAgentTask,
  buildNotebookGenerationAgentTask,
  notebookAgentOutputFile,
} from './services/codingAgent.js';
import * as nbBridge from './services/nbBridge.js';
import { buildAiMetadata, isCellModifiedSinceAi, withAiMetadata, withoutAiMetadata } from './services/cellMetadata.js';
import {
  buildNotebookResearchQuery,
  materializeGeneratedNotebook,
  parseGeneratedNotebook,
} from './services/notebookGeneration.js';
import { search as braveSearch, formatResultsForPrompt } from '../shared/services/brave-search.js';

import { executeCell, runNotebook as executeNotebook } from './services/notebookRuntime.js';
import { buildApiResult, normalizeCommand } from './services/apiProtocol.js';
import { startApiQueue } from './services/apiQueue.js';
import { registerWindowApi } from './services/windowApi.js';
import { buildStandaloneHtml } from './services/htmlExport.js';
import { activeVegaViewCount, finalizeAllVegaViews } from './services/vegaRuntime.js';
import { createRuntimeMonitor, describeNotebookRuntime } from './services/runtimeSessions.js';
import { clearCellOutput, clearNotebookOutputs } from './services/outputState.js';
import { cellRepairDiagnostic, withCellRepairMetadata } from './services/cellRepair.js';
import { getPyodide, isLoading as isPyodideLoading } from '../shared/services/pyodide-runtime.js';
import { isBooted as isDebianBooted } from '../shared/services/debianVm.js';
import { PUBLIC_START_TUTORIAL, isWebEdition } from './services/edition.js';

const THEME_KEY = 'notebook-lab-theme';
const PROVIDER_KEY = 'notebook-lab-provider';
const MODEL_KEY = 'notebook-lab-model';
const BACKEND_KEY = 'notebook-lab-backend';
const AGENT_KEY = 'notebook-lab-agent';
const AGENT_MODELS_KEY = 'notebook-lab-agent-models';
const LAST_NB_KEY = 'notebook-lab-last-notebook-id';
const AUTOSAVE_KEY = 'notebook-lab-autosave';
const APP_ID = 'notebook-lab';
// Set once the user has opened the Library or closed its hint.
const LIBRARY_HINT_KEY = 'notebook-lab-library-hint-dismissed';

// Read before the first render writes an autosave: a visitor arriving with no
// draft in this tab is shown a starting notebook instead of a blank one.
const STARTED_WITH_DRAFT = !!(sessionStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem(AUTOSAVE_KEY));

// `?example=<category>/<file>.json` or `?tutorial=<file>.json` opens a bundled
// notebook (the public write-up links to examples this way).
function bundledNotebookLink(search = window.location.search) {
  const params = new URLSearchParams(search);
  for (const type of ['example', 'tutorial']) {
    const file = params.get(type);
    if (file && /^[\w-]+(?:\/[\w-]+)?\.json$/.test(file)) return { type, file };
  }
  return null;
}

function readTabAutosave() {
  const tabValue = sessionStorage.getItem(AUTOSAVE_KEY);
  if (tabValue) return tabValue;

  // One-time migration from the old shared autosave. The first tab opened
  // after this update claims the draft and its last-opened id; removing the
  // localStorage copies prevents every later tab from cloning that workspace.
  const legacyValue = localStorage.getItem(AUTOSAVE_KEY);
  if (!legacyValue) return null;
  sessionStorage.setItem(AUTOSAVE_KEY, legacyValue);
  const legacyLastId = localStorage.getItem(LAST_NB_KEY);
  if (legacyLastId) sessionStorage.setItem(LAST_NB_KEY, legacyLastId);
  localStorage.removeItem(AUTOSAVE_KEY);
  localStorage.removeItem(LAST_NB_KEY);
  return legacyValue;
}

function defaultSourceForKind(kind) {
  if (kind === 'ui') {
    return JSON.stringify({
      title: 'Controls',
      width: 720,
      height: 160,
      controls: [
        { type: 'text', label: 'Name', bind: 'name', default: '', placeholder: 'Enter value', x: 12, y: 42, width: 220, height: 64 },
        { type: 'slider', label: 'Value', bind: 'value', default: 50, min: 0, max: 100, step: 1, x: 252, y: 42, width: 240, height: 64 },
      ],
    }, null, 2);
  }
  return '';
}

function freshCell(kind = 'md') {
  return {
    id: store.cellId(),
    kind,
    source: defaultSourceForKind(kind),
    outputs: null,
    error: null,
    lastOutputText: '',
  };
}

function statesEqual(a, b) {
  try {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
  } catch {
    return false;
  }
}

// Streamed LLM chunks arrive per-token, and writing each one into state
// re-renders the whole notebook and re-tokenizes the Ace document. On a long
// (or runaway) generation that quadratic churn can hang the tab hard enough
// that Chrome's hang watchdog kills the renderer, so coalesce stream updates
// to at most one per interval.
function makeThrottledUpdater(update, intervalMs = 150) {
  let lastFired = 0;
  let pending = null;
  let timer = null;
  const fire = () => {
    lastFired = Date.now();
    const text = pending;
    pending = null;
    update(text);
  };
  return {
    push(text) {
      pending = text;
      if (timer) return;
      const wait = Math.max(0, intervalMs - (Date.now() - lastFired));
      timer = setTimeout(() => { timer = null; if (pending !== null) fire(); }, wait);
    },
    // Cancel without firing — used when the caller is about to write the
    // final text itself, so a stale timer can't clobber it afterwards.
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    // Fire any pending text immediately — used on error so the partial
    // output that did arrive stays visible.
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending !== null) fire();
    },
  };
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [notebook, setNotebook] = useState(() => {
    // If the page was opened via Export-to-Notebook (`?notebook=<id>`),
    // don't seed from the autosave blob — it would briefly render the
    // previous notebook before the async load effect overrides it, and
    // if the load fails the user is stuck on the wrong notebook.
    const urlId = new URLSearchParams(window.location.search).get('notebook');
    if (urlId || bundledNotebookLink()) return store.blankNotebook('Loading…');
    const saved = readTabAutosave();
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return store.blankNotebook();
  });
  const notebookRef = useRef(notebook);
  const hardResetRef = useRef(null);
  const [runtimeMonitor, setRuntimeMonitor] = useState(null);
  const [runningCellId, setRunningCellId] = useState(null);
  const [fixingCellId, setFixingCellId] = useState(null);
  const [isBusy, setIsBusy] = useState(false);

  // Provider/model
  const [allModels, setAllModels] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(
    () => modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY).provider
  );
  const [selectedModelId, setSelectedModelId] = useState(
    () => modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY).model
  );
  // A local CLI agent is just another executor; `backend` says which one is live.
  const [backend, setBackend] = useState(() => localStorage.getItem(BACKEND_KEY) || 'model');
  const [selectedAgentId, setSelectedAgentId] = useState(() => localStorage.getItem(AGENT_KEY) || 'claude-code');
  const [agentModels, setAgentModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AGENT_MODELS_KEY) || '{}'); } catch { return {}; }
  });
  const agentRun = useCodingAgentRun({ appId: 'notebook-lab' });
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(() => openrouter.hasApiKey());

  // Dialog state
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showRuntimesDialog, setShowRuntimesDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [genDialog, setGenDialog] = useState(null); // { mode, cellId?, initialKind, initialPrompt, title }
  const [genBusy, setGenBusy] = useState(false);
  const [genSearchStatus, setGenSearchStatus] = useState('');
  const [notebookGeneratorOpen, setNotebookGeneratorOpen] = useState(false);
  const [notebookGenBusy, setNotebookGenBusy] = useState(false);
  const [notebookGenStatus, setNotebookGenStatus] = useState(null);
  const [notebookDraft, setNotebookDraft] = useState(null);
  const [nbPickerOpen, setNbPickerOpen] = useState(false);
  const [nbList, setNbList] = useState([]);
  const [tutorials, setTutorials] = useState([]);
  const [examples, setExamples] = useState([]);
  const [exampleCategories, setExampleCategories] = useState([]);
  const [libraryHint, setLibraryHint] = useState(() => !localStorage.getItem(LIBRARY_HINT_KEY));
  const [libraryCounts, setLibraryCounts] = useState(null);
  const [hasDirectory, setHasDirectory] = useState(false);
  const [apiQueueStatus, setApiQueueStatus] = useState({ state: 'disabled', message: 'No data root selected' });
  const [sidePanelTab, setSidePanelTab] = useState('variables');
  const [uiFormSelection, setUiFormSelection] = useState(null); // { cellId, controlIndex }

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const hardResetThisTab = useCallback(({ confirmFirst = true } = {}) => {
    if (confirmFirst && !confirm(
      'Hard reset this Notebook Lab tab?\n\nThis releases its runtime memory and opens a blank notebook. Saved notebook files are not deleted.'
    )) return false;
    finalizeAllVegaViews();
    nbBridge.clear();
    sessionStorage.removeItem(AUTOSAVE_KEY);
    sessionStorage.removeItem(LAST_NB_KEY);
    // These keys used to be shared through localStorage. Remove the obsolete
    // recovery records only during an explicit hard reset.
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(LAST_NB_KEY);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('notebook');
    cleanUrl.hash = '';
    window.location.replace(cleanUrl.href);
    return true;
  }, []);
  hardResetRef.current = hardResetThisTab;

  const hardResetAllTabs = useCallback(() => {
    if (!confirm(
      'Hard reset every open Notebook Lab tab?\n\nEach tab will reload with a blank notebook. Saved notebook files are not deleted.'
    )) return;
    runtimeMonitor?.resetAll();
    hardResetThisTab({ confirmFirst: false });
  }, [runtimeMonitor, hardResetThisTab]);

  const applyNotebook = useCallback((nextNotebook) => {
    const state = nextNotebook.state || {};
    nbBridge.replaceAll(state);
    setNotebook({ ...nextNotebook, state: nbBridge.snapshot() });
  }, []);

  // ── Theme ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ── Init storage handle + data root ──
  // If the URL carries ?notebook=<id>, load it (used by the standing
  // Export-to-Notebook capability — other labs hand off this way). Falls
  // back to this tab's last-opened notebook, then to its autosaved draft.
  useEffect(() => {
    (async () => {
      const urlId = new URLSearchParams(window.location.search).get('notebook');
      const bundled = bundledNotebookLink();
      const start = bundled
        || (!urlId && !STARTED_WITH_DRAFT && isWebEdition() ? { type: 'tutorial', file: PUBLIC_START_TUTORIAL } : null);
      if (start) {
        try {
          applyNotebook(start.type === 'example' ? await store.loadExample(start.file) : await store.loadTutorial(start.file));
        } catch (e) {
          if (bundled) addToast(`Could not open ${bundled.file}: ${e.message}`, 'error');
        }
      }
      const ok = await store.initHandle();
      setHasDirectory(ok);
      if (bundled) return;
      if (!ok) {
        if (urlId) addToast(`Open the data root to load notebook ${urlId}.`, 'error');
        return;
      }
      const targetId = urlId || sessionStorage.getItem(LAST_NB_KEY);
      if (!targetId) return;
      try {
        const nb = await store.loadNotebook(targetId);
        applyNotebook(nb);
        if (urlId) sessionStorage.setItem(LAST_NB_KEY, urlId);
      } catch (e) {
        if (urlId) addToast(`Could not load notebook ${urlId}: ${e.message}`, 'error');
      }
    })();
  }, [applyNotebook, addToast]);

  // ── Load models ──
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
      if (!selectedModelId && models.length > 0) {
        setSelectedProviderId(models[0].providerId);
        setSelectedModelId(models[0].modelId);
      }
    } catch (e) {
      console.warn('Failed to load models:', e);
    } finally {
      setModelsLoading(false);
    }
  }, [selectedModelId]);

  useEffect(() => { loadModels().catch(() => {}); }, []);

  useEffect(() => {
    if (selectedProviderId) localStorage.setItem(PROVIDER_KEY, selectedProviderId);
    if (selectedModelId) localStorage.setItem(MODEL_KEY, selectedModelId);
  }, [selectedProviderId, selectedModelId]);

  useEffect(() => {
    nbBridge.replaceAll(notebookRef.current.state || {});
  }, []);

  useEffect(() => {
    return nbBridge.subscribe((state) => {
      setNotebook(nb => statesEqual(nb.state, state) ? nb : { ...nb, state });
    });
  }, []);

  // ── Per-tab autosave ──
  useEffect(() => {
    try { sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify(notebook)); } catch {}
  }, [notebook]);

  // ── Helpers ──
  const updateCell = useCallback((id, patch) => {
    setNotebook(nb => ({
      ...nb,
      cells: nb.cells.map(c => c.id === id ? { ...c, ...patch } : c),
    }));
  }, []);

  const selectUiControl = useCallback((cellId, controlIndex = 0) => {
    setUiFormSelection({ cellId, controlIndex });
    setSidePanelTab('form');
  }, []);

  const insertCellAt = useCallback((index, kind) => {
    setNotebook(nb => {
      const cells = [...nb.cells];
      cells.splice(index, 0, freshCell(kind));
      return { ...nb, cells };
    });
  }, []);

  const deleteCell = useCallback((id) => {
    setNotebook(nb => ({ ...nb, cells: nb.cells.filter(c => c.id !== id) }));
  }, []);

  const duplicateCell = useCallback((id) => {
    setNotebook(nb => {
      const idx = nb.cells.findIndex(c => c.id === id);
      if (idx < 0) return nb;
      const clone = { ...nb.cells[idx], id: store.cellId(), outputs: null, error: null };
      const cells = [...nb.cells];
      cells.splice(idx + 1, 0, clone);
      return { ...nb, cells };
    });
  }, []);

  const moveCell = useCallback((id, dir) => {
    setNotebook(nb => {
      const idx = nb.cells.findIndex(c => c.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= nb.cells.length) return nb;
      const cells = [...nb.cells];
      [cells[idx], cells[target]] = [cells[target], cells[idx]];
      return { ...nb, cells };
    });
  }, []);

  const clearOutput = useCallback((id) => {
    setNotebook(nb => ({
      ...nb,
      cells: nb.cells.map(cell => cell.id === id ? clearCellOutput(cell) : cell),
    }));
  }, []);

  const clearAllOutputs = useCallback(() => {
    setNotebook(clearNotebookOutputs);
    addToast('All cell outputs cleared', 'info');
  }, [addToast]);

  useEffect(() => {
    if (!uiFormSelection) return;
    const cell = notebook.cells.find(c => c.id === uiFormSelection.cellId);
    if (!cell || cell.kind !== 'ui') {
      setUiFormSelection(null);
      if (sidePanelTab === 'form') setSidePanelTab('variables');
    }
  }, [notebook.cells, sidePanelTab, uiFormSelection]);

  // Keep a ref to the latest notebook so async handlers and the cross-tab
  // runtime inventory don't read stale state.
  useEffect(() => { notebookRef.current = notebook; }, [notebook]);

  useEffect(() => {
    const monitor = createRuntimeMonitor({
      getSnapshot: () => describeNotebookRuntime({
        notebook: notebookRef.current,
        state: nbBridge.snapshot(),
        heapBytes: globalThis.performance?.memory?.usedJSHeapSize ?? null,
        runtimes: {
          pyodide: getPyodide() ? 'ready' : (isPyodideLoading() ? 'loading' : 'cold'),
          debian: isDebianBooted() ? 'active' : 'cold',
          vegaViews: activeVegaViewCount(),
        },
      }),
      onReset: () => hardResetRef.current?.({ confirmFirst: false }),
    });
    setRuntimeMonitor(monitor);
    return () => monitor.dispose();
  }, []);

  // ── Run a single cell ──
  const runCell = useCallback(async (id) => {
    const cell = notebookRef.current.cells.find(c => c.id === id);
    if (!cell) return;
    setRunningCellId(id);
    updateCell(id, { outputCleared: false });
    try {
      const result = await executeCell(cell, { onStatus: (status) => addToast(status, 'info') });
      updateCell(id, result);
    } catch (err) {
      updateCell(id, { outputs: null, error: err.message || String(err), lastOutputText: 'Error: ' + err.message, outputCleared: false });
    } finally {
      setRunningCellId(null);
    }
  }, [addToast, updateCell]);

  const runAll = useCallback(async () => {
    setIsBusy(true);
    try {
      const startNotebook = notebookRef.current;
      const { notebook: ranNotebook } = await executeNotebook(startNotebook, {
        onStatus: (status) => addToast(status, 'info'),
        onCellStart: (cell) => setRunningCellId(cell.id),
        onCellResult: (cell) => {
          setNotebook(nb => ({
            ...nb,
            cells: nb.cells.map(c => c.id === cell.id ? cell : c),
          }));
        },
      });
      applyNotebook(ranNotebook);
      addToast('All cells run', 'success');
    } finally {
      setRunningCellId(null);
      setIsBusy(false);
    }
  }, [addToast, applyNotebook]);

  // ── LLM ──
  const handleModelChange = useCallback((p, m) => {
    setSelectedProviderId(p);
    setSelectedModelId(m);
  }, []);

  const handleExecutorChange = useCallback((selection) => {
    if (selection.backend === 'agent') {
      const nextAgentModels = { ...agentModels, [selection.agentId]: selection.modelId || '' };
      setBackend('agent');
      setSelectedAgentId(selection.agentId);
      setAgentModels(nextAgentModels);
      localStorage.setItem(BACKEND_KEY, 'agent');
      localStorage.setItem(AGENT_KEY, selection.agentId);
      localStorage.setItem(AGENT_MODELS_KEY, JSON.stringify(nextAgentModels));
      return;
    }
    setBackend('model');
    localStorage.setItem(BACKEND_KEY, 'model');
    handleModelChange(selection.providerId, selection.modelId);
  }, [agentModels, handleModelChange]);

  const handleApiKeySave = useCallback((key) => {
    openrouter.saveApiKey(key);
    setApiKeySet(!!key);
    setShowApiKeyDialog(false);
    addToast(key ? 'API key saved' : 'API key removed', key ? 'success' : 'info');
    loadModels();
  }, [addToast, loadModels]);

  const handleProvidersChanged = useCallback(() => {
    setApiKeySet(openrouter.hasApiKey());
    loadModels();
  }, [loadModels]);

  const contextCellsFor = useCallback((cellId) => {
    const idx = notebook.cells.findIndex(c => c.id === cellId);
    const upto = idx >= 0 ? notebook.cells.slice(0, idx) : notebook.cells;
    return upto.filter(c => c.source);
  }, [notebook.cells]);

  const openGenDialogNew = useCallback((insertIndex) => {
    // AgentRunTrace is shared by the generation surfaces. Do not leak the
    // completed transcript from a previous cell/notebook/fix run into a newly
    // opened cell dialog.
    if (!agentRun.running) agentRun.reset();
    setGenDialog({ mode: 'new', insertIndex, initialKind: 'py', initialPrompt: '', title: 'Generate new cell' });
  }, [agentRun]);

  const openGenDialogForCell = useCallback((cellId) => {
    const cell = notebook.cells.find(c => c.id === cellId);
    if (!cell) return;
    if (!agentRun.running) agentRun.reset();
    const ai = cell.metadata?.ai || null;
    setGenDialog({
      mode: 'replace',
      cellId,
      initialKind: ai?.kind || cell.kind,
      initialPrompt: ai?.prompt || '',
      initialUseWebSearch: !!ai?.useWebSearch,
      hasSavedPrompt: !!ai?.prompt,
      isModified: isCellModifiedSinceAi(cell),
      codeKind: String(cell.source || '').trim() ? cell.kind : '',
      title: ai?.prompt ? `Regenerate cell [${cell.kind}]` : `Generate into cell [${cell.kind}]`,
    });
  }, [notebook.cells, agentRun]);

  const handleGenerate = useCallback(async ({ kind, prompt, useWebSearch, target = 'replace' }) => {
    if (backend === 'agent') {
      if (!store.hasDirectory()) {
        try {
          setHasDirectory(await store.pickDirectory());
        } catch (error) {
          addToast(error.message || 'Connect a data root to run a CLI agent', 'error');
          return;
        }
      }
    } else {
      if (!selectedProviderId || !selectedModelId) { addToast('Select a model first', 'error'); return; }
      if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
        setShowApiKeyDialog(true);
        return;
      }
    }
    setGenBusy(true);
    setGenSearchStatus('');
    let streamUpdater = null;
    try {
      let searchContext = '';
      if (useWebSearch) {
        setGenSearchStatus('searching');
        try {
          const results = await braveSearch(prompt, 5);
          searchContext = formatResultsForPrompt(results);
          setGenSearchStatus(results.length > 0 ? `Found ${results.length} results` : 'No results');
        } catch (e) {
          setGenSearchStatus('Search failed');
          console.warn('Brave search failed:', e);
        }
      }

      let targetId;
      let ctxCells;
      let previousAi = null;
      // A prompt aimed at an existing cell edits its code rather than starting
      // blank, as long as it stays the same kind of cell.
      const sourceCell = genDialog.mode === 'new' ? null : notebook.cells.find(c => c.id === genDialog.cellId);
      const currentSource = sourceCell && sourceCell.kind === kind ? sourceCell.source || '' : '';
      if (genDialog.mode === 'new' || target === 'copy') {
        const newCell = { ...freshCell(kind), source: '' };
        targetId = newCell.id;
        const insertIndex = genDialog.mode === 'new'
          ? genDialog.insertIndex
          : notebook.cells.findIndex(c => c.id === genDialog.cellId) + 1;
        setNotebook(nb => {
          const cells = [...nb.cells];
          cells.splice(insertIndex, 0, newCell);
          return { ...nb, cells };
        });
        const contextIndex = genDialog.mode === 'new' ? genDialog.insertIndex : insertIndex - 1;
        ctxCells = notebook.cells.slice(0, contextIndex).filter(c => c.source);
      } else {
        targetId = genDialog.cellId;
        const existing = notebook.cells.find(c => c.id === targetId);
        previousAi = existing?.metadata?.ai || null;
        ctxCells = contextCellsFor(targetId);
        updateCell(targetId, { kind, source: '', outputs: null, error: null });
      }

      let finalSource;
      let aiMetadata;

      if (backend === 'agent') {
        const completed = await agentRun.start({
          agentId: selectedAgentId,
          modelId: agentModels[selectedAgentId] || '',
          task: buildNotebookAgentTask({ kind, prompt, contextCells: ctxCells, variables: nbBridge.snapshot(), searchContext, currentSource }),
          outputFile: notebookAgentOutputFile(kind),
          onOutput: (content) => updateCell(targetId, {
            kind, source: openrouter.stripFences(content), outputs: null, error: null,
          }),
        });
        finalSource = openrouter.stripFences(completed.content);
        aiMetadata = {
          ...buildAiMetadata({
            prompt,
            kind,
            providerId: `cli-agent:${completed.agent}`,
            modelId: completed.model || completed.agent,
            useWebSearch,
            source: finalSource,
            previous: previousAi,
          }),
          backend: 'cli-agent',
          agentId: completed.agent,
          agentRunId: completed.runId,
        };
      } else {
        streamUpdater = makeThrottledUpdater((text) => updateCell(targetId, { source: text }));
        finalSource = await openrouter.generateCell({
          kind,
          prompt,
          contextCells: ctxCells,
          variables: nbBridge.snapshot(),
          currentSource,
          providerId: selectedProviderId,
          modelId: selectedModelId,
          searchContext,
          onChunk: (partial) => streamUpdater.push(partial),
        });
        streamUpdater.cancel();
        aiMetadata = buildAiMetadata({
          prompt,
          kind,
          providerId: selectedProviderId,
          modelId: selectedModelId,
          useWebSearch,
          source: finalSource,
          previous: previousAi,
        });
      }
      setNotebook(nb => ({
        ...nb,
        cells: nb.cells.map(c => c.id === targetId
          ? { ...c, kind, source: finalSource, outputs: null, error: null, metadata: withAiMetadata(c, aiMetadata) }
          : c),
      }));
      addToast('Cell generated', 'success');
      setGenDialog(null);
      setGenSearchStatus('');
    } catch (e) {
      streamUpdater?.flush();
      if (!agentRun.wasCancelled()) addToast('Generation failed: ' + e.message, 'error');
    } finally {
      setGenBusy(false);
    }
  }, [genDialog, backend, selectedProviderId, selectedModelId, selectedAgentId, agentModels, agentRun,
      notebook.cells, contextCellsFor, updateCell, addToast]);

  // Replace a failing cell with a diagnostic-aware repair from the currently
  // selected executor. We deliberately do not auto-run the replacement: cells
  // may have side effects, so the user keeps control of verification.
  const handleFixCell = useCallback(async (cellId) => {
    const cell = notebookRef.current.cells.find(c => c.id === cellId);
    const diagnostic = cellRepairDiagnostic(cell);
    if (!diagnostic) {
      addToast('Run the cell first so AI Fix has an error to diagnose', 'info');
      return;
    }
    if (fixingCellId || agentRun.running) {
      addToast('Another AI task is already running', 'info');
      return;
    }

    if (backend === 'agent') {
      if (!store.hasDirectory()) {
        try {
          setHasDirectory(await store.pickDirectory());
        } catch (error) {
          addToast(error.message || 'Connect a data root to run a CLI agent', 'error');
          return;
        }
      }
    } else {
      if (!selectedProviderId || !selectedModelId) {
        addToast('Select a model first', 'error');
        return;
      }
      if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
        setShowApiKeyDialog(true);
        return;
      }
    }

    const contextCells = (() => {
      const cells = notebookRef.current.cells;
      const index = cells.findIndex(c => c.id === cellId);
      return cells.slice(0, Math.max(0, index)).filter(c => c.source);
    })();
    const repairCell = { ...cell, error: diagnostic };
    const originalError = diagnostic;
    setFixingCellId(cellId);

    try {
      let finalSource;
      let repairIdentity;

      if (backend === 'agent') {
        const completed = await agentRun.start({
          agentId: selectedAgentId,
          modelId: agentModels[selectedAgentId] || '',
          task: buildNotebookRepairAgentTask({ cell: repairCell, contextCells, variables: nbBridge.snapshot() }),
          outputFile: notebookAgentOutputFile(cell.kind),
        });
        finalSource = openrouter.stripFences(completed.content);
        repairIdentity = {
          providerId: `cli-agent:${completed.agent}`,
          modelId: completed.model || completed.agent,
          agentRunId: completed.runId,
        };
      } else {
        finalSource = await openrouter.repairCell({
          cell: repairCell,
          contextCells,
          variables: nbBridge.snapshot(),
          providerId: selectedProviderId,
          modelId: selectedModelId,
        });
        repairIdentity = { providerId: selectedProviderId, modelId: selectedModelId };
      }

      if (!finalSource?.trim()) throw new Error('The selected AI returned an empty repair');
      updateCell(cellId, {
        source: finalSource,
        outputs: null,
        error: null,
        lastOutputText: '',
        outputCleared: false,
        metadata: withCellRepairMetadata(cell, {
          ...repairIdentity,
          source: finalSource,
          error: originalError,
        }),
      });
      addToast('AI fix applied — run the cell to verify it', 'success');
    } catch (error) {
      if (!agentRun.wasCancelled()) addToast(`AI fix failed: ${error.message}`, 'error');
    } finally {
      setFixingCellId(null);
    }
  }, [backend, selectedProviderId, selectedModelId, selectedAgentId, agentModels,
      agentRun, fixingCellId, addToast, updateCell]);

  const handleGenerateNotebook = useCallback(async ({
    prompt,
    mode,
    useWebSearch,
    languages = [],
    visualOutput = 'auto',
  }) => {
    if (backend === 'agent') {
      if (!store.hasDirectory()) {
        try {
          setHasDirectory(await store.pickDirectory());
        } catch (error) {
          addToast(error.message || 'Connect a data root to run a CLI agent', 'error');
          return;
        }
      }
    } else {
      if (!selectedProviderId || !selectedModelId) {
        addToast('Select a model first', 'error');
        return;
      }
      if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
        setShowApiKeyDialog(true);
        return;
      }
    }

    setNotebookGenBusy(true);
    setNotebookDraft(null);
    setNotebookGenStatus({ stage: useWebSearch ? 'research' : 'generating', message: useWebSearch ? 'Searching for current sources…' : 'Planning the notebook…', chars: 0 });
    try {
      let searchContext = '';
      let researchResults = [];
      let researchRetrievedAt = '';
      if (useWebSearch) {
        researchResults = await braveSearch(buildNotebookResearchQuery(prompt), 8);
        if (!researchResults.length) throw new Error('Web search returned no sources. Refine the prompt or generate without web search.');
        researchRetrievedAt = new Date().toISOString();
        searchContext = `Research retrieved at ${researchRetrievedAt}.\n\n${formatResultsForPrompt(researchResults)}`;
        setNotebookGenStatus({ stage: 'generating', message: `Found ${researchResults.length} sources. Generating a connected cell plan…`, chars: 0 });
      }

      const currentNotebook = notebookRef.current;
      let draft;
      let provenance;
      if (backend === 'agent') {
        const completed = await agentRun.start({
          agentId: selectedAgentId,
          modelId: agentModels[selectedAgentId] || '',
          task: buildNotebookGenerationAgentTask({
            prompt, mode, currentNotebook, searchContext, languages, visualOutput, variables: nbBridge.snapshot(),
          }),
          outputFile: NOTEBOOK_AGENT_OUTPUT_FILE,
          onOutput: content => setNotebookGenStatus({
            stage: 'generating',
            message: 'Agent is writing and validating notebook.json…',
            chars: content.length,
          }),
        });
        setNotebookGenStatus({ stage: 'validating', message: 'Validating the generated cells…', chars: completed.content.length });
        draft = parseGeneratedNotebook(completed.content, { languages, visualOutput });
        provenance = {
          providerId: `cli-agent:${completed.agent}`,
          modelId: completed.model || completed.agent,
          backend: 'cli-agent',
          runId: completed.runId,
          researchSources: researchResults.map(result => ({ ...result, retrievedAt: researchRetrievedAt })),
        };
      } else {
        draft = await openrouter.generateNotebookDraft({
          prompt,
          mode,
          currentNotebook,
          providerId: selectedProviderId,
          modelId: selectedModelId,
          searchContext,
          languages,
          visualOutput,
          variables: nbBridge.snapshot(),
          onChunk: partial => setNotebookGenStatus({
            stage: 'generating',
            message: 'Streaming the multi-cell notebook…',
            chars: partial.length,
          }),
        });
        provenance = {
          providerId: selectedProviderId,
          modelId: selectedModelId,
          backend: 'model',
          runId: '',
          researchSources: researchResults.map(result => ({ ...result, retrievedAt: researchRetrievedAt })),
        };
      }

      if (useWebSearch && !draft.sources.length) {
        draft = { ...draft, warnings: [...draft.warnings, 'Web research was supplied, but the model omitted the structured source list. Review all citations.'] };
      } else if (useWebSearch) {
        const suppliedUrls = new Set(researchResults.map(result => result.url.replace(/\/$/, '')));
        const unmatched = draft.sources.filter(source => !suppliedUrls.has(source.url.replace(/\/$/, '')));
        if (unmatched.length) {
          draft = {
            ...draft,
            warnings: [...draft.warnings, `${unmatched.length} source ${unmatched.length === 1 ? 'URL was' : 'URLs were'} not present in the supplied web results; verify before relying on them.`],
          };
        }
      }
      setNotebookDraft({
        draft,
        request: { prompt, mode, useWebSearch, languages: [...languages], visualOutput },
        provenance,
      });
      setNotebookGenStatus({
        stage: 'ready',
        message: `Validated ${draft.cells.length} cells across ${new Set(draft.cells.map(cell => cell.kind)).size} cell types.`,
        chars: 0,
      });
    } catch (error) {
      if (!agentRun.wasCancelled()) {
        const message = error.message || String(error);
        setNotebookGenStatus({ stage: 'error', message, chars: 0 });
        addToast(`Notebook generation failed: ${message}`, 'error');
      }
    } finally {
      setNotebookGenBusy(false);
    }
  }, [backend, selectedProviderId, selectedModelId, selectedAgentId, agentModels, agentRun, addToast]);

  const handleApplyGeneratedNotebook = useCallback(() => {
    if (!notebookDraft) return;
    const { draft, request, provenance } = notebookDraft;
    try {
      const nextNotebook = materializeGeneratedNotebook(draft, {
        mode: request.mode,
        currentNotebook: notebookRef.current,
        notebookId: store.newNotebookId,
        cellId: store.cellId,
        prompt: request.prompt,
        providerId: provenance.providerId,
        modelId: provenance.modelId,
        backend: provenance.backend,
        runId: provenance.runId,
        researchSources: provenance.researchSources,
        useWebSearch: request.useWebSearch,
        languages: request.languages,
        visualOutput: request.visualOutput,
      });
      applyNotebook(nextNotebook);
      if (request.mode === 'create') sessionStorage.removeItem(LAST_NB_KEY);
      setNotebookGeneratorOpen(false);
      setNotebookDraft(null);
      setNotebookGenStatus(null);
      addToast(request.mode === 'append' ? `${draft.cells.length} generated cells appended` : 'Generated notebook opened — Save to keep it', 'success');
    } catch (error) {
      addToast(`Could not apply notebook: ${error.message}`, 'error');
    }
  }, [notebookDraft, applyNotebook, addToast]);

  const discardNotebookDraft = useCallback(() => {
    setNotebookDraft(null);
    setNotebookGenStatus(null);
  }, []);

  const handleClearAiMetadata = useCallback(() => {
    if (!genDialog?.cellId) return;
    const cell = notebook.cells.find(c => c.id === genDialog.cellId);
    if (!cell) return;
    updateCell(cell.id, { metadata: withoutAiMetadata(cell) });
    setGenDialog(null);
    addToast('Saved prompt removed', 'info');
  }, [genDialog, notebook.cells, updateCell, addToast]);

  const handleExplain = useCallback(async (cellId) => {
    const cell = notebook.cells.find(c => c.id === cellId);
    if (!cell) return;
    if (!selectedProviderId || !selectedModelId) { addToast('Select a model first', 'error'); return; }
    if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) { setShowApiKeyDialog(true); return; }
    const idx = notebook.cells.findIndex(c => c.id === cellId);
    const newCell = { ...freshCell('md'), source: '' };
    setNotebook(nb => {
      const cells = [...nb.cells];
      cells.splice(idx + 1, 0, newCell);
      return { ...nb, cells };
    });
    const streamUpdater = makeThrottledUpdater((text) => updateCell(newCell.id, { source: text }));
    try {
      const finalText = await openrouter.explainCell({
        cell,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => streamUpdater.push(partial),
      });
      streamUpdater.cancel();
      updateCell(newCell.id, { source: finalText });
    } catch (e) {
      streamUpdater.flush();
      addToast('Explain failed: ' + e.message, 'error');
    }
  }, [notebook.cells, selectedProviderId, selectedModelId, addToast, updateCell]);

  // ── Save / Open ──
  const saveNotebookToDisk = useCallback(async (notebookToSave, { promptForRoot = false } = {}) => {
    if (!store.hasDirectory()) {
      if (!promptForRoot) throw new Error('No data root selected');
      const ok = await store.pickDirectory();
      setHasDirectory(ok);
    }
    const saved = await store.saveNotebook({ ...notebookToSave, state: nbBridge.snapshot() });
    setNotebook(saved);
    sessionStorage.setItem(LAST_NB_KEY, saved.id);
    return saved;
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await saveNotebookToDisk(notebook, { promptForRoot: true });
      addToast('Notebook saved', 'success');
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [notebook, saveNotebookToDisk, addToast]);

  const refreshList = useCallback(async () => {
    const list = await store.listNotebooks();
    setNbList(list);
  }, []);

  const dismissLibraryHint = useCallback(() => {
    localStorage.setItem(LIBRARY_HINT_KEY, '1');
    setLibraryHint(false);
  }, []);

  // The hint quotes real counts: the public build drops notebooks this
  // edition cannot run, so the shipped indexes are the source of truth.
  useEffect(() => {
    if (!libraryHint) return;
    Promise.all([store.listTutorials(), store.listExamples()])
      .then(([tutorialEntries, exampleEntries]) => setLibraryCounts({
        tutorials: tutorialEntries.length,
        examples: exampleEntries.length,
      }))
      .catch(() => {});
  }, [libraryHint]);

  const handleOpenDialog = useCallback(async () => {
    if (libraryHint) dismissLibraryHint();
    if (!hasDirectory) {
      const ok = await store.initHandle();
      setHasDirectory(ok);
    }
    await refreshList();
    const [tutorialEntries, exampleEntries, categoryEntries] = await Promise.all([
      store.listTutorials().catch(() => []),
      store.listExamples().catch(() => []),
      store.listExampleCategories().catch(() => []),
    ]);
    setTutorials(tutorialEntries);
    setExamples(exampleEntries);
    setExampleCategories(categoryEntries);
    setNbPickerOpen(true);
  }, [hasDirectory, refreshList, libraryHint, dismissLibraryHint]);

  const handleOpenTutorial = useCallback(async (file) => {
    try {
      const nb = await store.loadTutorial(file);
      applyNotebook(nb);
      sessionStorage.removeItem(LAST_NB_KEY);
      setNbPickerOpen(false);
      addToast('Tutorial loaded — Save to keep your edits', 'success');
    } catch (e) {
      addToast('Tutorial load failed: ' + e.message, 'error');
    }
  }, [addToast, applyNotebook]);

  const handleOpenExample = useCallback(async (file) => {
    try {
      const nb = await store.loadExample(file);
      applyNotebook(nb);
      sessionStorage.removeItem(LAST_NB_KEY);
      setNbPickerOpen(false);
      addToast('Example loaded — Save to keep your edits', 'success');
    } catch (e) {
      addToast('Example load failed: ' + e.message, 'error');
    }
  }, [addToast, applyNotebook]);

  const handleLoadNotebook = useCallback(async (id) => {
    try {
      const nb = await store.loadNotebook(id);
      applyNotebook(nb);
      sessionStorage.setItem(LAST_NB_KEY, id);
      setNbPickerOpen(false);
      addToast('Notebook loaded', 'success');
    } catch (e) {
      addToast('Load failed: ' + e.message, 'error');
    }
  }, [addToast, applyNotebook]);

  const handleNewNotebook = useCallback(() => {
    applyNotebook(store.blankNotebook());
    sessionStorage.removeItem(LAST_NB_KEY);
    setNbPickerOpen(false);
  }, [applyNotebook]);

  const handleDeleteNotebook = useCallback(async (id, title) => {
    if (!confirm(`Delete notebook "${title || id}"?`)) return;
    try {
      await store.deleteNotebook(id);
      await refreshList();
      addToast('Notebook deleted', 'info');
    } catch (e) {
      addToast('Delete failed: ' + e.message, 'error');
    }
  }, [refreshList, addToast]);

  const handlePickDirectory = useCallback(async () => {
    try {
      await store.pickDirectory();
      setHasDirectory(true);
      await refreshList();
    } catch (e) {
      addToast('Failed to set data root: ' + e.message, 'error');
    }
  }, [refreshList, addToast]);

  // ── External API ──
  const handleApiCommand = useCallback(async (rawCommand) => {
    const command = rawCommand && rawCommand.action ? rawCommand : normalizeCommand(rawCommand);
    let workingNotebook = command.notebook || notebookRef.current;

    if (command.action === 'loadNotebook') {
      applyNotebook(workingNotebook);
      return buildApiResult(command, null, workingNotebook, null);
    }

    if (command.action === 'saveNotebook') {
      const saved = await saveNotebookToDisk(workingNotebook, { promptForRoot: false });
      return buildApiResult(command, null, workingNotebook, saved);
    }

    applyNotebook(workingNotebook);
    const { notebook: ranNotebook, manifest } = await executeNotebook(workingNotebook, {
      timeoutMs: command.run.timeoutMs,
      clearNbBeforeRun: command.run.clearNbBeforeRun,
      stopOnError: command.run.stopOnError,
      cellIds: command.run.cellIds,
      onStatus: (status) => addToast(status, 'info'),
      onCellStart: (cell) => setRunningCellId(cell.id),
      onCellResult: (cell) => {
        setNotebook(nb => {
          const base = nb.id === workingNotebook.id ? nb : workingNotebook;
          return {
            ...base,
            cells: base.cells.map(c => c.id === cell.id ? cell : c),
          };
        });
      },
    });
    setRunningCellId(null);
    applyNotebook(ranNotebook);

    let saved = null;
    if (command.action === 'runAndSave' && command.save.persistNotebook) {
      saved = await saveNotebookToDisk(ranNotebook, { promptForRoot: false });
    }

    return buildApiResult(command, manifest, ranNotebook, saved);
  }, [addToast, saveNotebookToDisk, applyNotebook]);

  const commandFromPayload = useCallback((payload, action) => {
    if (payload && payload.action) return normalizeCommand(payload);
    return normalizeCommand({
      action,
      requestId: payload?.requestId,
      notebook: payload?.notebook || (payload?.cells ? payload : null),
      run: payload?.run,
      save: payload?.save,
    });
  }, []);

  useEffect(() => {
    return registerWindowApi({
      getCurrentNotebook: () => notebookRef.current,
      loadNotebook: (payload) => handleApiCommand(commandFromPayload(payload, 'loadNotebook')),
      runNotebook: (payload) => handleApiCommand(commandFromPayload(payload, 'runNotebook')),
      saveNotebook: (payload = {}) => handleApiCommand(commandFromPayload(payload, 'saveNotebook')),
      runAndSave: (payload) => handleApiCommand(commandFromPayload(payload, 'runAndSave')),
    });
  }, [handleApiCommand, commandFromPayload]);

  useEffect(() => {
    // The file-drop API is for local automation; a website visitor has none.
    if (isWebEdition()) return undefined;
    return startApiQueue({
      onCommand: handleApiCommand,
      onStatus: setApiQueueStatus,
    });
  }, [handleApiCommand, hasDirectory]);

  // ── Export standalone HTML ──
  const handleExportHtml = useCallback(async () => {
    try {
      const htmlDoc = await buildStandaloneHtml({ ...notebook, state: nbBridge.snapshot() }, { theme });
      const blob = new Blob([htmlDoc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${notebook.title || notebook.id || 'notebook'}.html`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('HTML exported', 'success');
    } catch (e) {
      addToast(`Export failed: ${e.message}`, 'error');
    }
  }, [notebook, theme, addToast]);

  const selectedUiCell = uiFormSelection
    ? notebook.cells.find(c => c.id === uiFormSelection.cellId && c.kind === 'ui') || null
    : null;

  return html`
    <${Toolbar}
      theme=${theme}
      onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      title=${notebook.title || ''}
      onTitleChange=${(v) => setNotebook(nb => ({ ...nb, title: v }))}
      allModels=${allModels}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      backend=${backend}
      agentId=${selectedAgentId}
      agentModelId=${agentModels[selectedAgentId] || ''}
      onExecutorChange=${handleExecutorChange}
      modelsLoading=${modelsLoading}
      hasApiKey=${apiKeySet}
      onApiKeyClick=${() => setShowApiKeyDialog(true)}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onGenerateNotebook=${() => {
        if (!agentRun.running) agentRun.reset();
        setNotebookDraft(null);
        setNotebookGenStatus(null);
        setNotebookGeneratorOpen(true);
      }}
      onRunAll=${runAll}
      onClearAll=${clearAllOutputs}
      onNew=${handleNewNotebook}
      onOpen=${handleOpenDialog}
      onSave=${handleSave}
      onExportHtml=${handleExportHtml}
      onRuntimesClick=${() => setShowRuntimesDialog(true)}
      onHelpClick=${() => setShowHelp(true)}
      apiQueueStatus=${apiQueueStatus}
      isBusy=${isBusy || notebookGenBusy || !!fixingCellId}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'Notebook Lab',
        appHandle: store.getAppHandle(),
        sourceArtefactId: () => notebookRef.current?.id || null,
        metadata: () => ({
          route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          notebookId: notebookRef.current?.id || null,
          notebookTitle: notebookRef.current?.title || null,
          cellCount: notebookRef.current?.cells?.length || 0,
          cellKinds: [...new Set((notebookRef.current?.cells || []).map(cell => cell.kind))],
          runningCellId,
        }),
        onNeedDirectory: handlePickDirectory,
        onSaved: result => addToast(`Recording saved: ${result.path}`, 'success'),
        onDownloaded: ({ filename }) => addToast(`Downloaded ${filename}`, 'success'),
        onError: error => addToast(`Recording failed: ${error.message}`, 'error'),
      }}
    />
    <div class="notebook-layout">
      <div class="notebook-main">
        ${libraryHint && html`
          <div class="library-hint" role="note">
            <i class="fa-solid fa-book-open library-hint-icon"></i>
            <div class="library-hint-text">
              <strong>There's a whole library to explore.</strong>
              <span>
                ${libraryCounts
                  ? `${libraryCounts.tutorials} tutorials and ${libraryCounts.examples} example notebooks: `
                  : 'Tutorials and example notebooks: '}
                games, simulations, 3D, data structures, live data and interactive controls. Open one, run it, change it.
              </span>
            </div>
            <button class="btn btn-library" onClick=${handleOpenDialog}>
              <i class="fa-solid fa-book-open"></i> Browse the library
            </button>
            <button class="btn-icon" onClick=${dismissLibraryHint} title="Hide this tip (the Library button stays in the toolbar)" aria-label="Hide library tip">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `}
        <${CellList}
          cells=${notebook.cells}
          runningCellId=${runningCellId}
          fixingCellId=${fixingCellId}
          theme=${theme}
          onInsertAt=${insertCellAt}
          onUpdateCell=${updateCell}
          onRunCell=${runCell}
          onDeleteCell=${deleteCell}
          onDuplicateCell=${duplicateCell}
          onMoveCell=${moveCell}
          onClearOutput=${clearOutput}
          onExplainCell=${handleExplain}
          onAiGenerate=${openGenDialogForCell}
          onAiFix=${handleFixCell}
          uiFormSelection=${uiFormSelection}
          onSelectUiControl=${selectUiControl}
        />
        <div style="display:flex; justify-content:center; margin-top:16px;">
          <button class="btn btn-primary" onClick=${() => openGenDialogNew(notebook.cells.length)}>
            <i class="fa-solid fa-wand-magic-sparkles"></i> AI Generate New Cell
          </button>
        </div>
      </div>
      <${VariablesPanel}
        activeTab=${sidePanelTab}
        onTabChange=${setSidePanelTab}
        uiCell=${selectedUiCell}
        uiControlIndex=${uiFormSelection?.controlIndex || 0}
        onUpdateCell=${updateCell}
        onSelectUiControl=${(controlIndex) => {
          if (selectedUiCell) selectUiControl(selectedUiCell.id, controlIndex);
        }}
      />
    </div>

    ${showApiKeyDialog && html`
      <${ApiKeyDialog}
        currentKey=${openrouter.getApiKey()}
        onSave=${handleApiKeySave}
        onClose=${() => setShowApiKeyDialog(false)}
      />
    `}
    ${showRuntimesDialog && html`
      <${RuntimeBackendsDialog}
        monitor=${runtimeMonitor}
        onHardReset=${hardResetThisTab}
        onHardResetAll=${hardResetAllTabs}
        onClose=${() => setShowRuntimesDialog(false)}
      />
    `}
    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${handleProvidersChanged}
      />
    `}
    ${genDialog && html`
      <${GenerateDialog}
        initialKind=${genDialog.initialKind}
        initialPrompt=${genDialog.initialPrompt}
        initialUseWebSearch=${genDialog.initialUseWebSearch}
        title=${genDialog.title}
        hasSavedPrompt=${genDialog.hasSavedPrompt}
        isModified=${genDialog.isModified}
        codeKind=${genDialog.codeKind}
        onClose=${() => !genBusy && (setGenDialog(null), setGenSearchStatus(''))}
        onGenerate=${handleGenerate}
        onClearMetadata=${handleClearAiMetadata}
        busy=${genBusy}
        searchStatus=${genSearchStatus}
        isAgent=${backend === 'agent'}
        agentRun=${agentRun}
      />
    `}
    ${notebookGeneratorOpen && html`
      <${GenerateNotebookDialog}
        currentTitle=${notebook.title}
        busy=${notebookGenBusy}
        status=${notebookGenStatus}
        draft=${notebookDraft?.draft || null}
        isAgent=${backend === 'agent'}
        agentRun=${agentRun}
        onGenerate=${handleGenerateNotebook}
        onApply=${handleApplyGeneratedNotebook}
        onDiscardDraft=${discardNotebookDraft}
        onClose=${() => {
          if (notebookGenBusy) return;
          setNotebookGeneratorOpen(false);
          setNotebookDraft(null);
          setNotebookGenStatus(null);
        }}
      />
    `}
    ${nbPickerOpen && html`
      <${NotebookPickerDialog}
        list=${nbList}
        tutorials=${tutorials}
        examples=${examples}
        categories=${exampleCategories}
        onOpenExample=${handleOpenExample}
        onOpen=${handleLoadNotebook}
        onOpenTutorial=${handleOpenTutorial}
        onNew=${handleNewNotebook}
        onDelete=${handleDeleteNotebook}
        onClose=${() => setNbPickerOpen(false)}
        hasDirectory=${hasDirectory}
        onPickDirectory=${handlePickDirectory}
      />
    `}
    ${showHelp && html`
      <${HelpDialog}
        src=${isWebEdition() ? './HELP.web.md' : './HELP.md'}
        deckSrc=${isWebEdition() ? null : undefined}
        title="Notebook Lab — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

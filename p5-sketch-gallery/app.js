import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { PromptComposer } from './components/PromptComposer.js';
import { SketchEditor } from './components/SketchEditor.js';
import { CanvasPreview } from './components/CanvasPreview.js';
import { ParameterPanel } from './components/ParameterPanel.js';
import { GalleryGrid } from './components/GalleryGrid.js';
import { CompareView } from './components/CompareView.js';
import { PromptLibraryView } from './components/PromptLibraryView.js';
import { LineageTrail } from './components/LineageTrail.js';
import { ApiKeyDialog } from './components/ApiKeyDialog.js';
import { SaveDialog } from './components/SaveDialog.js';
import { Toast } from './components/Toast.js';
import { ExplainPanel } from './components/ExplainPanel.js';
import { BatchRunDialog } from './components/BatchRunDialog.js';
import { RunsView } from './components/RunsView.js';

import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { ensureAppNamespace, getRoot, connectRoot } from '../shared/services/data-root-manager.js';
import * as modelProviders from '../shared/services/model-providers.js';

import { defaultSketchCode, defaultParams } from './services/runtime/sketchRunner.js';
import { extractParams, syncParamsWithCode } from './services/runtime/paramExtract.js';
import { randomSeed, clampSeed } from './services/runtime/seedControl.js';
import * as projectStore from './services/storage/projectStore.js';
import * as promptLibrary from './services/promptLibrary.js';
import * as openrouter from './services/ai/openrouter.js';
import { generateSketch, stripCodeFences } from './services/ai/sketchGenerator.js';
import { validateSketchCode } from './services/batchRunner.js';
import { explainSketch } from './services/ai/sketchExplainer.js';
import {
  proposeRemixes,
  safeParseJsonArray,
  safeParseStringArray,
  nearbyPrompts,
  brainstormPrompts,
} from './services/ai/remixPlanner.js';
import { BrainstormDialog } from './components/BrainstormDialog.js';

const APP_ID = 'p5-sketch-gallery';
const PROVIDER_KEY = 'p5-sketch-gallery-provider';
const MODEL_KEY = 'p5-sketch-gallery-or-model';
const THEME_KEY = 'p5-sketch-gallery-theme';

function selectedModelSnapshot(allModels, providerId, modelId) {
  const modelInfo = allModels.find(m => m.providerId === providerId && m.modelId === modelId);
  let provider = null;
  try { provider = providerId ? modelProviders.getProvider(providerId) : null; } catch (e) {}
  const modelDisplayLabel = modelInfo?.displayLabel || modelInfo?.name || modelId || 'unknown';

  return {
    source: 'ai',
    providerId: providerId || modelInfo?.providerId || '',
    providerName: modelInfo?.providerName || provider?.name || '',
    providerType: modelInfo?.providerType || provider?.type || '',
    modelId: modelId || modelInfo?.modelId || '',
    modelName: modelInfo?.name || '',
    modelDisplayLabel,
    model: modelDisplayLabel,
    generatedAt: new Date().toISOString(),
  };
}

function generationSnapshotFromMetadata(metadata = {}) {
  const displayModel = metadata.modelDisplayLabel || metadata.model || metadata.modelName || metadata.modelId || '';
  if (!displayModel && !metadata.providerId && !metadata.generatedAt) return null;

  return {
    source: metadata.source || (displayModel && displayModel !== 'manual' ? 'ai' : 'manual'),
    providerId: metadata.providerId || '',
    providerName: metadata.providerName || '',
    providerType: metadata.providerType || '',
    modelId: metadata.modelId || '',
    modelName: metadata.modelName || '',
    modelDisplayLabel: metadata.modelDisplayLabel || displayModel,
    model: displayModel || 'manual',
    generatedAt: metadata.generatedAt || metadata.createdAt || null,
  };
}

function getRoute() {
  const hash = window.location.hash || '#/create';
  const path = hash.replace('#/', '');
  const slash = path.indexOf('/');
  if (slash === -1) return { name: path || 'create', param: '' };
  return { name: path.slice(0, slash), param: path.slice(slash + 1) };
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [rootHandle, setRootHandle] = useState(null);

  // Editor state
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState(() => defaultSketchCode());
  const [params, setParams] = useState(() => defaultParams());
  const [seed, setSeed] = useState(() => 1);
  const [playing, setPlaying] = useState(true);
  const [currentTitle, setCurrentTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState([]);
  const [editingId, setEditingId] = useState('');
  const [parentId, setParentId] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState('');

  // Gallery
  const [projects, setProjects] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [promptLibraryItems, setPromptLibraryItems] = useState(() => promptLibrary.mergePromptLibrary());
  const [promptLibraryLoading, setPromptLibraryLoading] = useState(false);

  // Models / providers
  const [allModels, setAllModels] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(() => modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY).provider);
  const [selectedModelId, setSelectedModelId] = useState(() => modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY).model);
  const [generationMeta, setGenerationMeta] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(() => openrouter.hasApiKey());

  // Modals + AI
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [explainText, setExplainText] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [remixSuggestions, setRemixSuggestions] = useState([]);
  const [nearbySuggestions, setNearbySuggestions] = useState([]);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [showBrainstorm, setShowBrainstorm] = useState(false);
  const [brainstormSuggestions, setBrainstormSuggestions] = useState([]);
  const [brainstormBusy, setBrainstormBusy] = useState(false);
  const [brainstormError, setBrainstormError] = useState('');

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  // Imperative preview API
  const previewApiRef = useRef(null);
  const batchIdRef = useRef('');
  const batchStartedAtRef = useRef('');

  // Routing + theme
  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Persist provider/model
  useEffect(() => {
    if (selectedProviderId) localStorage.setItem(PROVIDER_KEY, selectedProviderId);
    if (selectedModelId) localStorage.setItem(MODEL_KEY, selectedModelId);
  }, [selectedProviderId, selectedModelId]);

  // Load app namespace if data-root present
  useEffect(() => {
    (async () => {
      try {
        if (await getRoot()) {
          const handle = await ensureAppNamespace(APP_ID);
          setRootHandle(handle);
        }
      } catch (e) {/* user will pick later */}
    })();
  }, []);

  // Load models
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
      if (!selectedModelId && models.length) {
        setSelectedProviderId(models[0].providerId);
        setSelectedModelId(models[0].modelId);
      }
    } catch (e) { console.warn('models', e); }
    finally { setModelsLoading(false); }
  }, [selectedModelId]);
  useEffect(() => { loadModels().catch(() => {}); }, []);

  // Refresh project list on demand
  const refreshProjects = useCallback(async () => {
    if (!rootHandle) return;
    try { setProjects(await projectStore.listProjects(rootHandle)); }
    catch (e) { addToast('Load failed: ' + e.message, 'error'); }
  }, [rootHandle]);

  useEffect(() => {
    if (rootHandle && (route.name === 'gallery' || route.name === 'compare' || route.name === 'view')) {
      refreshProjects();
    }
  }, [rootHandle, route.name]);

  // Load a sketch when route is /view/<id>
  useEffect(() => {
    if (route.name !== 'view' || !route.param || !rootHandle) return;
    (async () => {
      try {
        const proj = await projectStore.loadProject(rootHandle, route.param);
        loadIntoEditor(proj, false);
      } catch (e) {
        addToast('Failed to load: ' + e.message, 'error');
      }
    })();
  }, [route.name, route.param, rootHandle]);

  // Helpers
  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const navigate = useCallback((r) => { window.location.hash = '#/' + r; }, []);
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  const refreshPromptLibrary = useCallback(async () => {
    setPromptLibraryLoading(true);
    try {
      const items = await promptLibrary.getPromptLibrary(rootHandle);
      setPromptLibraryItems(items);
      return items;
    } catch (e) {
      setPromptLibraryItems(promptLibrary.mergePromptLibrary());
      addToast('Saved prompt scan failed: ' + e.message, 'error');
      return promptLibrary.mergePromptLibrary();
    } finally {
      setPromptLibraryLoading(false);
    }
  }, [rootHandle, addToast]);

  useEffect(() => {
    if (route.name === 'prompts') refreshPromptLibrary();
  }, [route.name, refreshPromptLibrary]);

  const handlePickDirectory = useCallback(async () => {
    try {
      const root = await connectRoot();
      if (!root) { addToast('No data root configured — go to Settings → Data Root.', 'error'); return; }
      const appHandle = await ensureAppNamespace(APP_ID);
      setRootHandle(appHandle);
      addToast('Directory connected', 'success');
    } catch (e) { addToast('Failed to connect: ' + e.message, 'error'); }
  }, [addToast]);

  function loadIntoEditor(proj, isRemix) {
    if (!proj) return;
    setCode(proj.code || '');
    setPrompt(proj.prompt || '');
    setParams(proj.params || {});
    setSeed(clampSeed(proj.metadata?.seed));
    setCurrentTitle(proj.metadata?.title || proj.id || '');
    setTags(proj.metadata?.tags || []);
    setNotes(proj.metadata?.notes || '');
    setGenerationMeta(generationSnapshotFromMetadata(proj.metadata));
    setEditingId(isRemix ? '' : (proj.id || ''));
    setParentId(isRemix ? proj.id : (proj.metadata?.parentId || null));
    setExplainText('');
    setRemixSuggestions([]);
    navigate('create');
  }

  const handleClear = useCallback(() => {
    setPrompt('');
    setCode(defaultSketchCode());
    setParams(defaultParams());
    setSeed(1);
    setCurrentTitle('');
    setGenerationMeta(null);
    setTags([]);
    setNotes('');
    setEditingId('');
    setParentId(null);
    setExplainText('');
    setRemixSuggestions([]);
    addToast('Cleared', 'info');
  }, [addToast]);

  const handleModelChange = useCallback((providerId, modelId) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
  }, []);

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

  // Generate sketch from prompt
  const handleGenerate = useCallback(async (promptOverride) => {
    const promptText = typeof promptOverride === 'string' ? promptOverride : prompt;
    if (!promptText.trim()) { addToast('Enter a prompt first', 'error'); return; }
    if (!selectedModelId || !selectedProviderId) { addToast('Select a model first', 'error'); return; }
    if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
      setShowApiKeyDialog(true);
      return;
    }
    setIsGenerating(true);
    setRuntimeStatus('Generating...');
    let acc = '';
    const generationSnapshot = selectedModelSnapshot(allModels, selectedProviderId, selectedModelId);
    try {
      await generateSketch({
        prompt: promptText,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => {
          acc = stripCodeFences(partial);
          setCode(acc);
        },
      });
      setGenerationMeta(generationSnapshot);
      setRuntimeStatus('');

      // A new sketch reads its own knobs — rebuild the panel from the code it
      // actually generated, or the sliders keep driving the previous sketch.
      const synced = syncParamsWithCode(acc, params);
      if (synced.changed) {
        setParams(synced.params);
        const n = Object.keys(synced.params).length;
        addToast(
          n ? `Sketch generated — ${n} parameter${n === 1 ? '' : 's'}` : 'Sketch generated — no tunable parameters',
          'success',
        );
      } else if (synced.unparsed) {
        addToast('Sketch generated — could not read its parameters, panel unchanged', 'info');
      } else {
        addToast('Sketch generated', 'success');
      }
    } catch (e) {
      addToast('Generation failed: ' + e.message, 'error');
      setRuntimeStatus('Error: ' + e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, params, allModels, selectedProviderId, selectedModelId, addToast]);

  const prepareLibraryPrompt = useCallback((item) => {
    setPrompt(item.prompt || '');
    setCode(defaultSketchCode());
    setParams(defaultParams());
    setSeed(1);
    setCurrentTitle(item.title || '');
    setTags(item.tags || []);
    setNotes(item.notes || '');
    setGenerationMeta(null);
    setEditingId('');
    setParentId(null);
    setExplainText('');
    setRemixSuggestions([]);
  }, []);

  const handleUseLibraryPrompt = useCallback((item) => {
    prepareLibraryPrompt(item);
    navigate('create');
    addToast(`Loaded "${item.title}"`, 'info');
  }, [prepareLibraryPrompt, navigate, addToast]);

  const handleRunLibraryPrompt = useCallback((item) => {
    prepareLibraryPrompt(item);
    navigate('create');
    handleGenerate(item.prompt || '');
  }, [prepareLibraryPrompt, navigate, handleGenerate]);

  const batchModel = useMemo(() => {
    const snapshot = selectedModelSnapshot(allModels, selectedProviderId, selectedModelId);
    return { ...snapshot, label: snapshot.modelDisplayLabel || selectedModelId || '' };
  }, [allModels, selectedProviderId, selectedModelId]);

  const batchDeps = useMemo(() => ({
    beginRun: () => {
      batchIdRef.current = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      batchStartedAtRef.current = new Date().toISOString();
    },
    generate: async (promptText, { params: generationParams, onChunk, onStats } = {}) => {
      let finalCode = '';
      await generateSketch({
        prompt: promptText,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        params: generationParams,
        onStats,
        onChunk: partial => {
          finalCode = stripCodeFences(partial);
          onChunk?.(finalCode);
        },
      });
      return finalCode;
    },
    validate: validateSketchCode,
    extractParams: codeText => extractParams(codeText).params,
    seedFor: (item, index) => ((index + 1) * 1009) % 2147483647 || 1,
    hasExistingForModel: (item, model) => (
      !!model?.providerId && !!model?.modelId
      && (item.providerModelKeys || []).includes(`${model.providerId}::${model.modelId}`)
    ) || (
      !(item.providerModelKeys || []).length && !!model?.modelId && (item.modelIds || []).includes(model.modelId)
    ) || (
      !(item.modelIds || []).length && !!model?.label && (item.modelLabels || []).includes(model.label)
    ),
    save: async ({ prompt: item, model, code: codeText, sketchParams, sketchSeed,
      thumbnailDataUrl, stats, index, total }) => {
      const title = item.runTitle || item.title || 'Batch sketch';
      const id = await projectStore.makeUniqueSketchId(rootHandle, title);
      const generatedAt = new Date().toISOString();
      const metadata = projectStore.createMetadata({
        ...model,
        title,
        model: model.label || model.modelDisplayLabel || model.modelId,
        source: 'ai',
        tags: [...new Set([...(item.tags || []), 'batch'])],
        seed: sketchSeed,
        notes: item.notes || 'Batch generated from the prompt library.',
        generatedAt,
        generationParams: item.generationParams || null,
        generationStats: stats || null,
        batch: {
          id: batchIdRef.current,
          startedAt: batchStartedAtRef.current,
          index,
          total,
          promptId: item.id,
          promptTitle: item.title,
          jobKey: item.jobKey,
        },
      });
      await projectStore.saveProject(rootHandle, id, {
        code: codeText,
        prompt: item.prompt,
        params: sketchParams,
        metadata,
        thumbnailDataUrl,
      });
      return { id };
    },
    listRuns: () => projectStore.listBatchRuns(rootHandle),
    loadRunProjects: items => projectStore.loadBatchRunProjects(rootHandle, items),
  }), [rootHandle, selectedProviderId, selectedModelId]);

  const runsDeps = useMemo(() => ({
    listRuns: () => projectStore.listBatchRuns(rootHandle),
    loadRunProjects: items => projectStore.loadBatchRunProjects(rootHandle, items),
  }), [rootHandle]);

  const handleOpenBatch = useCallback(async () => {
    if (!rootHandle) {
      addToast('Connect a data root first — batch sketches are saved there', 'error');
      handlePickDirectory();
      return;
    }
    try {
      let permission = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') permission = await rootHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        addToast('Write permission denied — reconnect the data root', 'error');
        return;
      }
    } catch (error) { /* save will report a concrete permission failure */ }
    await refreshPromptLibrary();
    setShowBatchDialog(true);
  }, [rootHandle, handlePickDirectory, refreshPromptLibrary, addToast]);

  const handleCloseBatch = useCallback(() => {
    setShowBatchDialog(false);
    refreshProjects();
    refreshPromptLibrary();
  }, [refreshProjects, refreshPromptLibrary]);

  // Manual "pull the knobs out of the code" — for hand-edited sketches, and
  // for generations where the model's parameter reads changed after the fact.
  const handleSyncParams = useCallback(() => {
    const synced = syncParamsWithCode(code, params, { keepValues: true });
    if (synced.changed) {
      setParams(synced.params);
      const n = Object.keys(synced.params).length;
      addToast(n ? `Parameters synced from code — ${n} found` : 'This sketch reads no ctx.params', 'success');
    } else if (synced.unparsed) {
      addToast('Could not read ctx.params from this sketch — panel unchanged', 'error');
    } else {
      addToast('Parameters already match the code', 'info');
    }
  }, [code, params, addToast]);

  // Save sketch (with thumbnail capture)
  const handleSaveSubmit = useCallback(async ({ title, tags: dialogTags, notes: dialogNotes, model: dialogModel }) => {
    if (!rootHandle) {
      handlePickDirectory();
      return;
    }
    try {
      let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await rootHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { addToast('Write permission denied', 'error'); return; }
      }

      const id = await projectStore.makeUniqueSketchId(rootHandle, title);
      let thumbnail = null;
      try { thumbnail = await previewApiRef.current?.capture(); } catch (e) {}

      const baseMeta = generationMeta || { source: 'manual', model: 'manual', modelDisplayLabel: 'manual' };
      const savedNotes = dialogNotes ?? notes;
      const savedTags = dialogTags?.length ? dialogTags : tags;
      const metadata = projectStore.createMetadata({
        ...baseMeta,
        // The dialog shows the auto-detected model and lets the author correct it.
        ...(dialogModel ? { model: dialogModel, modelDisplayLabel: dialogModel } : {}),
        title,
        tags: savedTags,
        seed,
        parentId,
        notes: savedNotes,
      });

      await projectStore.saveProject(rootHandle, id, {
        code,
        prompt,
        params,
        metadata,
        thumbnailDataUrl: thumbnail,
      });
      setCurrentTitle(title);
      // Mirror what the dialog captured back into the editor panels.
      setNotes(savedNotes);
      setTags(savedTags);
      if (dialogModel && dialogModel !== (generationMeta?.modelDisplayLabel || generationMeta?.model)) {
        setGenerationMeta({ ...baseMeta, model: dialogModel, modelDisplayLabel: dialogModel });
      }
      setEditingId(id);
      setShowSaveDialog(false);
      addToast(`Saved new sketch: ${id}`, 'success');
      refreshProjects();
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [rootHandle, code, prompt, params, seed, parentId, notes, tags, generationMeta, addToast, refreshProjects, handlePickDirectory]);

  const handleOpenSave = useCallback(() => {
    if (!rootHandle) { handlePickDirectory(); return; }
    setShowSaveDialog(true);
  }, [rootHandle, handlePickDirectory]);

  // Gallery actions
  const handleOpen = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const proj = await projectStore.loadProject(rootHandle, id);
      loadIntoEditor(proj, false);
    } catch (e) { addToast('Open failed: ' + e.message, 'error'); }
  }, [rootHandle, addToast]);

  const handleRemix = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const proj = await projectStore.loadProject(rootHandle, id);
      loadIntoEditor(proj, true);
      addToast(`Remixing "${proj.metadata?.title || id}" — saves as a new sketch`, 'info');
    } catch (e) { addToast('Remix failed: ' + e.message, 'error'); }
  }, [rootHandle, addToast]);

  const handleDelete = useCallback(async (id) => {
    if (!rootHandle) return;
    if (!confirm(`Delete "${id}"? Cannot be undone.`)) return;
    try {
      await projectStore.deleteProject(rootHandle, id);
      addToast(`Deleted ${id}`, 'success');
      refreshProjects();
    } catch (e) { addToast('Delete failed: ' + e.message, 'error'); }
  }, [rootHandle, refreshProjects, addToast]);

  const handleAddToCompare = useCallback((id) => {
    setCompareIds(prev => prev.includes(id) ? prev : (prev.length >= 4 ? prev : [...prev, id]));
  }, []);

  // AI helpers
  const handleExplain = useCallback(async () => {
    if (!selectedModelId) { addToast('Select a model first', 'error'); return; }
    if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) { setShowApiKeyDialog(true); return; }
    setExplaining(true);
    setExplainText('');
    let acc = '';
    try {
      await explainSketch({
        code,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => { acc = partial; setExplainText(partial); },
      });
    } catch (e) {
      setExplainText('Explain failed: ' + e.message);
    } finally {
      setExplaining(false);
    }
  }, [code, selectedProviderId, selectedModelId, addToast]);

  const handleProposeRemix = useCallback(async () => {
    if (!selectedModelId) { addToast('Select a model first', 'error'); return; }
    if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) { setShowApiKeyDialog(true); return; }
    setRuntimeStatus('Proposing remixes...');
    let acc = '';
    try {
      await proposeRemixes({
        code,
        params,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => { acc = partial; },
      });
      const list = safeParseJsonArray(acc);
      setRemixSuggestions(list);
      if (list.length === 0) addToast('Model returned no parsable remixes', 'error');
    } catch (e) {
      addToast('Remix request failed: ' + e.message, 'error');
    } finally {
      setRuntimeStatus('');
    }
  }, [code, params, selectedProviderId, selectedModelId, addToast]);

  const requireModelOrToast = useCallback(() => {
    if (!selectedModelId) { addToast('Select a model first', 'error'); return false; }
    if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
      setShowApiKeyDialog(true);
      return false;
    }
    return true;
  }, [selectedModelId, selectedProviderId, addToast]);

  const handleNearby = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!requireModelOrToast()) return;
    setNearbyBusy(true);
    let acc = '';
    try {
      await nearbyPrompts({
        prompt,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => { acc = partial; },
      });
      const list = safeParseStringArray(acc);
      setNearbySuggestions(list);
      if (list.length === 0) addToast('No parsable suggestions returned', 'error');
    } catch (e) {
      addToast('Nearby prompts failed: ' + e.message, 'error');
    } finally {
      setNearbyBusy(false);
    }
  }, [prompt, selectedProviderId, selectedModelId, requireModelOrToast, addToast]);

  const handleBrainstormRun = useCallback(async (theme) => {
    if (!requireModelOrToast()) return;
    setBrainstormBusy(true);
    setBrainstormError('');
    let acc = '';
    try {
      await brainstormPrompts({
        theme,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        onChunk: (partial) => { acc = partial; },
      });
      const list = safeParseStringArray(acc);
      setBrainstormSuggestions(list);
      if (list.length === 0) setBrainstormError('Model returned no parsable prompts.');
    } catch (e) {
      setBrainstormError('Brainstorm failed: ' + e.message);
    } finally {
      setBrainstormBusy(false);
    }
  }, [selectedProviderId, selectedModelId, requireModelOrToast]);

  const handlePickSuggestion = useCallback((text) => {
    setPrompt(text);
    setNearbySuggestions([]);
    addToast('Prompt updated — hit Generate when ready', 'info');
  }, [addToast]);

  const handlePickBrainstorm = useCallback((text) => {
    setPrompt(text);
    setShowBrainstorm(false);
    setBrainstormSuggestions([]);
    addToast('Prompt updated — hit Generate when ready', 'info');
  }, [addToast]);

  const handleApplyRemix = useCallback((remix) => {
    if (!remix?.params) return;
    setParams(prev => {
      // A remix retunes the knobs this sketch already has. Models sometimes
      // invent extra keys; merging those in leaves dead sliders behind forever.
      const next = { ...prev };
      let ignored = 0;
      for (const [k, v] of Object.entries(remix.params)) {
        if (k in prev) next[k] = v; else ignored++;
      }
      if (ignored) console.warn(`Remix proposed ${ignored} key(s) the sketch does not read — ignored`);
      return next;
    });
    addToast(`Applied remix: ${remix.name || ''}`, 'success');
  }, [addToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (route.name === 'create') handleOpenSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') { e.preventDefault(); navigate('gallery'); }
      if (e.key === ' ' && e.target?.tagName !== 'TEXTAREA' && e.target?.tagName !== 'INPUT') {
        if (route.name === 'create') {
          e.preventDefault();
          setPlaying(p => !p);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, navigate, handleOpenSave]);

  // Render screens
  const renderContent = () => {
    if (route.name === 'prompts') {
      return html`<${PromptLibraryView}
        prompts=${promptLibraryItems}
        loading=${promptLibraryLoading}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        onRefresh=${refreshPromptLibrary}
        onUse=${handleUseLibraryPrompt}
        onRun=${handleRunLibraryPrompt}
        isGenerating=${isGenerating}
      />`;
    }
    if (route.name === 'gallery') {
      return html`<${GalleryGrid}
        projects=${projects}
        onOpen=${handleOpen}
        onAddToCompare=${(id) => { handleAddToCompare(id); }}
        onRemix=${handleRemix}
        onDelete=${handleDelete}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        compareIds=${compareIds}
      />`;
    }
    if (route.name === 'compare') {
      return html`<${CompareView}
        projects=${projects}
        compareIds=${compareIds}
        onCompareIdsChange=${setCompareIds}
        rootHandle=${rootHandle}
      />`;
    }
    if (route.name === 'runs') {
      return html`<${RunsView}
        deps=${runsDeps}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        onOpenProject=${handleOpen}
        addToast=${addToast}
      />`;
    }
    // create + view
    return html`
      <div class="create-view">
        <div class="create-left">
          <${PromptComposer}
            prompt=${prompt}
            onChange=${setPrompt}
            onBrainstorm=${() => setShowBrainstorm(true)}
            onNearby=${handleNearby}
            nearbySuggestions=${nearbySuggestions}
            nearbyBusy=${nearbyBusy}
            onPickSuggestion=${handlePickSuggestion}
            onDismissSuggestions=${() => setNearbySuggestions([])}
          />
          <${SketchEditor} code=${code} onChange=${setCode} theme=${theme} />
        </div>
        <div class="create-center">
          <${CanvasPreview}
            code=${code}
            params=${params}
            seed=${seed}
            playing=${playing}
            registerApi=${(api) => { previewApiRef.current = api; }}
            onError=${(msg) => setRuntimeStatus(msg)}
            onReady=${() => setRuntimeStatus('')}
          />
          <${LineageTrail} projects=${projects} currentId=${editingId} onOpen=${handleOpen} />
          <${ExplainPanel}
            text=${explainText}
            busy=${explaining}
            onClose=${() => setExplainText('')}
          />
        </div>
        <div class="create-right">
          <${ParameterPanel}
            params=${params}
            onParamsChange=${setParams}
            seed=${seed}
            onSeedChange=${(s) => setSeed(clampSeed(s))}
            onRandomSeed=${() => setSeed(randomSeed())}
            playing=${playing}
            onTogglePlay=${() => setPlaying(p => !p)}
            onRestart=${() => previewApiRef.current?.restart()}
            notes=${notes}
            onNotesChange=${setNotes}
            tags=${tags}
            onTagsChange=${setTags}
            runtimeStatus=${runtimeStatus}
            onSyncParams=${handleSyncParams}
            onExplain=${handleExplain}
            onProposeRemix=${handleProposeRemix}
            remixSuggestions=${remixSuggestions}
            onApplyRemix=${handleApplyRemix}
          />
        </div>
      </div>
    `;
  };

  return html`
    <${Toolbar}
      route=${route.name === 'view' ? 'create' : route.name}
      theme=${theme}
      onNavigate=${navigate}
      onToggleTheme=${toggleTheme}
      hasDirectory=${!!rootHandle}
      directoryName=${rootHandle?.name || ''}
      onPickDirectory=${handlePickDirectory}
      onSave=${handleOpenSave}
      onClear=${handleClear}
      onHelpClick=${() => setShowHelp(true)}
      allModels=${allModels}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      onModelChange=${handleModelChange}
      onGenerate=${handleGenerate}
      isGenerating=${isGenerating}
      modelsLoading=${modelsLoading}
      hasApiKey=${apiKeySet}
      onApiKeyClick=${() => setShowApiKeyDialog(true)}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onBatch=${handleOpenBatch}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'p5 Sketch Gallery',
        appHandle: rootHandle,
        sourceArtefactId: editingId || null,
        metadata: () => ({
          route: window.location.hash || '#/create',
          sketchTitle: currentTitle || null,
          prompt: prompt || null,
          seed,
          tags,
        }),
        onNeedDirectory: handlePickDirectory,
        onSaved: result => addToast(`Recording saved: ${result.path}`, 'success'),
        onDownloaded: ({ filename }) => addToast(`Downloaded ${filename}`, 'success'),
        onError: error => addToast(`Recording failed: ${error.message}`, 'error'),
      }}
    />
    <div class="main-content">
      ${renderContent()}
    </div>

    ${showBatchDialog && html`
      <${BatchRunDialog}
        prompts=${promptLibraryItems}
        model=${batchModel}
        allModels=${allModels}
        modelsLoading=${modelsLoading}
        onModelChange=${handleModelChange}
        onProviderSettingsClick=${() => setShowProviderSettings(true)}
        hasApiKey=${apiKeySet}
        onApiKeyClick=${() => setShowApiKeyDialog(true)}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        deps=${batchDeps}
        onOpenProject=${async id => { handleCloseBatch(); await handleOpen(id); }}
        onOpenGallery=${() => navigate('gallery')}
        onOpenRuns=${() => { handleCloseBatch(); navigate('runs'); }}
        onClose=${handleCloseBatch}
        addToast=${addToast}
      />
    `}

    ${showSaveDialog && html`
      <${SaveDialog}
        onSave=${handleSaveSubmit}
        onClose=${() => setShowSaveDialog(false)}
        initialTitle=${currentTitle || ''}
        initialTags=${tags}
        initialNotes=${notes}
        generationMeta=${generationMeta}
        prompt=${prompt}
        code=${code}
        params=${params}
        providerId=${selectedProviderId}
        modelId=${selectedModelId}
        addToast=${addToast}
      />
    `}
    ${showApiKeyDialog && html`
      <${ApiKeyDialog}
        currentKey=${openrouter.getApiKey()}
        onSave=${handleApiKeySave}
        onClose=${() => setShowApiKeyDialog(false)}
      />
    `}
    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${handleProvidersChanged}
      />
    `}
    ${showHelp && html`
      <${HelpDialog}
        src="./HELP.md"
        title="p5 Sketch Gallery — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    ${showBrainstorm && html`
      <${BrainstormDialog}
        onRun=${handleBrainstormRun}
        onPick=${handlePickBrainstorm}
        onClose=${() => { setShowBrainstorm(false); setBrainstormError(''); }}
        busy=${brainstormBusy}
        suggestions=${brainstormSuggestions}
        error=${brainstormError}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

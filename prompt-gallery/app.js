import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { Toolbar } from './components/Toolbar.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { AgentRunTrace, useCodingAgentRun } from '../shared/components/CodingAgentRun.js';
import { PromptEditor } from './components/PromptEditor.js';
import { PreviewPane } from './components/PreviewPane.js';
import { GalleryView } from './components/GalleryView.js';
import { CompareView } from './components/CompareView.js';
import { RunsView } from './components/RunsView.js';
import { PromptLibraryView } from './components/PromptLibraryView.js';
import { PromptFormDialog } from './components/PromptFormDialog.js';
import { ImportPromptsDialog } from './components/ImportPromptsDialog.js';
import { RefineView } from './components/RefineView.js';
import { BatchRunDialog } from './components/BatchRunDialog.js';
import { runHtmlSandbox, runStatusLabel } from './services/sandboxRunner.js';
import { healHtml } from './services/refine.js';
import { MetadataPanel } from './components/MetadataPanel.js';
import { SaveDialog } from './components/SaveDialog.js';
import { Toast } from './components/Toast.js';
import { ApiKeyDialog } from './components/ApiKeyDialog.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { clearHandle } from '../shared/services/storage.js';
import { ensureAppNamespace, getRoot, connectRoot } from '../shared/services/data-root-manager.js';
import {
  peekPromptGalleryReturnHandoff,
  clearPromptGalleryReturnHandoff,
} from '../shared/services/code-morph-return-handoff.js';
import {
  peekPromptGalleryInboundHandoff,
  clearPromptGalleryInboundHandoff,
} from '../shared/services/prompt-gallery-handoff.js';

const APP_ID = 'prompt-gallery';
const PREFS_DEFAULTS = { theme: 'dark', provider: '', model: '', disabledProviders: [], backend: 'model', agent: 'claude-code', agentModels: {} };
import { sendToCodeMorphLab } from '../shared/services/code-morph-handoff.js';
import * as meta from './services/metadata.js';
import * as library from './services/library.js';
import * as openrouter from './services/openrouter.js';
import { buildPromptGalleryAgentTask, PROMPT_GALLERY_AGENT_OUTPUT } from './services/codingAgent.js';
import { AGENTS } from '../shared/services/agent-backend.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { prefs, hydrateAppPrefs, setPref, setPrefs, subscribeAppPrefs } from '../shared/services/app-prefs.js';
import { subscribeSuite } from '../shared/services/suite-prefs.js';
import { crossAppHandoffsEnabled } from '../shared/services/distribution.js';

function getRoute() {
  const hash = window.location.hash || '#/create';
  const path = hash.replace('#/', '');
  const firstSlash = path.indexOf('/');
  if (firstSlash === -1) return { name: path || 'create', param: '' };
  return { name: path.substring(0, firstSlash), param: path.substring(firstSlash + 1) };
}

function decodeRouteParam(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (e) {
    return value || '';
  }
}

function safeFolderName(value) {
  return String(value || 'morphed-output')
    .split('/')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'morphed-output';
}

function pickReturnedContent(payload) {
  const files = payload.files || [];
  const preferred = files.find(file => file.name === payload.entryFile);
  return preferred?.content
    || files.find(file => file.name === 'index.html')?.content
    || files.find(file => (file.name || '').endsWith('.html'))?.content
    || files[0]?.content
    || '';
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [theme, setTheme] = useState(() => prefs(APP_ID, { defaults: PREFS_DEFAULTS }).theme);
  const [showHelp, setShowHelp] = useState(false);
  const [rootHandle, setRootHandle] = useState(null);

  // Create view state
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  // What actually produced the current response ('' until something does).
  // Empty means "nothing generated yet", so Save can fall back to the picker.
  const [model, setModel] = useState('');
  const [editingId, setEditingId] = useState('');

  // Gallery state
  const [generations, setGenerations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedGeneration, setSelectedGeneration] = useState(null);
  const [galleryReturnFolder, setGalleryReturnFolder] = useState('');

  // Compare state
  const [compareIds, setCompareIds] = useState([]);

  // Prompt library state
  const [libraryPrompts, setLibraryPrompts] = useState([]);
  const [promptForm, setPromptForm] = useState(null); // { initial } | null
  const [importItems, setImportItems] = useState(null); // array | null
  const [importScanning, setImportScanning] = useState(false);

  // Refine state
  const [refineSession, setRefineSession] = useState(null);
  const [createRunStatus, setCreateRunStatus] = useState(null); // sandbox result for the Create preview
  const createRunTokenRef = useRef(0);

  // Provider/model state
  const [allModels, setAllModels] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(() => {
    const p = prefs(APP_ID, { defaults: PREFS_DEFAULTS }).provider;
    return p || modelProviders.getDefaultProvider() || '';
  });
  const [selectedModelId, setSelectedModelId] = useState(() => {
    const snap = prefs(APP_ID, { defaults: PREFS_DEFAULTS });
    if (snap.model) return snap.model;
    const p = snap.provider || modelProviders.getDefaultProvider();
    return p ? modelProviders.getDefaultModel(p) : '';
  });
  // A local CLI agent is just another executor; `backend` says which one is live.
  const [backend, setBackend] = useState(() => prefs(APP_ID, { defaults: PREFS_DEFAULTS }).backend || 'model');
  const [selectedAgentId, setSelectedAgentId] = useState(() => prefs(APP_ID, { defaults: PREFS_DEFAULTS }).agent || 'claude-code');
  const [agentModels, setAgentModels] = useState(() => prefs(APP_ID, { defaults: PREFS_DEFAULTS }).agentModels || {});
  const agentRun = useCodingAgentRun({ appId: APP_ID });
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(() => openrouter.hasApiKey());
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [disabledProviders, setDisabledProviders] = useState(() => {
    const snap = prefs(APP_ID, { defaults: PREFS_DEFAULTS });
    return Array.isArray(snap.disabledProviders) ? snap.disabledProviders : [];
  });

  // UI state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const batchIdRef = useRef('');
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const returnHandoffBusyRef = useRef(false);

  // Hash routing
  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const hljsLink = document.getElementById('hljs-theme');
    if (hljsLink) {
      hljsLink.href = theme === 'dark'
        ? '../shared/lib/highlight.js/11.9.0/styles/github-dark.min.css'
        : '../shared/lib/highlight.js/11.9.0/styles/github.min.css';
    }
  }, [theme]);

  // Hydrate prefs from disk on mount and subscribe so post-hydrate
  // updates flow into React state.
  useEffect(() => {
    hydrateAppPrefs(APP_ID, { defaults: PREFS_DEFAULTS });
    return subscribeAppPrefs(APP_ID, (snap) => {
      if (snap.theme !== undefined) setTheme(snap.theme);
      if (snap.provider !== undefined) setSelectedProviderId(snap.provider);
      if (snap.model !== undefined) setSelectedModelId(snap.model);
      if (Array.isArray(snap.disabledProviders)) setDisabledProviders(snap.disabledProviders);
    });
  }, []);

  // The api-keys suite-prefs hydrate is async — its initial state is empty,
  // which leaves apiKeySet=false and the toolbar key icon yellow even when
  // a key is on disk. Subscribe so it flips green once the snapshot lands.
  useEffect(() => {
    const sync = () => setApiKeySet(openrouter.hasApiKey());
    sync(); // catch already-completed hydrate
    return subscribeSuite('api-keys', sync);
  }, []);

  // Load saved directory handle on startup
  useEffect(() => {
    (async () => {
      try {
        if (await getRoot()) {
          const handle = await ensureAppNamespace(APP_ID);
          setRootHandle(handle);
        }
      } catch (e) {
        // Ignore - user will need to pick directory
      }
    })();
  }, []);

  // Consume inbound prompt handoff (e.g. from three-prompt-lab "Send to Gallery")
  useEffect(() => {
    const inbound = peekPromptGalleryInboundHandoff();
    if (!inbound || !inbound.prompt) return;
    setPrompt(inbound.prompt);
    setResponse('');
    setEditingId('');
    clearPromptGalleryInboundHandoff();
    if (route.name !== 'create') {
      window.location.hash = '#/create';
    }
    addToast(`Loaded prompt from ${inbound.source || 'another app'}`, 'success');
  }, []);

  // Load models from all enabled providers on startup. Auto-pick is handled
  // in a separate effect so it can react to async hydrates of providers /
  // app-prefs / disabledProviders without re-running the network fetch.
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
    } catch (e) {
      console.warn('Failed to load models:', e);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // A counter that bumps every time the providers suite-prefs snapshot
  // changes (default provider/model field, list, etc.). Used as a dep so the
  // auto-pick effect re-runs after the suite hydrates from disk.
  const [providersTick, setProvidersTick] = useState(0);

  // Auto-pick selectedProvider/Model unless the user has an explicit choice
  // saved on disk. Reads the prefs snapshot at decision time so it stays
  // correct across async hydrates of providers and app-prefs. Preference
  // order: global default exact > same provider > first visible.
  useEffect(() => {
    const snap = prefs(APP_ID, { defaults: PREFS_DEFAULTS });
    if (snap.model) return; // user has an explicit choice saved — respect it
    const visible = allModels.filter(m => !disabledProviders.includes(m.providerId));
    if (visible.length === 0) return;
    const defProvider = modelProviders.getDefaultProvider();
    const defModel = defProvider ? modelProviders.getDefaultModel(defProvider) : '';
    const exactMatch = (defProvider && defModel)
      ? visible.find(m => m.providerId === defProvider && m.modelId === defModel)
      : null;
    const providerMatch = !exactMatch && defProvider
      ? visible.find(m => m.providerId === defProvider)
      : null;
    const pick = exactMatch || providerMatch || visible[0];
    if (pick.providerId === selectedProviderId && pick.modelId === selectedModelId) return;
    setSelectedProviderId(pick.providerId);
    setSelectedModelId(pick.modelId);
  }, [selectedModelId, selectedProviderId, allModels, disabledProviders, providersTick]);

  // If any globally-enabled provider returned zero models (typical when the
  // suite-prefs cache wasn't hydrated before the first fetch, or when a fresh
  // network call to a LAN endpoint failed), force one refresh per provider so
  // the dropdown isn't permanently missing entries. Tracked in a ref so we
  // never loop on a provider that genuinely has no models.
  const autoRefreshedProvidersRef = useRef(new Set());
  useEffect(() => {
    if (modelsLoading) return;
    const enabled = modelProviders.getEnabledProviders();
    const missing = enabled.filter(p =>
      !autoRefreshedProvidersRef.current.has(p.id)
      && !allModels.some(m => m.providerId === p.id),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      let anyRefreshed = false;
      for (const p of missing) {
        autoRefreshedProvidersRef.current.add(p.id);
        try {
          await modelProviders.refreshProviderModels(p.id);
          anyRefreshed = true;
        } catch (e) {
          console.warn(`[prompt-gallery] refreshProviderModels(${p.name || p.id}) failed:`, e?.message || e);
        }
      }
      if (!cancelled && anyRefreshed) {
        await loadModels();
      }
    })();
    return () => { cancelled = true; };
  }, [allModels, modelsLoading, loadModels]);

  // The providers suite-prefs hydrate is async. The first loadModels call
  // can run before getProviders() is populated — leaving allModels with
  // either nothing or only the seeded OpenRouter default. Subscribing forces
  // a re-fetch as soon as the real provider list lands on disk-load.
  // We also synchronously fire once at effect setup so a hydrate that
  // already completed (subscribeSuite doesn't replay missed events) still
  // triggers our handler.
  useEffect(() => {
    let lastSig = '';
    const handle = () => {
      setProvidersTick(t => t + 1);
      const list = modelProviders.getProviders();
      if (!Array.isArray(list)) return;
      const sig = list.map(p => `${p.id}:${p.enabled !== false ? '1' : '0'}`).sort().join(',');
      if (sig === lastSig) return;
      lastSig = sig;
      // Reset auto-refresh dedup so newly-arrived providers can be auto-refreshed.
      autoRefreshedProvidersRef.current = new Set();
      loadModels();
    };
    handle(); // catch already-completed hydrate
    return subscribeSuite('providers', handle);
  }, [loadModels]);

  // If the user toggles the current provider off in the per-app dialog, fall
  // back to a still-visible model so the toolbar doesn't show a stale label
  // and Generate doesn't try a disabled provider.
  useEffect(() => {
    if (!selectedProviderId) return;
    if (!disabledProviders.includes(selectedProviderId)) return;
    const visible = allModels.filter(m => !disabledProviders.includes(m.providerId));
    if (visible.length === 0) return;
    const defProvider = modelProviders.getDefaultProvider();
    const defModel = defProvider ? modelProviders.getDefaultModel(defProvider) : '';
    const exactMatch = (defProvider && defModel)
      ? visible.find(m => m.providerId === defProvider && m.modelId === defModel)
      : null;
    const providerMatch = !exactMatch && defProvider
      ? visible.find(m => m.providerId === defProvider)
      : null;
    const pick = exactMatch || providerMatch || visible[0];
    setSelectedProviderId(pick.providerId);
    setSelectedModelId(pick.modelId);
  }, [disabledProviders, allModels, selectedProviderId]);

  // (loadModels is kicked from the providers-suite subscribe effect above —
  // its synchronous initial call covers the on-mount load too.)

  // Persistence is intentionally NOT done here — only handleModelChange (an
  // explicit user dropdown pick) writes to disk. That keeps auto-picks and
  // subscribe-from-disk updates from resurrecting cleared per-app overrides.

  // Load generations when rootHandle changes or route changes to gallery/compare
  // (prompts needs them too, for per-prompt run stats)
  useEffect(() => {
    if (rootHandle && (route.name === 'gallery' || route.name === 'compare' || route.name === 'prompts' || route.name === 'runs')) {
      refreshGenerations();
    }
  }, [rootHandle, route.name]);

  // Load the prompt library (curated seeds + user prompts). Seeds work
  // without a directory; the user layer joins in once rootHandle lands.
  const refreshLibrary = useCallback(async () => {
    try {
      setLibraryPrompts(await library.getLibrary(rootHandle));
    } catch (e) {
      console.warn('Failed to load prompt library:', e);
    }
  }, [rootHandle]);

  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  // Load full generation when viewing
  useEffect(() => {
    if (route.name === 'view' && route.param && rootHandle) {
      setSelectedId(route.param);
      // Clear previous generation so its iframe unmounts before the new one renders
      // (otherwise old scripts/animations keep running while srcdoc is swapped)
      if (selectedGeneration && selectedGeneration.id !== route.param) {
        setSelectedGeneration(null);
      }
      loadFullGeneration(route.param);
    }
  }, [route.name, route.param, rootHandle]);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, 3000);
  }, []);

  const navigate = useCallback((r) => {
    window.location.hash = '#/' + r;
  }, []);

  const navigateToGallery = useCallback(() => {
    const target = galleryReturnFolder ? `gallery/${encodeURIComponent(galleryReturnFolder)}` : 'gallery';
    navigate(target);
  }, [galleryReturnFolder, navigate]);

  const toggleTheme = useCallback(() => {
    setPref(APP_ID, 'theme', theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  const handlePickDirectory = useCallback(async () => {
    try {
      const root = await connectRoot();
      if (!root) {
        addToast('No data root configured — go to Settings → Data Root.', 'error');
        return;
      }
      const appHandle = await ensureAppNamespace(APP_ID);
      setRootHandle(appHandle);
      hydrateAppPrefs(APP_ID, { defaults: PREFS_DEFAULTS });
      addToast('Directory connected', 'success');
    } catch (e) {
      addToast('Failed to connect directory', 'error');
    }
  }, [addToast]);

  const refreshGenerations = useCallback(async () => {
    if (!rootHandle) return;
    try {
      const list = await meta.listGenerations(rootHandle);
      setGenerations(list);
    } catch (e) {
      addToast('Failed to load generations: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  useEffect(() => {
    if (!rootHandle || returnHandoffBusyRef.current) return;
    const handoff = peekPromptGalleryReturnHandoff();
    if (!handoff) return;

    returnHandoffBusyRef.current = true;
    (async () => {
      try {
        let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await rootHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          addToast('Write permission denied — reconnect the Prompt Gallery folder to receive the morphed result', 'error');
          return;
        }

        const responseHtml = pickReturnedContent(handoff);
        if (!responseHtml) throw new Error('No returned HTML file found');

        const sourceId = handoff.meta?.sourceId || handoff.title || handoff.meta?.morphSessionId;
        const folderName = safeFolderName(sourceId);
        const metadata = {
          ...meta.createMetadata('Code Morph Lab v3', ['morphed']),
          modelId: handoff.meta?.morphModel || '',
          modelName: handoff.meta?.morphModel || 'Code Morph Lab v3',
          modelDisplayLabel: 'Code Morph Lab v3',
          providerId: 'code-morph-lab-v3',
          providerName: 'Code Morph Lab',
          providerType: 'local-app',
          source: {
            app: 'code-morph-lab-v3',
            sourceApp: handoff.source,
            sourceId: handoff.meta?.sourceId || '',
            sourceUrl: handoff.meta?.sourceUrl || '',
            morphSessionId: handoff.meta?.morphSessionId || '',
          },
          generatedAt: handoff.returnedAt || new Date().toISOString(),
          savedAt: new Date().toISOString(),
          schemaVersion: 2,
        };

        const result = await meta.saveGeneration(
          rootHandle,
          folderName,
          handoff.prompt || handoff.goal || '',
          responseHtml,
          metadata
        );
        clearPromptGalleryReturnHandoff();
        await refreshGenerations();
        navigate('view/' + result.id);
        addToast(`Saved morphed result: ${result.id}`, 'success');
      } catch (e) {
        addToast('Code Morph return failed: ' + e.message, 'error');
      } finally {
        returnHandoffBusyRef.current = false;
      }
    })();
  }, [rootHandle, refreshGenerations, navigate, addToast]);

  const loadFullGeneration = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const gen = await meta.loadGeneration(rootHandle, id);
      setSelectedGeneration(gen);
    } catch (e) {
      addToast('Failed to load generation: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  const handleSave = useCallback(async (folderName, tags, modelName) => {
    if (!rootHandle) {
      addToast('Connect a directory first', 'error');
      return;
    }
    try {
      // Re-verify write permission (persisted handles can lose access after reload)
      let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await rootHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          addToast('Write permission denied — please reconnect the directory', 'error');
          return;
        }
      }
      const metadata = meta.createMetadata(modelName, tags);
      const result = await meta.saveGeneration(rootHandle, folderName, prompt, response, metadata);
      setShowSaveDialog(false);
      setEditingId(result.folderId);
      if (result.redirectedFolder) {
        addToast(`Prompt differs — saved to new folder: ${result.redirectedFolder}`, 'info');
      } else {
        addToast(`Saved generation: ${result.folderId}`, 'success');
      }
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [rootHandle, prompt, response, addToast]);

  // Provider/model handlers
  const handleModelChange = useCallback((providerId, modelId) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    // Only explicit dropdown picks persist. Auto-picks must never touch disk.
    setPrefs(APP_ID, { provider: providerId || '', model: modelId || '' });
  }, []);

  const handleExecutorChange = useCallback((selection) => {
    if (selection.backend === 'agent') {
      const nextAgentModels = { ...agentModels, [selection.agentId]: selection.modelId || '' };
      setBackend('agent');
      setSelectedAgentId(selection.agentId);
      setAgentModels(nextAgentModels);
      setPrefs(APP_ID, { backend: 'agent', agent: selection.agentId, agentModels: nextAgentModels });
      return;
    }
    setBackend('model');
    setPrefs(APP_ID, { backend: 'model' });
    handleModelChange(selection.providerId, selection.modelId);
  }, [agentModels, handleModelChange]);

  const handleApiKeySave = useCallback((key) => {
    openrouter.saveApiKey(key);
    const hasKey = !!key;
    setApiKeySet(hasKey);
    setShowApiKeyDialog(false);
    if (hasKey) {
      addToast('API key saved (stored locally only)', 'success');
      // Refresh models from all providers
      loadModels();
    } else {
      addToast('API key removed', 'info');
      loadModels();
    }
  }, [addToast, loadModels]);

  const handleProvidersChanged = useCallback(() => {
    setApiKeySet(openrouter.hasApiKey());
    loadModels();
  }, [loadModels]);

  // promptOverride lets the prompt library run a prompt in the same tick it
  // sets state (the `prompt` value in this closure would still be stale).
  const handleGenerate = useCallback(async (promptOverride) => {
    const promptText = typeof promptOverride === 'string' ? promptOverride : prompt;
    if (!promptText.trim()) {
      addToast('Enter a prompt first', 'error');
      return;
    }
    if (backend === 'agent') {
      if (!rootHandle && !(await handlePickDirectory())) return;
    } else {
      if (!selectedModelId || !selectedProviderId) {
        addToast('Select a model first', 'error');
        return;
      }
      // Check API key for OpenRouter
      if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
        setShowApiKeyDialog(true);
        return;
      }
    }
    setIsGenerating(true);
    setResponse('');
    setCreateRunStatus(null);
    try {
      let finalHtml = '';
      if (backend === 'agent') {
        const completed = await agentRun.start({
          agentId: selectedAgentId,
          modelId: agentModels[selectedAgentId] || '',
          task: buildPromptGalleryAgentTask(promptText),
          outputFile: PROMPT_GALLERY_AGENT_OUTPUT,
          onOutput: (content) => {
            finalHtml = stripCodeFences(content);
            setResponse(finalHtml);
          },
        });
        finalHtml = stripCodeFences(completed.content);
        setResponse(finalHtml);
        const label = AGENTS.find(agent => agent.id === completed.agent)?.label || completed.agent;
        setModel(`${label}${completed.model ? ` · ${completed.model}` : ''} CLI`);
      } else {
        await openrouter.generateHtml(promptText, selectedProviderId, selectedModelId, (partial) => {
          // Strip markdown code fences if model wraps output
          const cleaned = stripCodeFences(partial);
          finalHtml = cleaned;
          setResponse(cleaned);
        });
        // Auto-set the model label
        const modelInfo = allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId);
        if (modelInfo) {
          setModel(modelInfo.displayLabel || modelInfo.name);
        }
      }
      addToast('Generation complete', 'success');
      // Ground-truth the fresh generation in the hidden sandbox so the
      // Create view can show clean/errors and offer Heal in Refine.
      if (finalHtml.trim()) {
        const token = ++createRunTokenRef.current;
        setCreateRunStatus({ running: true });
        runHtmlSandbox(finalHtml).then(status => {
          if (createRunTokenRef.current === token) setCreateRunStatus(status);
        });
      }
    } catch (e) {
      if (!agentRun.wasCancelled()) addToast('Generation failed: ' + e.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, backend, selectedProviderId, selectedModelId, selectedAgentId, agentModels, agentRun,
      rootHandle, handlePickDirectory, allModels, addToast]);

  const handleClear = useCallback(() => {
    setPrompt('');
    setResponse('');
    setModel('');
    setEditingId('');
    setCreateRunStatus(null);
    addToast('Fields cleared', 'info');
  }, [addToast]);

  // Manual edits invalidate the last sandbox verdict.
  const handleResponseChange = useCallback((value) => {
    setResponse(value);
    setCreateRunStatus(null);
  }, []);

  const handleSelectGalleryItem = useCallback((id, folderId = '') => {
    setGalleryReturnFolder(folderId || '');
    navigate('view/' + id);
  }, [navigate]);

  const handleOpenGalleryProject = useCallback((folderId) => {
    setGalleryReturnFolder(folderId);
    navigate('gallery/' + encodeURIComponent(folderId));
  }, [navigate]);

  const handleBackFromGalleryProject = useCallback(() => {
    setGalleryReturnFolder('');
    navigate('gallery');
  }, [navigate]);

  const handleUpdateMetadata = useCallback(async (id, newMeta) => {
    if (!rootHandle) return;
    try {
      await meta.updateMetadata(rootHandle, id, newMeta);
      setSelectedGeneration(prev => prev ? { ...prev, metadata: newMeta } : prev);
      // Also update in generations list
      setGenerations(prev => prev.map(g => g.id === id ? { ...g, metadata: newMeta } : g));
    } catch (e) {
      addToast('Failed to update metadata: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  const handleArchiveGenerations = useCallback(async (ids, archive) => {
    if (!rootHandle || !ids?.length) return;
    const targets = generations.filter(generation => ids.includes(generation.id));
    if (!targets.length) return;
    if (archive && targets.length > 1 && !confirm(`Archive ${targets.length} variants? They remain on disk and can be restored later.`)) return;

    const archivedAt = new Date().toISOString();
    try {
      const updates = targets.map(generation => {
        const metadata = { ...(generation.metadata || {}) };
        if (archive) metadata.archivedAt = archivedAt;
        else delete metadata.archivedAt;
        return { id: generation.id, metadata };
      });
      await Promise.all(updates.map(update => meta.updateMetadata(rootHandle, update.id, update.metadata)));
      const byId = new Map(updates.map(update => [update.id, update.metadata]));
      setGenerations(previous => previous.map(generation => byId.has(generation.id)
        ? { ...generation, metadata: byId.get(generation.id) }
        : generation));
      setSelectedGeneration(previous => previous && byId.has(previous.id)
        ? { ...previous, metadata: byId.get(previous.id) }
        : previous);
      addToast(archive
        ? `${targets.length} variant${targets.length === 1 ? '' : 's'} archived`
        : `${targets.length} variant${targets.length === 1 ? '' : 's'} restored`, 'success');
    } catch (e) {
      addToast(`Failed to ${archive ? 'archive' : 'restore'} generation: ${e.message}`, 'error');
    }
  }, [rootHandle, generations, addToast]);

  const handleEdit = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const gen = await meta.loadGeneration(rootHandle, id);
      if (gen) {
        setPrompt(gen.prompt || '');
        setResponse(gen.response || '');
        setModel(gen.metadata?.model || '');
        setEditingId(gen.folderId || id);
        navigate('create');
        addToast(`Loaded "${gen.folderId || id}" for editing`, 'info');
      }
    } catch (e) {
      addToast('Failed to load generation: ' + e.message, 'error');
    }
  }, [rootHandle, navigate, addToast]);

  const handleDelete = useCallback(async (id) => {
    if (!rootHandle) return;
    if (!confirm(`Delete "${id}"? This cannot be undone.`)) return;
    try {
      await meta.deleteGeneration(rootHandle, id);
      setGenerations(prev => prev.filter(g => g.id !== id));
      setSelectedGeneration(null);
      setSelectedId('');
      navigateToGallery();
      addToast(`Deleted "${id}"`, 'success');
    } catch (e) {
      addToast('Failed to delete: ' + e.message, 'error');
    }
  }, [rootHandle, navigateToGallery, addToast]);

  const handleCompareFromView = useCallback((id) => {
    setCompareIds(prev => prev.includes(id) ? prev : [...prev, id].slice(0, 4));
    navigate('compare');
  }, [navigate]);

  const handleMorphCurrent = useCallback(() => {
    if (!response) {
      addToast('No HTML response to morph yet', 'error');
      return;
    }
    try {
      const modelInfo = allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId);
      const modelLabel = model || modelInfo?.displayLabel || modelInfo?.name || '';
      const title = editingId || 'create-session';
      sendToCodeMorphLab({
        source: 'prompt-gallery',
        kind: 'code',
        title,
        prompt,
        files: [{ name: 'index.html', content: response }],
        language: 'html',
        meta: {
          model: modelLabel,
          createdAt: new Date().toISOString(),
          sourceId: editingId || '',
        },
      });
    } catch (e) {
      addToast('Send to Code Morph Lab failed: ' + e.message, 'error');
    }
  }, [response, prompt, editingId, model, allModels, selectedProviderId, selectedModelId, addToast]);

  const handleMorphGeneration = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const gen = await meta.loadGeneration(rootHandle, id);
      sendToCodeMorphLab({
        source: 'prompt-gallery',
        kind: 'code',
        title: gen.folderId || gen.id,
        prompt: gen.prompt,
        files: [{ name: 'index.html', content: gen.response || '' }],
        language: 'html',
        meta: { model: gen.metadata?.model, createdAt: gen.metadata?.createdAt, sourceId: gen.folderId || gen.id },
      });
    } catch (e) {
      addToast('Morph send failed: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  // ── Prompt library handlers ──

  // Load a library prompt into the Create view. editingId is set to the
  // prompt's slug so every run saves into the same folder and variants
  // accumulate per model over time.
  const handleUseLibraryPrompt = useCallback((p) => {
    setPrompt(p.prompt);
    setResponse('');
    setEditingId(library.slugify(p.title));
    navigate('create');
    addToast(`Loaded "${p.title}"`, 'info');
  }, [navigate, addToast]);

  const handleRunLibraryPrompt = useCallback((p) => {
    setPrompt(p.prompt);
    setResponse('');
    setEditingId(library.slugify(p.title));
    navigate('create');
    handleGenerate(p.prompt);
  }, [navigate, handleGenerate]);

  // Open the add/edit dialog. `initial` may be a full library prompt (edit)
  // or just { title, prompt } seeded from the Create view / a generation.
  const handleOpenPromptForm = useCallback((initial) => {
    if (!rootHandle) {
      addToast('Connect a directory first — your prompts are saved there', 'error');
      return;
    }
    setPromptForm({ initial: initial || null });
  }, [rootHandle, addToast]);

  const handlePromptFormSave = useCallback(async (data) => {
    try {
      if (promptForm?.initial?.id) {
        await library.updatePrompt(rootHandle, promptForm.initial.id, data);
        addToast(`Updated "${data.title}"`, 'success');
      } else {
        await library.addPrompt(rootHandle, data);
        addToast(`Added "${data.title}" to library`, 'success');
      }
      setPromptForm(null);
      await refreshLibrary();
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [rootHandle, promptForm, refreshLibrary, addToast]);

  const handleRemoveLibraryPrompt = useCallback(async (p) => {
    const verb = p.source === 'user'
      ? 'Move to library trash (kept in _library/library.json)?'
      : 'Hide this curated prompt? (restorable from _library/library.json)';
    if (!confirm(`"${p.title}" — ${verb}`)) return;
    try {
      await library.removePrompt(rootHandle, p.id);
      await refreshLibrary();
      addToast(p.source === 'user' ? `Moved "${p.title}" to trash` : `Hid "${p.title}"`, 'info');
    } catch (e) {
      addToast('Remove failed: ' + e.message, 'error');
    }
  }, [rootHandle, refreshLibrary, addToast]);

  // Scan saved generations + Three Prompt Lab for prompts worth keeping.
  const handleImportScan = useCallback(async () => {
    setImportScanning(true);
    try {
      const [fromGenerations, fromLab] = await Promise.all([
        library.scanGenerationPrompts(rootHandle),
        library.scanThreePromptLab(),
      ]);
      setImportItems(library.markAlreadyInLibrary([...fromGenerations, ...fromLab], libraryPrompts));
    } catch (e) {
      addToast('Import scan failed: ' + e.message, 'error');
    } finally {
      setImportScanning(false);
    }
  }, [rootHandle, libraryPrompts, addToast]);

  const handleImportConfirm = useCallback(async (selected) => {
    if (!rootHandle) {
      addToast('Connect a directory first — imported prompts are saved there', 'error');
      return;
    }
    try {
      for (const item of selected) {
        await library.addPrompt(rootHandle, item);
      }
      setImportItems(null);
      await refreshLibrary();
      addToast(`Imported ${selected.length} prompt${selected.length === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      addToast('Import failed: ' + e.message, 'error');
    }
  }, [rootHandle, refreshLibrary, addToast]);

  // ── Refine handlers ──

  // Start a refine session from any source (Create view, saved generation).
  // Confirms before discarding an existing session with unsaved steps.
  const handleOpenRefine = useCallback((source) => {
    if (refineSession && refineSession.steps.length > 1) {
      if (!confirm('Discard the current Refine session (its unsaved steps will be lost)?')) return;
    }
    setRefineSession({
      sourceId: source.sourceId || '',
      title: source.title || 'untitled',
      folderId: source.folderId || '',
      variantKey: source.variantKey || '',
      prompt: source.prompt || '',
      model: source.model || '',
      steps: [{
        kind: 'original',
        label: 'Original',
        html: source.html,
        runStatus: source.runStatus || null,
      }],
      activeIndex: 0,
      suggestions: '',
      busy: null,
      streamBytes: 0,
    });
    navigate('refine');
  }, [refineSession, navigate]);

  const handleRefineCurrent = useCallback(() => {
    if (!response) {
      addToast('Nothing to refine yet — generate or paste HTML first', 'error');
      return;
    }
    const modelInfo = allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId);
    handleOpenRefine({
      sourceId: 'create',
      title: editingId || 'create-session',
      folderId: editingId || '',
      prompt,
      model: model || modelInfo?.displayLabel || modelInfo?.name || '',
      html: response,
      runStatus: createRunStatus && !createRunStatus.running ? createRunStatus : null,
    });
  }, [response, prompt, editingId, model, allModels, selectedProviderId, selectedModelId, createRunStatus, handleOpenRefine, addToast]);

  const handleRefineGeneration = useCallback(async (id) => {
    if (!rootHandle) return;
    try {
      const gen = await meta.loadGeneration(rootHandle, id);
      if (!gen || !gen.response) {
        addToast('Generation has no HTML to refine', 'error');
        return;
      }
      handleOpenRefine({
        sourceId: id,
        title: gen.folderId || id,
        folderId: gen.folderId || '',
        variantKey: gen.variantKey || '',
        prompt: gen.prompt || '',
        model: gen.metadata?.model || '',
        html: gen.response,
      });
    } catch (e) {
      addToast('Failed to load generation: ' + e.message, 'error');
    }
  }, [rootHandle, handleOpenRefine, addToast]);

  // Toolbar "Refine" tab: refine whatever the user is currently looking at,
  // not the leftover session from an earlier screen. From the view screen it
  // seeds from the viewed generation, from Create it seeds from the current
  // response; navigating from the same source keeps the session (and steps).
  const handleRefineNav = useCallback(() => {
    if (route.name === 'view' && selectedGeneration?.response
        && refineSession?.sourceId !== selectedGeneration.id) {
      handleOpenRefine({
        sourceId: selectedGeneration.id,
        title: selectedGeneration.folderId || selectedGeneration.id,
        folderId: selectedGeneration.folderId || '',
        variantKey: selectedGeneration.variantKey || '',
        prompt: selectedGeneration.prompt || '',
        model: selectedGeneration.metadata?.model || '',
        html: selectedGeneration.response,
      });
      return;
    }
    if (route.name === 'create' && response
        && !(refineSession?.sourceId === 'create' && refineSession.steps?.[0]?.html === response)) {
      handleRefineCurrent();
      return;
    }
    navigate('refine');
  }, [route.name, selectedGeneration, response, refineSession, handleOpenRefine, handleRefineCurrent, navigate]);

  // Save a refine step as a NEW variant in the source generation's folder.
  // The original variant is never overwritten — the folder accumulates the
  // history: original → healed → improved.
  const handleSaveRefineStep = useCallback(async (stepIndex) => {
    if (!rootHandle) {
      addToast('Connect a directory first', 'error');
      return;
    }
    const sess = refineSession;
    const step = sess?.steps?.[stepIndex];
    if (!step) return;
    try {
      let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await rootHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          addToast('Write permission denied — please reconnect the directory', 'error');
          return;
        }
      }
      const folder = sess.folderId || safeFolderName(sess.title);
      const suffix = step.kind === 'heal' ? ' (healed)' : step.kind === 'improve' ? ' (improved)' : '';
      const metadata = {
        ...meta.createMetadata((sess.model || 'unknown') + suffix, [], step.summary || ''),
        derivedFrom: sess.variantKey || '',
        refine: { kind: step.kind, savedAt: new Date().toISOString() },
      };
      const result = await meta.saveGeneration(rootHandle, folder, sess.prompt || '', step.html, metadata);
      await refreshGenerations();
      if (result.redirectedFolder) {
        addToast(`Prompt differs — saved to new folder: ${result.redirectedFolder}`, 'info');
      } else {
        addToast(`Saved as new variant in "${result.folderId}"`, 'success');
      }
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [rootHandle, refineSession, refreshGenerations, addToast]);

  // ── Batch Run ──

  const selectedModelInfo = useMemo(
    () => allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId) || null,
    [allModels, selectedProviderId, selectedModelId],
  );

  const batchModel = useMemo(() => ({
    providerId: selectedProviderId,
    modelId: selectedModelId,
    label: selectedModelInfo?.displayLabel || selectedModelInfo?.name || model || '',
  }), [selectedProviderId, selectedModelId, selectedModelInfo, model]);

  // Injected operations the batch runner drives. Rebuilt when the model,
  // directory, or the generations snapshot (skip/has-run data) changes.
  const batchDeps = useMemo(() => ({
    generate: async (promptText, { onChunk } = {}) => {
      let finalHtml = '';
      await openrouter.generateHtml(promptText, selectedProviderId, selectedModelId, (partial) => {
        finalHtml = stripCodeFences(partial);
        onChunk?.(finalHtml);
      });
      return finalHtml;
    },
    runSandbox: (h) => runHtmlSandbox(h),
    heal: ({ prompt, html: htmlDoc, errors, onChunk }) =>
      healHtml({ providerId: selectedProviderId, modelId: selectedModelId, prompt, html: htmlDoc, errors, onChunk }),
    save: async ({ prompt, promptText, response, model: mdl, tags, kind, healAttempts }) => {
      const derivedTitle = prompt.title
        || (promptText.split('\n').find(l => l.trim()) || 'untitled').trim().slice(0, 60);
      const folder = library.slugify(derivedTitle);
      const note = kind === 'healed'
        ? `Batch self-heal (${healAttempts} attempt${healAttempts === 1 ? '' : 's'})`
        : 'Batch generated';
      const metadata = {
        ...meta.createMetadata(mdl.label || mdl.modelId || 'unknown', tags, note),
        modelId: mdl.modelId,
        providerId: mdl.providerId,
        aiGenerated: true,
        batch: { id: batchIdRef.current, kind, healAttempts: healAttempts || 0, generatedAt: new Date().toISOString() },
      };
      return meta.saveGeneration(rootHandle, folder, promptText, response, metadata);
    },
    hasExistingForModel: (prompt, mdl) => {
      const slug = library.slugify(prompt.title || '');
      return generations.some(g => {
        const folder = g.folderId || g.id;
        const folderMatch = folder === slug
          || (folder.startsWith(slug + '-') && /^\d+$/.test(folder.slice(slug.length + 1)));
        if (!folderMatch) return false;
        const m = g.metadata || {};
        return m.modelId === mdl.modelId || (mdl.label && m.model === mdl.label);
      });
    },
  }), [selectedProviderId, selectedModelId, rootHandle, generations]);

  const handleOpenBatch = useCallback(async () => {
    if (!rootHandle) {
      addToast('Connect a directory first — batch generations are saved there', 'error');
      handlePickDirectory();
      return;
    }
    try {
      let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await rootHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        addToast('Write permission denied — please reconnect the directory', 'error');
        return;
      }
    } catch (e) { /* fall through — save will surface any real problem */ }
    await refreshGenerations();
    batchIdRef.current = `batch-${Date.now().toString(36)}`;
    setShowBatchDialog(true);
  }, [rootHandle, handlePickDirectory, refreshGenerations, addToast]);

  const handleCloseBatch = useCallback(() => {
    setShowBatchDialog(false);
    refreshGenerations();
    refreshLibrary();
  }, [refreshGenerations, refreshLibrary]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (route.name === 'create') setShowSaveDialog(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        navigateToGallery();
      }
      if (e.key === 'Escape' && route.name === 'view') {
        e.preventDefault();
        navigateToGallery();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        // Focus toggle could be added
      }
      // Ctrl+1-5 for rating in view mode
      if ((e.ctrlKey || e.metaKey) && route.name === 'view' && selectedGeneration) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 5) {
          e.preventDefault();
          const m = selectedGeneration.metadata || {};
          handleUpdateMetadata(selectedGeneration.id, { ...m, rating: num });
          addToast(`Rating set to ${num}`, 'info');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, selectedGeneration, handleUpdateMetadata, addToast, navigateToGallery]);

  const renderContent = () => {
    switch (route.name) {
      case 'prompts':
        return html`<${PromptLibraryView}
          prompts=${libraryPrompts}
          generations=${generations}
          hasDirectory=${!!rootHandle}
          onPickDirectory=${handlePickDirectory}
          onUse=${handleUseLibraryPrompt}
          onRun=${handleRunLibraryPrompt}
          onAdd=${() => handleOpenPromptForm(null)}
          onEdit=${(p) => handleOpenPromptForm(p)}
          onRemove=${handleRemoveLibraryPrompt}
          onImport=${handleImportScan}
          importScanning=${importScanning}
          isGenerating=${isGenerating}
        />`;

      case 'refine':
        return html`<${RefineView}
          session=${refineSession}
          onSessionChange=${setRefineSession}
          hasModel=${!!(selectedProviderId && selectedModelId)}
          providerId=${selectedProviderId}
          modelId=${selectedModelId}
          hasDirectory=${!!rootHandle}
          onSaveStep=${handleSaveRefineStep}
          addToast=${addToast}
        />`;

      case 'gallery':
        return html`<${GalleryView}
          generations=${generations}
          selectedFolder=${decodeRouteParam(route.param)}
          onOpenProject=${handleOpenGalleryProject}
          onBackProject=${handleBackFromGalleryProject}
          onSelect=${handleSelectGalleryItem}
          onRefresh=${refreshGenerations}
          hasDirectory=${!!rootHandle}
          onPickDirectory=${handlePickDirectory}
          onMorph=${crossAppHandoffsEnabled() ? handleMorphGeneration : null}
          onDelete=${handleDelete}
          onArchive=${handleArchiveGenerations}
          onCompare=${handleCompareFromView}
        />`;

      case 'view':
        return html`
          <div class="view-screen">
            <div class="view-preview">
              <button class="view-back-btn" onClick=${navigateToGallery} title="Back to gallery (Esc)">
                <i class="fa-solid fa-arrow-left"></i> Back
              </button>
              ${selectedGeneration?.response
            ? html`<${ViewIframe}
                    key=${selectedGeneration.id}
                    generationId=${selectedGeneration.id}
                    html=${instrumentIframeHtml(selectedGeneration.response)}
                  />`
            : html`<div class="gallery-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading...</p></div>`
          }
            </div>
            <${MetadataPanel}
              generation=${selectedGeneration}
              response=${selectedGeneration?.response}
              onUpdateMetadata=${handleUpdateMetadata}
              onSavePromptToLibrary=${(title, promptText) => handleOpenPromptForm({ title, prompt: promptText })}
              onRefine=${handleRefineGeneration}
              onEdit=${handleEdit}
              onDelete=${handleDelete}
              onCompare=${handleCompareFromView}
              onClose=${navigateToGallery}
              allowHandoffs=${crossAppHandoffsEnabled()}
            />
          </div>
        `;

      case 'compare':
        return html`<${CompareView}
          generations=${generations}
          compareIds=${compareIds}
          onCompareIdsChange=${setCompareIds}
          onOpen=${(id) => navigate('view/' + id)}
        />`;

      case 'runs':
        return html`<${RunsView}
          generations=${generations}
          hasDirectory=${!!rootHandle}
          onPickDirectory=${handlePickDirectory}
          onOpen=${(id) => navigate('view/' + id)}
          onRefresh=${refreshGenerations}
          addToast=${addToast}
        />`;

      case 'create':
      default:
        return html`
          <div class="create-view">
            <${PromptEditor}
              prompt=${prompt}
              onPromptChange=${setPrompt}
              response=${response}
              onResponseChange=${handleResponseChange}
              theme=${theme}
              onMorph=${crossAppHandoffsEnabled() ? handleMorphCurrent : null}
              onSavePromptToLibrary=${() => handleOpenPromptForm({ prompt })}
            />
            <div class="create-right">
              <${AgentRunTrace} run=${agentRun} />
              ${response && !isGenerating && html`
                <div class="create-run-strip">
                  ${createRunStatus?.running
                    ? html`<span class="create-run-label pending"><i class="fa-solid fa-spinner fa-spin"></i> checking...</span>`
                    : createRunStatus
                      ? html`
                          <span class=${`create-run-label ${createRunStatus.errors?.length || createRunStatus.timedOut ? 'error' : 'ok'}`}>
                            <i class=${`fa-solid ${createRunStatus.errors?.length || createRunStatus.timedOut ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                            ${runStatusLabel(createRunStatus)}
                          </span>
                        `
                      : null
                  }
                  <span class="library-card-actions-spacer"></span>
                  <button class="btn btn-sm" onClick=${handleRefineCurrent} title="Open in the Refine tab to heal errors or add features">
                    <i class="fa-solid fa-screwdriver-wrench"></i>
                    ${createRunStatus && !createRunStatus.running && (createRunStatus.errors?.length || createRunStatus.timedOut)
                      ? 'Heal in Refine' : 'Refine'}
                  </button>
                </div>
              `}
              <${PreviewPane} htmlContent=${response} />
            </div>
          </div>
        `;
    }
  };

  return html`
    <${Toolbar}
      route=${route.name}
      theme=${theme}
      onNavigate=${(r) => (r === 'refine' ? handleRefineNav() : navigate(r))}
      onToggleTheme=${toggleTheme}
      onHelp=${() => setShowHelp(true)}
      onSave=${() => {
      if (!rootHandle) {
        handlePickDirectory();
        return;
      }
      setShowSaveDialog(true);
    }}
      onClear=${handleClear}
      hasDirectory=${!!rootHandle}
      directoryName=${rootHandle?.name || ''}
      onPickDirectory=${handlePickDirectory}
      allModels=${allModels.filter(m => !disabledProviders.includes(m.providerId))}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      backend=${backend}
      agentId=${selectedAgentId}
      agentModelId=${agentModels[selectedAgentId] || ''}
      onExecutorChange=${handleExecutorChange}
      onGenerate=${handleGenerate}
      onCancelAgent=${agentRun.cancel}
      agentRunning=${agentRun.running}
      agentCancelling=${agentRun.cancelling}
      isGenerating=${isGenerating}
      modelsLoading=${modelsLoading}
      hasApiKey=${apiKeySet}
      onApiKeyClick=${() => setShowApiKeyDialog(true)}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onBatch=${handleOpenBatch}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'Prompt Gallery',
        appHandle: rootHandle,
        sourceArtefactId: () => selectedGeneration?.id || editingId || null,
        metadata: () => ({
          route: window.location.hash || '#/create',
          view: route.name,
          generationId: selectedGeneration?.id || editingId || null,
          prompt: selectedGeneration?.prompt || prompt || null,
          model: selectedGeneration?.metadata?.model || model || null,
        }),
        onNeedDirectory: handlePickDirectory,
        onSaved: result => addToast(`Recording saved: ${result.path}`, 'success'),
        onDownloaded: ({ filename }) => addToast(`Downloaded ${filename}`, 'success'),
        onError: error => addToast(`Recording failed: ${error.message}`, 'error'),
      }}
    />
    ${showHelp && html`
      <${HelpDialog}
        src="./HELP.md"
        title="Prompt Gallery — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    <div class="main-content">
      ${renderContent()}
    </div>
    ${showSaveDialog && html`
      <${SaveDialog}
        onSave=${handleSave}
        onClose=${() => setShowSaveDialog(false)}
        initialName=${editingId}
        model=${model
          || allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId)?.displayLabel
          || ''}
        addToast=${addToast}
        prompt=${prompt}
        response=${response}
        providerId=${selectedProviderId}
        modelId=${selectedModelId}
      />
    `}
    ${showBatchDialog && html`
      <${BatchRunDialog}
        prompts=${libraryPrompts}
        model=${batchModel}
        allModels=${allModels.filter(m => !disabledProviders.includes(m.providerId))}
        modelsLoading=${modelsLoading}
        onModelChange=${handleModelChange}
        onProviderSettingsClick=${() => setShowProviderSettings(true)}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        deps=${batchDeps}
        onOpenGallery=${() => navigate('gallery')}
        onOpenRuns=${() => navigate('runs')}
        onClose=${handleCloseBatch}
        addToast=${addToast}
      />
    `}
    ${promptForm && html`
      <${PromptFormDialog}
        initial=${promptForm.initial}
        onSave=${handlePromptFormSave}
        onClose=${() => setPromptForm(null)}
        addToast=${addToast}
      />
    `}
    ${importItems && html`
      <${ImportPromptsDialog}
        items=${importItems}
        onImport=${handleImportConfirm}
        onClose=${() => setImportItems(null)}
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
        appId=${APP_ID}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${handleProvidersChanged}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

// Many embeds capture window.innerWidth/Height at startup and only recover via
// a 'resize' event. If the iframe boots at 0x0 (layout not settled), the natural
// resize fires before the inner script has its listener attached. Force one.
const IFRAME_RESIZE_SHIM = `<script>
(function(){
  function kick(){
    if (window.innerWidth > 0 && window.innerHeight > 0) {
      try { window.dispatchEvent(new Event('resize')); } catch(e){}
      return true;
    }
    return false;
  }
  if (!kick()) {
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if (kick() || tries > 30) clearInterval(iv);
    }, 50);
  }
  window.addEventListener('load', function(){ setTimeout(kick, 50); });
})();
<\/script>`;

function instrumentIframeHtml(html) {
  if (!html) return html;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + IFRAME_RESIZE_SHIM + html.slice(idx);
  }
  return IFRAME_RESIZE_SHIM + html;
}

// Iframe whose srcdoc is applied only after the element is laid out, so the
// inner document boots with a real window.innerWidth/innerHeight. Without this,
// content that captures viewport size at startup (e.g. THREE.js renderers)
// initialises at 0x0 and never recovers.
function ViewIframe({ generationId, html: htmlContent }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled || !node.isConnected) return;
      if (node.offsetWidth > 0 && node.offsetHeight > 0) {
        node.srcdoc = htmlContent;
      } else {
        requestAnimationFrame(apply);
      }
    };
    requestAnimationFrame(apply);
    return () => { cancelled = true; };
  }, [generationId, htmlContent]);
  return html`<iframe
    ref=${ref}
    sandbox="allow-scripts"
    title="Preview"
  />`;
}

function stripCodeFences(text) {
  let s = text;
  // Remove leading ```html or ``` and trailing ```
  s = s.replace(/^\s*```(?:html)?\s*\n?/, '');
  s = s.replace(/\n?```\s*$/, '');
  return s;
}

render(html`<${App} />`, document.getElementById('app'));

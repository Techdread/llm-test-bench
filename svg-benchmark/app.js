import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { Toolbar } from './components/Toolbar.js';
import { BatchRunDialog } from './components/BatchRunDialog.js';
import { PromptPanel } from './components/PromptPanel.js';
import { SvgEditor } from './components/SvgEditor.js';
import { SvgPreview } from './components/SvgPreview.js';
import { ReferencePanel } from './components/ReferencePanel.js';
import { ScorePanel } from './components/ScorePanel.js';
import { DiffOverlay } from './components/DiffOverlay.js';
import { BenchmarkGrid } from './components/BenchmarkGrid.js';
import { SubmissionList } from './components/SubmissionList.js';
import { CompareView } from './components/CompareView.js';
import { RunsView } from './components/RunsView.js';
import { ApiKeyDialog } from './components/ApiKeyDialog.js';
import { Toast } from './components/Toast.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { AgentRunTrace, useCodingAgentRun } from '../shared/components/CodingAgentRun.js';
import { ensureAppNamespace, getRoot, connectRoot } from '../shared/services/data-root-manager.js';
import { extractSvgText } from '../shared/services/output-sanitizer.js';
import { paramsSignature } from '../shared/services/gen-params.js';
import {
  peekCodeMorphReturnHandoff,
  clearCodeMorphReturnHandoff,
} from '../shared/services/code-morph-return-handoff.js';

const APP_ID = 'svg-benchmark';
const PREFS_DEFAULTS = { theme: 'dark', provider: '', model: '', backend: 'model', agent: 'claude-code', agentModels: {} };
import * as openrouter from './services/openrouter.js';
import { buildSvgBenchmarkAgentTask, SVG_BENCHMARK_AGENT_OUTPUT } from './services/codingAgent.js';
import { AGENTS } from '../shared/services/agent-backend.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { prefs, hydrateAppPrefs, setPref, setPrefs, subscribeAppPrefs } from '../shared/services/app-prefs.js';
import * as benchmarks from './services/benchmarks.js';
import { loadSeedPrompts } from './services/promptLibrary.js';
import { analyzeSvg, compareSvgToReference } from './services/pixeldiff.js';
import { exportSvgAsGif } from '../shared/services/gif-export.js';
import { crossAppHandoffsEnabled } from '../shared/services/distribution.js';

const CODE_MORPH_SOURCE = 'svg-benchmark';

function safeSubmissionId(value) {
  return String(value || 'code-morph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'code-morph';
}

function parseBenchmarkSlugFromUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    const match = parsed.hash.match(/^#\/benchmark\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function pickReturnedContent(payload) {
  const files = payload.files || [];
  const preferred = files.find(file => file.name === payload.entryFile);
  const candidates = [
    preferred,
    ...files.filter(file => file !== preferred && (file.name || '').endsWith('.svg')).reverse(),
    ...files.filter(file => file !== preferred && (file.name || '').endsWith('.html')).reverse(),
    ...files.filter(file => file !== preferred).reverse(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (extractSvgFromReturnedContent(candidate.content)) return candidate.content;
  }
  return candidates[0]?.content || '';
}

function extractSvgFromReturnedContent(content) {
  const text = String(content || '').trim();
  if (!text) return '';
  if (/^<svg[\s>]/i.test(text)) return text;

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const svg = doc.querySelector('svg');
    if (svg) return svg.outerHTML;
  }

  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  return match ? match[0] : '';
}

function getRoute() {
  const hash = window.location.hash || '#/create';
  const parts = hash.replace('#/', '').split('/');
  return { name: parts[0] || 'create', param: parts[1] || '', sub: parts[2] || '' };
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [theme, setTheme] = useState(() => prefs(APP_ID, { defaults: PREFS_DEFAULTS }).theme);
  const [rootHandle, setRootHandle] = useState(null);

  // Create view state
  const [prompt, setPrompt] = useState('');
  const [svgCode, setSvgCode] = useState('');
  const [referenceUrl, setReferenceUrl] = useState(null);
  const [manualScore, setManualScore] = useState(0);
  const [autoScore, setAutoScore] = useState(null);
  const [svgAnalysis, setSvgAnalysis] = useState(null);
  const [attachReference, setAttachReference] = useState(false);
  const [currentBenchmarkSlug, setCurrentBenchmarkSlug] = useState('');
  const benchmarkPromptRef = useRef('');

  // Reset benchmark slug when the prompt diverges from the one it was loaded with
  useEffect(() => {
    if (currentBenchmarkSlug && prompt !== benchmarkPromptRef.current) {
      setCurrentBenchmarkSlug('');
      benchmarkPromptRef.current = '';
    }
  }, [prompt, currentBenchmarkSlug]);

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
  const [showHelp, setShowHelp] = useState(false);
  const [lastGenerator, setLastGenerator] = useState(null);

  // Benchmarks state
  const [benchmarkList, setBenchmarkList] = useState([]);
  const [currentBenchmark, setCurrentBenchmark] = useState(null);

  // Batch run state
  const [seedPrompts, setSeedPrompts] = useState([]);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const batchIdRef = useRef('');

  // UI state
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const [showDiff, setShowDiff] = useState(false);
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
  }, [theme]);

  // Hydrate prefs from disk on mount and subscribe so post-hydrate
  // updates flow into React state.
  useEffect(() => {
    hydrateAppPrefs(APP_ID, { defaults: PREFS_DEFAULTS });
    return subscribeAppPrefs(APP_ID, (snap) => {
      if (snap.theme !== undefined) setTheme(snap.theme);
      if (snap.provider !== undefined) setSelectedProviderId(snap.provider);
      if (snap.model !== undefined) setSelectedModelId(snap.model);
    });
  }, []);

  // Load saved directory handle on startup
  useEffect(() => {
    (async () => {
      try {
        if (await getRoot()) {
          const handle = await ensureAppNamespace(APP_ID);
          setRootHandle(handle);
        }
      } catch (e) { /* user will need to pick directory */ }
    })();
  }, []);

  // Load models from all enabled providers
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

  useEffect(() => {
    loadModels().catch(() => {});
  }, []);

  // Load the seed prompt library (harvested from benchmarks) once on mount.
  useEffect(() => {
    loadSeedPrompts().then(setSeedPrompts).catch(() => {});
  }, []);

  // Persist selected provider/model
  useEffect(() => {
    const partial = {};
    if (selectedProviderId) partial.provider = selectedProviderId;
    if (selectedModelId) partial.model = selectedModelId;
    if (Object.keys(partial).length) setPrefs(APP_ID, partial);
  }, [selectedProviderId, selectedModelId]);

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
    setSelectedProviderId(selection.providerId);
    setSelectedModelId(selection.modelId);
    setPrefs(APP_ID, { backend: 'model', provider: selection.providerId, model: selection.modelId });
  }, [agentModels]);

  // Load benchmarks when directory is available and route changes
  useEffect(() => {
    if (rootHandle && (route.name === 'benchmarks' || route.name === 'benchmark')) {
      refreshBenchmarks();
    }
  }, [rootHandle, route.name]);

  // Load specific benchmark when viewing
  useEffect(() => {
    if (rootHandle && route.name === 'benchmark' && route.param) {
      loadBenchmarkDetail(route.param);
    }
  }, [rootHandle, route.name, route.param]);

  // Default the "attach reference to prompt" toggle on when a reference is
  // present, off when it's cleared.
  useEffect(() => {
    setAttachReference(!!referenceUrl);
  }, [referenceUrl]);

  // Analyze SVG when it changes
  useEffect(() => {
    if (svgCode && svgCode.trim()) {
      const analysis = analyzeSvg(svgCode);
      setSvgAnalysis(analysis);
    } else {
      setSvgAnalysis(null);
    }
  }, [svgCode]);

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

  const refreshBenchmarks = useCallback(async () => {
    if (!rootHandle) return;
    try {
      const list = await benchmarks.listBenchmarks(rootHandle);
      setBenchmarkList(list);
    } catch (e) {
      addToast('Failed to load benchmarks: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  const loadBenchmarkDetail = useCallback(async (slug) => {
    if (!rootHandle) return;
    try {
      const b = await benchmarks.loadBenchmark(rootHandle, slug);
      setCurrentBenchmark(b);
    } catch (e) {
      addToast('Failed to load benchmark: ' + e.message, 'error');
    }
  }, [rootHandle, addToast]);

  useEffect(() => {
    if (!rootHandle || returnHandoffBusyRef.current) return;
    const handoff = peekCodeMorphReturnHandoff(CODE_MORPH_SOURCE);
    if (!handoff) return;

    returnHandoffBusyRef.current = true;
    (async () => {
      try {
        let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await rootHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          addToast('Write permission denied — reconnect SVG Benchmark to receive the morphed result', 'error');
          return;
        }

        const svg = extractSvgFromReturnedContent(pickReturnedContent(handoff));
        if (!svg) throw new Error('No <svg> element found in the returned Code Morph files');

        const promptText = handoff.meta?.returnedPrompt || handoff.prompt || handoff.goal || '';
        let slug = handoff.meta?.benchmarkSlug || parseBenchmarkSlugFromUrl(handoff.meta?.sourceUrl || '');
        if (!slug) {
          if (!promptText.trim()) throw new Error('Returned payload did not include a benchmark prompt');
          slug = await benchmarks.createBenchmark(rootHandle, promptText);
        }

        const sourceId = handoff.meta?.submissionId || handoff.meta?.sourceId || handoff.meta?.morphSessionId;
        const timestamp = Date.now().toString(36);
        const submissionId = `${safeSubmissionId(`code-morph-${sourceId || 'return'}`)}-${timestamp}`;
        const analysis = analyzeSvg(svg);
        const metadata = {
          model: 'Code Morph Lab v3',
          modelId: handoff.meta?.morphModel || null,
          manualScore: 0,
          autoScore: null,
          dimensions: null,
          elementCount: analysis.elementCount,
          fileSize: analysis.fileSize,
          prompt: promptText,
          notes: handoff.meta?.requestedChanges
            ? `Returned from Code Morph Lab v3\n\nMorphed changes:\n${handoff.meta.requestedChanges}`
            : 'Returned from Code Morph Lab v3',
          submittedAt: handoff.returnedAt || new Date().toISOString(),
          source: {
            app: 'code-morph-lab-v3',
            sourceApp: handoff.source,
            sourceId: handoff.meta?.sourceId || '',
            submissionId: handoff.meta?.submissionId || '',
            sourceUrl: handoff.meta?.sourceUrl || '',
            originalPrompt: handoff.meta?.originalPrompt || '',
            requestedChanges: handoff.meta?.requestedChanges || '',
            returnedPrompt: promptText,
            renderedSvgCaptured: !!handoff.meta?.renderedSvgCaptured,
            morphSessionId: handoff.meta?.morphSessionId || '',
            morphStatus: handoff.meta?.morphStatus || '',
          },
          schemaVersion: 2,
        };

        await benchmarks.saveSubmission(rootHandle, slug, submissionId, svg, metadata);
        clearCodeMorphReturnHandoff(CODE_MORPH_SOURCE);
        await refreshBenchmarks();
        await loadBenchmarkDetail(slug);
        navigate('benchmark/' + slug);
        addToast(`Saved Code Morph return: ${submissionId}`, 'success');
      } catch (e) {
        clearCodeMorphReturnHandoff(CODE_MORPH_SOURCE);
        addToast('Code Morph return failed: ' + e.message, 'error');
      } finally {
        returnHandoffBusyRef.current = false;
      }
    })();
  }, [rootHandle, refreshBenchmarks, loadBenchmarkDetail, navigate, addToast]);

  // ── Provider/model handlers ──

  const handleModelChange = useCallback((providerId, modelId) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
  }, []);

  const handleApiKeySave = useCallback((key) => {
    openrouter.saveApiKey(key);
    const hasKey = !!key;
    setApiKeySet(hasKey);
    setShowApiKeyDialog(false);
    if (hasKey) {
      addToast('API key saved (stored locally only)', 'success');
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

  const selectedModel = allModels.find(
    m => m.providerId === selectedProviderId && m.modelId === selectedModelId
  );
  const visionSupport = openrouter.modelSupportsVision(selectedModel); // true | false | null

  const handleGenerate = useCallback(async () => {
    const hasImage = attachReference && !!referenceUrl;
    if (!prompt.trim() && !hasImage) {
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
      if (selectedProviderId === 'openrouter' && !openrouter.hasApiKey()) {
        setShowApiKeyDialog(true);
        return;
      }
      if (hasImage && openrouter.modelSupportsVision(selectedModel) === false) {
        addToast('Selected model can\'t accept images — pick a vision-capable model', 'error');
        return;
      }
    }
    setIsGenerating(true);
    setLastGenerator(null);
    setSvgCode('');
    setAutoScore(null);
    try {
      const onPartial = (partial) => setSvgCode(stripSvgFences(partial));

      if (backend === 'agent') {
        const initialFiles = hasImage
          ? [{ path: 'reference.png', content: await (await fetch(referenceUrl)).blob() }]
          : [];
        const agentModelId = agentModels[selectedAgentId] || '';
        const completed = await agentRun.start({
          agentId: selectedAgentId,
          modelId: agentModelId,
          task: buildSvgBenchmarkAgentTask(prompt, { hasReference: hasImage }),
          outputFile: SVG_BENCHMARK_AGENT_OUTPUT,
          initialFiles,
          onOutput: onPartial,
        });
        const label = AGENTS.find(agent => agent.id === completed.agent)?.label || completed.agent;
        setSvgCode(stripSvgFences(completed.content));
        setLastGenerator({
          type: 'agent',
          agentId: completed.agent,
          modelId: completed.model || null,
          label: `${label}${completed.model ? ` · ${completed.model}` : ''} CLI`,
          runId: completed.runId,
        });
        addToast('SVG generation complete', 'success');
        return;
      }

      if (hasImage) {
        await openrouter.generateSvgWithImage(prompt, referenceUrl, selectedProviderId, selectedModelId, onPartial);
      } else {
        await openrouter.generateSvg(prompt, selectedProviderId, selectedModelId, onPartial);
      }
      addToast('SVG generation complete', 'success');
    } catch (e) {
      if (!agentRun.wasCancelled()) addToast('Generation failed: ' + e.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, backend, selectedProviderId, selectedModelId, selectedModel, selectedAgentId, agentModels,
      agentRun, rootHandle, handlePickDirectory, attachReference, referenceUrl, addToast]);

  // ── Save handlers ──

  const handleSaveSubmission = useCallback(async () => {
    if (!rootHandle) {
      handlePickDirectory();
      return;
    }
    if (!svgCode.trim()) {
      addToast('No SVG code to save', 'error');
      return;
    }
    if (!prompt.trim()) {
      addToast('Enter a prompt first', 'error');
      return;
    }

    try {
      // Create benchmark if needed
      let slug = currentBenchmarkSlug;
      if (!slug) {
        slug = await benchmarks.createBenchmark(rootHandle, prompt);
        setCurrentBenchmarkSlug(slug);
        benchmarkPromptRef.current = prompt;
      }

      // Save reference if we have one
      if (referenceUrl) {
        await benchmarks.saveReference(rootHandle, slug, referenceUrl);
      }

      // Model slug for filename
      const modelInfo = allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId);
      const modelName = lastGenerator?.type === 'agent'
        ? lastGenerator.label
        : modelInfo?.displayLabel || modelInfo?.name || selectedModelId || 'manual';
      const modelSlug = modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const timestamp = Date.now().toString(36);
      const submissionId = `${modelSlug}-${timestamp}`;

      const analysis = analyzeSvg(svgCode);
      const metadata = {
        model: modelName,
        modelId: lastGenerator?.type === 'agent' ? lastGenerator.modelId : selectedModelId || null,
        providerId: lastGenerator?.type === 'agent' ? `cli-agent:${lastGenerator.agentId}` : selectedProviderId || null,
        agentRunId: lastGenerator?.type === 'agent' ? lastGenerator.runId : null,
        manualScore: manualScore || 0,
        autoScore: autoScore,
        dimensions: null,
        elementCount: analysis.elementCount,
        fileSize: analysis.fileSize,
        notes: '',
        submittedAt: new Date().toISOString(),
      };

      await benchmarks.saveSubmission(rootHandle, slug, submissionId, svgCode, metadata);
      addToast(`Saved submission: ${modelName}`, 'success');
    } catch (e) {
      addToast('Save failed: ' + e.message, 'error');
    }
  }, [rootHandle, svgCode, prompt, referenceUrl, currentBenchmarkSlug, selectedModelId, selectedProviderId, allModels, manualScore, autoScore, lastGenerator, addToast, handlePickDirectory]);

  const handleRunAutoScore = useCallback(async () => {
    if (!svgCode || !referenceUrl) {
      addToast('Need both SVG and reference image for auto-scoring', 'error');
      return;
    }
    try {
      const result = await compareSvgToReference(svgCode, referenceUrl);
      setAutoScore(result.score);
      addToast(`Auto score: ${Math.round(result.score * 100)}%`, 'success');
    } catch (e) {
      addToast('Auto-scoring failed: ' + e.message, 'error');
    }
  }, [svgCode, referenceUrl, addToast]);

  const handleClear = useCallback(() => {
    setPrompt('');
    setSvgCode('');
    setReferenceUrl(null);
    setManualScore(0);
    setAutoScore(null);
    setSvgAnalysis(null);
    setCurrentBenchmarkSlug('');
    setLastGenerator(null);
    setShowDiff(false);
    addToast('Fields cleared', 'info');
  }, [addToast]);

  const handleExportGif = useCallback(async () => {
    if (!svgCode.trim()) {
      addToast('No SVG to export', 'error');
      return;
    }
    try {
      await exportSvgAsGif(svgCode, { prefix: 'svg-benchmark' });
      addToast('GIF exported', 'success');
    } catch (e) {
      addToast('GIF export failed: ' + e.message, 'error');
    }
  }, [svgCode, addToast]);

  const handleExportSvg = useCallback(() => {
    if (!svgCode.trim()) {
      addToast('No SVG to export', 'error');
      return;
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const blob = new Blob([svgCode], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `svg-benchmark-${stamp}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('SVG exported', 'success');
  }, [svgCode, addToast]);

  // ── Benchmark handlers ──

  const handleCreateNewBenchmark = useCallback(() => {
    handleClear();
    navigate('create');
  }, [handleClear, navigate]);

  const handleSelectBenchmark = useCallback((slug) => {
    navigate('benchmark/' + slug);
  }, [navigate]);

  const handleAddSubmission = useCallback(() => {
    if (currentBenchmark) {
      setPrompt(currentBenchmark.prompt || '');
      setReferenceUrl(currentBenchmark.referenceUrl || null);
      setCurrentBenchmarkSlug(currentBenchmark.slug);
      benchmarkPromptRef.current = currentBenchmark.prompt || '';
      setSvgCode('');
      setManualScore(0);
      setAutoScore(null);
      navigate('create');
    }
  }, [currentBenchmark, navigate]);

  const handleDeleteSubmission = useCallback(async (submissionId) => {
    if (!rootHandle || !currentBenchmark) return;
    if (!confirm(`Delete submission "${submissionId}"?`)) return;
    try {
      await benchmarks.deleteSubmission(rootHandle, currentBenchmark.slug, submissionId);
      await loadBenchmarkDetail(currentBenchmark.slug);
      addToast('Submission deleted', 'success');
    } catch (e) {
      addToast('Delete failed: ' + e.message, 'error');
    }
  }, [rootHandle, currentBenchmark, loadBenchmarkDetail, addToast]);

  const handleDeleteBenchmark = useCallback(async () => {
    if (!rootHandle || !currentBenchmark) return;
    if (!confirm(`Delete benchmark "${currentBenchmark.prompt || currentBenchmark.slug}"? This cannot be undone.`)) return;
    try {
      await benchmarks.deleteBenchmark(rootHandle, currentBenchmark.slug);
      setCurrentBenchmark(null);
      navigate('benchmarks');
      addToast('Benchmark deleted', 'success');
    } catch (e) {
      addToast('Delete failed: ' + e.message, 'error');
    }
  }, [rootHandle, currentBenchmark, navigate, addToast]);

  // ── Batch Run ──

  // Prompts to offer: the harvested seed library merged with any live
  // benchmarks (keyed by slug; live data wins for submission counts/models).
  const batchPrompts = useMemo(() => {
    const bySlug = new Map();
    for (const s of seedPrompts) {
      bySlug.set(s.slug, {
        slug: s.slug, title: s.title, prompt: s.prompt,
        category: s.category, difficulty: s.difficulty,
        existingSubmissions: s.existingSubmissions || 0, submissionModels: [],
      });
    }
    for (const b of benchmarkList) {
      const existing = bySlug.get(b.slug);
      bySlug.set(b.slug, {
        slug: b.slug,
        title: existing?.title || deriveTitle(b.prompt, b.slug),
        prompt: b.prompt || existing?.prompt || '',
        category: b.meta?.category || existing?.category || 'general',
        difficulty: b.meta?.difficulty || existing?.difficulty || 'moderate',
        existingSubmissions: b.submissionCount || 0,
        submissionModels: b.submissionModels || [],
      });
    }
    return Array.from(bySlug.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [seedPrompts, benchmarkList]);

  const batchModelInfo = useMemo(
    () => allModels.find(m => m.providerId === selectedProviderId && m.modelId === selectedModelId) || null,
    [allModels, selectedProviderId, selectedModelId],
  );
  const batchModel = useMemo(() => ({
    providerId: selectedProviderId,
    modelId: selectedModelId,
    label: batchModelInfo?.displayLabel || batchModelInfo?.name || selectedModelId || '',
  }), [selectedProviderId, selectedModelId, batchModelInfo]);

  const batchDeps = useMemo(() => ({
    ensureBenchmark: async (p) => {
      const slug = p.slug || benchmarks.slugify(p.prompt);
      const exists = benchmarkList.some(b => b.slug === slug);
      if (!exists) await benchmarks.createBenchmark(rootHandle, p.prompt, p.category, p.difficulty);
      return slug;
    },
    generate: async (promptText, { onChunk, params, onStats } = {}) => {
      let final = '';
      await openrouter.generateSvg(promptText, selectedProviderId, selectedModelId, (partial) => {
        final = stripSvgFences(partial);
        onChunk?.(final);
      }, { params, onStats });
      return final;
    },
    validate: (svg) => validateSvg(svg),
    heal: async ({ prompt, svg, reason, params, onChunk }) => {
      const out = await openrouter.healSvg(prompt, svg, reason, selectedProviderId, selectedModelId,
        (partial) => onChunk?.(stripSvgFences(partial)), { params });
      return stripSvgFences(out);
    },
    score: async (svg, slug) => {
      let ref = null;
      try { ref = await benchmarks.loadReference(rootHandle, slug); } catch (e) { ref = null; }
      if (!ref) return null;
      try { const r = await compareSvgToReference(svg, ref); return r.score; } catch (e) { return null; }
    },
    save: async ({ prompt, svg, model: mdl, slug, autoScore, kind, healed, healAttempts, valid, params, stats }) => {
      const modelSlug = (mdl.label || mdl.modelId || 'manual')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const submissionId = `${modelSlug}-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const analysis = analyzeSvg(svg);
      const metadata = {
        model: mdl.label || mdl.modelId || 'unknown',
        modelId: mdl.modelId || null,
        manualScore: 0,
        autoScore: autoScore ?? null,
        dimensions: null,
        elementCount: analysis.elementCount,
        fileSize: analysis.fileSize,
        tags: ['ai-gen', 'batch'],
        aiGenerated: true,
        valid: valid !== false,
        notes: kind === 'healed'
          ? `Batch auto-fixed (${healAttempts} attempt${healAttempts === 1 ? '' : 's'})`
          : 'Batch generated',
        submittedAt: new Date().toISOString(),
        batch: { id: batchIdRef.current, kind, healed: !!healed, healAttempts: healAttempts || 0 },
        // What was asked for, and what actually happened — the raw material for
        // "which settings suit this model+quant".
        params: params && Object.keys(params).length ? params : null,
        paramsLabel: paramsSignature(params || {}),
        stats: stats || null,
      };
      await benchmarks.saveSubmission(rootHandle, slug, submissionId, svg, metadata);
      return { id: submissionId };
    },
    listRuns: async () => {
      const runs = await benchmarks.listBatchRuns(rootHandle);
      return runs.map(r => ({
        ...r,
        items: r.items.map(it => ({ ...it, title: deriveTitle(it.prompt, it.slug) })),
      }));
    },
    loadRunSvgs: (items) => benchmarks.loadRunSvgs(rootHandle, items),
    hasExistingForModel: (p, mdl) => {
      const slug = p.slug || benchmarks.slugify(p.prompt);
      const b = benchmarkList.find(x => x.slug === slug);
      if (!b || !b.submissionModels) return false;
      return b.submissionModels.some(m =>
        (mdl.modelId && m.modelId === mdl.modelId) || (mdl.label && m.model === mdl.label));
    },
  }), [selectedProviderId, selectedModelId, rootHandle, benchmarkList]);

  // Past Runs view only needs to read runs + their SVGs from disk.
  const runsDeps = useMemo(() => ({
    listRuns: async () => {
      const runs = await benchmarks.listBatchRuns(rootHandle);
      return runs.map(r => ({
        ...r,
        items: r.items.map(it => ({ ...it, title: deriveTitle(it.prompt, it.slug) })),
      }));
    },
    loadRunSvgs: (items) => benchmarks.loadRunSvgs(rootHandle, items),
  }), [rootHandle]);

  const handleOpenBatch = useCallback(async () => {
    if (!rootHandle) {
      addToast('Connect a directory first — batch submissions are saved there', 'error');
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
    await refreshBenchmarks();
    batchIdRef.current = `batch-${Date.now().toString(36)}`;
    setShowBatchDialog(true);
  }, [rootHandle, handlePickDirectory, refreshBenchmarks, addToast]);

  const handleCloseBatch = useCallback(() => {
    setShowBatchDialog(false);
    refreshBenchmarks();
  }, [refreshBenchmarks]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (route.name === 'create') handleSaveSubmission();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        navigate('benchmarks');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        setShowDiff(d => !d);
      }
      // 1-9 for manual score in create mode
      if (route.name === 'create' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT' && !e.target.closest('.ace_editor')) {
          setManualScore(num);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, handleSaveSubmission, navigate]);

  // ── Render ──

  const renderContent = () => {
    switch (route.name) {
      case 'benchmarks':
        return html`<${BenchmarkGrid}
          benchmarks=${benchmarkList}
          onSelect=${handleSelectBenchmark}
          onCreateNew=${handleCreateNewBenchmark}
          onRefresh=${refreshBenchmarks}
          hasDirectory=${!!rootHandle}
          onPickDirectory=${handlePickDirectory}
        />`;

      case 'runs':
        return html`<${RunsView}
          deps=${runsDeps}
          hasDirectory=${!!rootHandle}
          onPickDirectory=${handlePickDirectory}
          onOpenBenchmark=${(slug) => navigate('benchmark/' + slug)}
          addToast=${addToast}
        />`;

      case 'benchmark':
        if (route.sub === 'compare' && currentBenchmark) {
          return html`<${CompareView}
            submissions=${currentBenchmark.submissions}
            referenceUrl=${currentBenchmark.referenceUrl}
            benchmarkPrompt=${currentBenchmark.prompt}
            onBack=${() => navigate('benchmark/' + route.param)}
          />`;
        }
        return html`<${SubmissionList}
          benchmark=${currentBenchmark}
          submissions=${currentBenchmark?.submissions}
          onBack=${() => navigate('benchmarks')}
          onAddSubmission=${handleAddSubmission}
          onCompare=${() => navigate('benchmark/' + route.param + '/compare')}
          onSelectSubmission=${(id) => {
            // Load submission into create view for viewing
            const sub = currentBenchmark?.submissions?.find(s => s.id === id);
            if (sub) {
              const submissionPrompt = sub.prompt || currentBenchmark.prompt || '';
              setPrompt(submissionPrompt);
              setSvgCode(sub.svg || '');
              setReferenceUrl(currentBenchmark.referenceUrl || null);
              setManualScore(sub.manualScore || 0);
              setAutoScore(sub.autoScore || null);
              setCurrentBenchmarkSlug(currentBenchmark.slug);
              benchmarkPromptRef.current = submissionPrompt;
              navigate('create');
            }
          }}
          onDeleteSubmission=${handleDeleteSubmission}
          onDeleteBenchmark=${handleDeleteBenchmark}
          allowHandoffs=${crossAppHandoffsEnabled()}
        />`;

      case 'create':
      default:
        return html`
          <div class="create-view">
            <div class="create-left">
              <${PromptPanel}
                prompt=${prompt}
                onPromptChange=${setPrompt}
                onGenerate=${handleGenerate}
                isGenerating=${isGenerating}
              />
              <${AgentRunTrace} run=${agentRun} />
              <${SvgEditor}
                value=${svgCode}
                onChange=${setSvgCode}
                theme=${theme}
              />
            </div>
            <div class="create-center">
              <${SvgPreview} svgContent=${svgCode} />
              ${showDiff && referenceUrl && svgCode && html`
                <${DiffOverlay}
                  svgContent=${svgCode}
                  referenceUrl=${referenceUrl}
                  onScoreComputed=${(s) => setAutoScore(s)}
                />
              `}
            </div>
            <div class="create-right">
              <${ReferencePanel}
                referenceUrl=${referenceUrl}
                onReferenceChange=${setReferenceUrl}
                attachReference=${attachReference}
                onToggleAttach=${setAttachReference}
                visionSupport=${visionSupport}
              />
              <${ScorePanel}
                autoScore=${autoScore}
                manualScore=${manualScore}
                svgAnalysis=${svgAnalysis}
                onManualScoreChange=${setManualScore}
                onRunAutoScore=${referenceUrl ? handleRunAutoScore : null}
              />
            </div>
          </div>
          <div class="create-bottom-bar">
            <div class="bottom-bar-left">
              ${referenceUrl && html`
                <button class=${`btn btn-sm ${showDiff ? 'btn-primary' : ''}`} onClick=${() => setShowDiff(d => !d)}>
                  <i class="fa-solid fa-layer-group"></i>
                  <span class="btn-label">Diff (Ctrl+D)</span>
                </button>
              `}
            </div>
            <div class="bottom-bar-right">
              <button class="btn" onClick=${handleExportSvg} title="Export as SVG" disabled=${!svgCode.trim()}>
                <i class="fa-solid fa-file-code"></i>
                <span class="btn-label">SVG</span>
              </button>
              <button class="btn" onClick=${handleExportGif} title="Export as GIF" disabled=${!svgCode.trim()}>
                <i class="fa-solid fa-file-image"></i>
                <span class="btn-label">GIF</span>
              </button>
              <button class="btn" onClick=${handleClear}>
                <i class="fa-solid fa-eraser"></i>
                <span class="btn-label">Clear</span>
              </button>
              <button class="btn btn-primary" onClick=${handleSaveSubmission} title="Save (Ctrl+S)">
                <i class="fa-solid fa-floppy-disk"></i>
                <span class="btn-label">Save</span>
              </button>
            </div>
          </div>
        `;
    }
  };

  return html`
    <${Toolbar}
      route=${route.name}
      theme=${theme}
      onNavigate=${navigate}
      onToggleTheme=${toggleTheme}
      hasDirectory=${!!rootHandle}
      onPickDirectory=${handlePickDirectory}
      allModels=${allModels}
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
      onHelpClick=${() => setShowHelp(true)}
      onBatch=${handleOpenBatch}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'SVG Benchmark',
        appHandle: rootHandle,
        sourceArtefactId: () => currentBenchmarkSlug || route.param || null,
        metadata: () => ({
          route: window.location.hash || '#/create',
          view: route.name,
          benchmarkSlug: currentBenchmarkSlug || route.param || null,
          benchmarkTitle: currentBenchmark?.title || null,
          prompt: currentBenchmark?.prompt || prompt || null,
          manualScore,
          autoScore,
          providerId: selectedProviderId || null,
          modelId: selectedModelId || null,
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
        prompts=${batchPrompts}
        model=${batchModel}
        allModels=${allModels}
        modelsLoading=${modelsLoading}
        onModelChange=${handleModelChange}
        onProviderSettingsClick=${() => setShowProviderSettings(true)}
        hasDirectory=${!!rootHandle}
        onPickDirectory=${handlePickDirectory}
        deps=${batchDeps}
        onOpenBenchmarks=${() => navigate('benchmarks')}
        onOpenBenchmark=${(slug) => { handleCloseBatch(); navigate('benchmark/' + slug); }}
        onOpenRuns=${() => { handleCloseBatch(); navigate('runs'); }}
        onClose=${handleCloseBatch}
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
        title="SVG Benchmark — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

// Thinking models wrap their monologue in <think>…</think> ahead of the markup,
// which used to survive into the saved SVG and fail validation. extractSvgText
// strips think tokens and code fences, then pulls out the <svg> element.
// Mid-stream (no closing </svg> yet) it falls back to the sanitized text, so the
// live preview still updates.
function stripSvgFences(text) {
  return extractSvgText(String(text || ''));
}

// A friendly title for a benchmark prompt: the "Name:" prefix if there is one,
// otherwise the slug title-cased.
function deriveTitle(prompt, slug) {
  const p = String(prompt || '').trim();
  if (p.includes(':')) {
    const head = p.split(':', 1)[0].trim();
    if (head && head.length <= 40 && !head.includes('.')) return head;
  }
  const t = String(slug || '').replace(/-/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Untitled';
}

// Validity check used by the batch runner to decide whether to auto-fix an SVG.
function validateSvg(svg) {
  const text = String(svg || '').trim();
  if (!/<svg[\s>]/i.test(text)) return { ok: false, reason: 'No <svg> element found in the output' };
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) return { ok: false, reason: 'SVG failed to parse: ' + (err.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
  } catch (e) {
    return { ok: false, reason: 'SVG parse threw: ' + e.message };
  }
  return { ok: true, reason: '' };
}

render(html`<${App} />`, document.getElementById('app'));

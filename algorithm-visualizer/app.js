// Algorithm Visualizer — entry point. Top-level state, orchestrates trace
// runs (JS / Python), kind detection, snapshot stepping, session persistence.

import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { AlgoEditor } from './components/AlgoEditor.js';
import { VisualisationCanvas } from './components/VisualisationCanvas.js';
import { VariablesPanel } from './components/VariablesPanel.js';
import { Timeline } from './components/Timeline.js';
import { SessionsDialog } from './components/SessionsDialog.js';
import { ApiKeyDialog } from '../shader-lab/components/ApiKeyDialog.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';

import { traceJs, buildSnapshots } from './services/instrumentJs.js';
import { tracePy } from './services/instrumentPy.js';
import { detectKind } from './services/kindDetector.js';
import { PRESETS, listPresetsForLanguage, getPreset } from './services/presets.js';
import * as sessionStore from './services/sessionStore.js';
import * as llm from './services/openrouter.js';
import * as modelProviders from '../shared/services/model-providers.js';

const APP_ID = 'algorithm-visualizer';

function App() {
  // ── Theme ──
  const [theme, setTheme] = useState(() => localStorage.getItem(`${APP_ID}-theme`) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(`${APP_ID}-theme`, theme);
  }, [theme]);

  // ── Source & language ──
  const [language, setLanguage] = useState(() => localStorage.getItem(`${APP_ID}-language`) || 'js');
  const [presetId, setPresetId] = useState('bubble-sort');
  const [source, setSource] = useState(() => {
    return localStorage.getItem(`${APP_ID}-source`) || getPreset('bubble-sort').sources.js;
  });
  const [sessionName, setSessionName] = useState('Untitled session');
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => { localStorage.setItem(`${APP_ID}-language`, language); }, [language]);
  useEffect(() => { localStorage.setItem(`${APP_ID}-source`, source); }, [source]);

  // ── Data root ──
  const [hasRoot, setHasRoot] = useState(false);
  useEffect(() => { sessionStore.hasRoot().then(setHasRoot); }, []);

  // ── Trace state ──
  const [events, setEvents] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [traceError, setTraceError] = useState(null);
  const [overrun, setOverrun] = useState(false);
  const [running, setRunning] = useState(false);
  const [traceVars, setTraceVars] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState(null);

  // ── Playback ──
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playRef = useRef(null);

  useEffect(() => {
    if (!playing || snapshots.length === 0) return;
    const interval = Math.max(16, 160 / speed);
    playRef.current = setInterval(() => {
      setIndex(i => {
        if (i >= snapshots.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, interval);
    return () => clearInterval(playRef.current);
  }, [playing, speed, snapshots.length]);

  // ── Kind / mapping ──
  const [kind, setKind] = useState('array');
  const [mapping, setMapping] = useState({ array: 'arr', cursors: ['i', 'j'] });
  const [detecting, setDetecting] = useState(false);
  const [useLLM, setUseLLM] = useState(() => localStorage.getItem(`${APP_ID}-use-llm`) !== '0');
  useEffect(() => { localStorage.setItem(`${APP_ID}-use-llm`, useLLM ? '1' : '0'); }, [useLLM]);

  // ── LLM providers ──
  const [apiKeyPresent, setApiKeyPresent] = useState(() => llm.hasApiKey());
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const initSel = modelProviders.getEffectiveSelection(`${APP_ID}-provider`, `${APP_ID}-model`);
  const [selectedProviderId, setSelectedProviderId] = useState(initSel.provider);
  const [selectedModelId, setSelectedModelId] = useState(initSel.model);
  useEffect(() => {
    if (selectedProviderId) localStorage.setItem(`${APP_ID}-provider`, selectedProviderId);
    if (selectedModelId) localStorage.setItem(`${APP_ID}-model`, selectedModelId);
  }, [selectedProviderId, selectedModelId]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
      if (!selectedProviderId && models.length > 0) {
        setSelectedProviderId(models[0].providerId);
        setSelectedModelId(models[0].modelId);
      }
    } catch (e) { console.warn('model load failed', e); }
    finally { setModelsLoading(false); }
  }, [selectedProviderId]);
  useEffect(() => { loadModels(); }, []);

  // ── Presets / language switch ──
  const presetsForLang = useMemo(() => listPresetsForLanguage(language), [language]);
  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang);
    const candidate = getPreset(presetId);
    if (candidate && candidate.languages.includes(lang)) {
      setSource(candidate.sources[lang]);
    } else {
      const first = listPresetsForLanguage(lang)[0];
      if (first) { setPresetId(first.id); setSource(first.sources[lang]); }
      else { setPresetId(''); }
    }
  }, [presetId]);

  const handlePresetChange = useCallback((id) => {
    setPresetId(id);
    if (!id) return;
    const p = getPreset(id);
    if (!p) return;
    const src = p.sources[language] || p.sources.js;
    if (src) setSource(src);
    if (p.hint) {
      setKind(p.hint.kind);
      setMapping({ ...p.hint.mapping });
    }
  }, [language]);

  // ── Run ──
  const handleRun = useCallback(async () => {
    setRunning(true);
    setTraceError(null);
    setOverrun(false);
    setStatus({ kind: 'info', message: language === 'python' ? 'Tracing Python…' : 'Tracing JavaScript…' });
    try {
      let result;
      if (language === 'python') {
        result = await tracePy(source, {
          onProgress: (msg) => setStatus({ kind: 'info', message: msg }),
        });
      } else {
        result = traceJs(source);
      }
      if (result.error) {
        setTraceError(result.error);
        setEvents([]); setSnapshots([]); setTraceVars([]); setIndex(0);
        setStatus({ kind: 'error', message: result.error });
      } else {
        const snaps = buildSnapshots(result.events);
        setEvents(result.events);
        setSnapshots(snaps);
        setTraceVars(result.vars || []);
        setIndex(snaps.length > 0 ? 0 : 0);
        setOverrun(result.overrun);
        setStatus({
          kind: result.overrun ? 'error' : 'info',
          message: `${result.events.length.toLocaleString()} events${result.overrun ? ' — truncated!' : ''}`,
        });
      }
    } catch (err) {
      setTraceError(err.message || String(err));
      setStatus({ kind: 'error', message: err.message || String(err) });
    } finally {
      setRunning(false);
    }
  }, [source, language]);

  // ── Detect ──
  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      setStatus({ kind: 'info', message: useLLM ? 'Asking model to classify…' : 'Detecting…' });
      const result = await detectKind({
        source, language,
        providerId: selectedProviderId, modelId: selectedModelId,
        useLLM: useLLM && apiKeyPresent,
      });
      setKind(result.kind);
      setMapping(result.mapping || {});
      setStatus({
        kind: result.llmError ? 'error' : 'info',
        message: result.llmError
          ? `LLM failed, used heuristic (${result.kind}): ${result.llmError}`
          : `Detected via ${result.source}: ${result.kind}`,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err.message || String(err) });
    } finally {
      setDetecting(false);
    }
  }, [source, language, selectedProviderId, selectedModelId, useLLM, apiKeyPresent]);

  // Auto-detect on first run — if there's already a preset hint, use it.
  useEffect(() => {
    const p = getPreset(presetId);
    if (p && p.hint) { setKind(p.hint.kind); setMapping({ ...p.hint.mapping }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snapshot → current view ──
  const currentSnapshot = snapshots[index] || null;

  // ── Sessions ──
  const [sessions, setSessions] = useState([]);
  const [showSessions, setShowSessions] = useState(false);
  const refreshSessions = useCallback(async () => {
    if (!hasRoot) return;
    setSessions(await sessionStore.listSessions());
  }, [hasRoot]);
  useEffect(() => { refreshSessions(); }, [hasRoot, refreshSessions]);

  const handlePickRoot = useCallback(async () => {
    try { await sessionStore.pickRoot(); setHasRoot(true); refreshSessions(); }
    catch (e) { if (e.name !== 'AbortError') alert('Failed to pick directory: ' + e.message); }
  }, [refreshSessions]);

  const handleSave = useCallback(async () => {
    if (!hasRoot) return;
    try {
      const saved = await sessionStore.saveSession({
        id: sessionId || undefined,
        name: sessionName,
        language,
        source,
        kind,
        mapping,
      });
      setSessionId(saved.id);
      refreshSessions();
      setStatus({ kind: 'info', message: `Saved as "${saved.name}".` });
    } catch (e) {
      setStatus({ kind: 'error', message: 'Save failed: ' + e.message });
    }
  }, [hasRoot, sessionId, sessionName, language, source, kind, mapping, refreshSessions]);

  const handleOpenSession = useCallback((s) => {
    setSessionId(s.id);
    setSessionName(s.name);
    setLanguage(s.language || 'js');
    setSource(s.source || '');
    if (s.kind) setKind(s.kind);
    if (s.mapping) setMapping(s.mapping);
    setPresetId('');
    setShowSessions(false);
    setEvents([]); setSnapshots([]); setIndex(0);
  }, []);

  const handleDeleteSession = useCallback(async (id) => {
    await sessionStore.deleteSession(id);
    refreshSessions();
    if (sessionId === id) setSessionId(null);
  }, [refreshSessions, sessionId]);

  // ── Help ──
  const [showHelp, setShowHelp] = useState(false);

  // ── Stepping controls ──
  const handleSeek = useCallback((i) => {
    setIndex(Math.max(0, Math.min(snapshots.length - 1, i)));
    setPlaying(false);
  }, [snapshots.length]);
  const handleStep = useCallback((delta) => {
    setIndex(i => Math.max(0, Math.min(snapshots.length - 1, i + delta)));
    setPlaying(false);
  }, [snapshots.length]);
  const handleReset = useCallback(() => { setIndex(0); setPlaying(false); }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === 'ArrowRight') handleStep(e.shiftKey ? 10 : 1);
      else if (e.key === 'ArrowLeft') handleStep(e.shiftKey ? -10 : -1);
      else if (e.key === 'Home') handleReset();
      else if (e.key === 'End') setIndex(snapshots.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleStep, handleReset, snapshots.length]);

  return html`
    <${Toolbar}
      theme=${theme}
      onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      language=${language}
      onLanguageChange=${handleLanguageChange}
      presetId=${presetId}
      presets=${presetsForLang}
      onPresetChange=${handlePresetChange}
      hasRoot=${hasRoot}
      onPickRoot=${handlePickRoot}
      onOpenSessions=${() => setShowSessions(true)}
      onSave=${handleSave}
      allModels=${allModels}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      onModelChange=${(p, m) => { setSelectedProviderId(p); setSelectedModelId(m); }}
      apiKeySet=${apiKeyPresent}
      onApiKeyClick=${() => setShowApiKeyDialog(true)}
      modelsLoading=${modelsLoading}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      sessionName=${sessionName}
      onRename=${setSessionName}
      onDetect=${handleDetect}
      detecting=${detecting}
      useLLM=${useLLM}
      onToggleUseLLM=${setUseLLM}
      onRun=${handleRun}
      running=${running}
      status=${status}
      onHelpClick=${() => setShowHelp(true)}
    />
    <div class="app-body split">
      <div class="pane pane-source">
        <div class="pane-header">
          <span>Source</span>
          <div class="spacer"></div>
          ${overrun && html`<span class="warning-chip">Trace truncated at 50k events</span>`}
        </div>
        <div class="pane-body">
          <${AlgoEditor}
            value=${source}
            language=${language}
            theme=${theme}
            onChange=${(v) => { setSource(v); setPresetId(''); }}
            currentLine=${currentSnapshot?.line}
          />
        </div>
      </div>
      <div class="pane pane-viz">
        <div class="pane-header">
          <span>Visualisation · ${kind}</span>
          <div class="spacer"></div>
          ${traceError && html`<span class="err-chip"><i class="fa-solid fa-triangle-exclamation"></i> ${traceError}</span>`}
        </div>
        <div class="pane-body">
          <${VisualisationCanvas}
            snapshot=${currentSnapshot}
            kind=${kind}
            mapping=${mapping}
            theme=${theme}
          />
        </div>
        <${Timeline}
          total=${snapshots.length}
          index=${index}
          onSeek=${handleSeek}
          playing=${playing}
          onPlayToggle=${() => setPlaying(p => !p)}
          onStep=${handleStep}
          onReset=${handleReset}
          speed=${speed}
          onSpeedChange=${setSpeed}
          message=${traceError ? 'Trace failed' : null}
        />
      </div>
      <div class="pane pane-vars">
        <div class="pane-header"><span>Variables</span></div>
        <div class="pane-body" style=${{ overflow: 'auto' }}>
          <${VariablesPanel}
            snapshot=${currentSnapshot}
            mapping=${mapping}
            kind=${kind}
            vars=${traceVars}
            onRemap=${setMapping}
          />
        </div>
      </div>
    </div>
    ${showSessions && html`
      <${SessionsDialog}
        sessions=${sessions}
        onOpen=${handleOpenSession}
        onDelete=${handleDeleteSession}
        onClose=${() => setShowSessions(false)}
      />
    `}
    ${showApiKeyDialog && html`
      <${ApiKeyDialog}
        currentKey=${llm.getApiKey()}
        onSave=${(key) => {
          llm.saveApiKey(key);
          setApiKeyPresent(!!key);
          setShowApiKeyDialog(false);
          if (key) loadModels();
        }}
        onClose=${() => setShowApiKeyDialog(false)}
      />
    `}
    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${() => { setApiKeyPresent(llm.hasApiKey()); loadModels(); }}
      />
    `}
    ${showHelp && html`
      <${HelpDialog}
        src="./HELP.md"
        title="Algorithm Visualizer — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
  `;
}

render(html`<${App} />`, document.getElementById('app'));

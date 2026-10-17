import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { ensureAppNamespace, getRoot, connectRoot } from '../shared/services/data-root-manager.js';
import { ProviderModelSelector } from '../shared/components/ProviderModelSelector.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { hasApiKey } from '../shared/services/providers-openrouter.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { WelcomeGate } from './components/WelcomeGate.js';
import { Toolbar } from './components/Toolbar.js';
import { StartView } from './components/StartView.js';
import { MorphView } from './components/MorphView.js';
import { createWorkspace } from './services/workspaceStore.js';
import { runMorphLoop } from './services/morphLoop.js';
import { runHtml } from './services/runners/runHtml.js';
import { runPython } from './services/runners/runPython.js';
import { createSessionStore, buildSessionId } from './services/sessionStore.js';
import { readHandoff, peekHandoff } from './services/handoff.js';
import { sendCodeMorphResultBack } from '../shared/services/code-morph-return-handoff.js';
import { saveMorphNotebook } from './services/notebookExport.js';

const APP_ID = 'code-morph-lab-v3';

const SOURCE_LABELS = {
  'prompt-gallery': 'Prompt Gallery',
  'three-prompt-lab': 'Three Prompt Lab',
  'model-eval-lab': 'Model Eval Lab',
  'svg-benchmark': 'SVG Benchmark',
  'code-arena': 'Code Arena',
};

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || 'source app';
}

function buildImportedFrom(payload) {
  if (!payload) return null;
  return {
    source: payload.source || 'unknown',
    kind: payload.kind || 'code',
    title: payload.title || '',
    prompt: payload.prompt || '',
    requestedChanges: payload.requestedChanges || payload.meta?.requestedChanges || '',
    language: payload.language || '',
    meta: payload.meta || {},
    importedAt: payload.importedAt || new Date().toISOString(),
  };
}

function chooseEntryFile(files, language) {
  if (!files.length) return '';
  if (language === 'html') {
    return files.find(f => f.name === 'index.html')?.name
      || files.find(f => f.name.endsWith('.html'))?.name
      || files[0].name;
  }
  return files.find(f => f.name.endsWith('.py'))?.name || files[0].name;
}

function fileExists(files, name) {
  return !!name && files.some(file => file.name === name);
}

function latestRunEntryFromIterations(iterations) {
  for (let i = iterations.length - 1; i >= 0; i--) {
    const iter = iterations[i];
    if (iter.runResult?.entryFile) return iter.runResult.entryFile;
    for (let j = (iter.toolCalls || []).length - 1; j >= 0; j--) {
      const call = iter.toolCalls[j];
      if (call.name === 'run_program' && call.args?.entry) return call.args.entry;
    }
  }
  return '';
}

function latestChangedFile(iterations, predicate) {
  for (let i = iterations.length - 1; i >= 0; i--) {
    const files = iterations[i].filesChanged || [];
    for (let j = files.length - 1; j >= 0; j--) {
      if (predicate(files[j])) return files[j];
    }
  }
  return '';
}

function chooseReturnEntryFile({ files, language, latestRunResult, iterations, imported }) {
  if (imported?.source === 'svg-benchmark') {
    const changedSvg = latestChangedFile(iterations, name => fileExists(files, name) && name.endsWith('.svg'));
    if (changedSvg) return changedSvg;
    const changedHtml = latestChangedFile(iterations, name => fileExists(files, name) && name.endsWith('.html'));
    if (changedHtml) return changedHtml;
  }

  const latestRunEntry = latestRunResult?.entryFile || latestRunEntryFromIterations(iterations);
  if (fileExists(files, latestRunEntry)) return latestRunEntry;

  return chooseEntryFile(files, language);
}

function buildRunGoal(request, imported) {
  if (imported?.kind !== 'code') return request || '';
  const parts = ['Iterate on this imported code.'];
  if (imported.prompt) {
    parts.push(`Original prompt:\n${imported.prompt}`);
  }
  if ((request || '').trim()) {
    parts.push(`Requested changes:\n${request.trim()}`);
  }
  return parts.join('\n\n');
}

function objectHasFiles(obj) {
  return Object.values(obj || {}).some(value => typeof value === 'string');
}

function snapshotFromLoadedSession(full, normalizedIterations) {
  if (objectHasFiles(full.finalSnapshot)) return full.finalSnapshot;
  const last = normalizedIterations[normalizedIterations.length - 1];
  if (objectHasFiles(last?.snapshot)) return last.snapshot;
  if (objectHasFiles(full.startingFiles)) return full.startingFiles;
  return {};
}

function requestedChangesFromGoal(goal) {
  const match = String(goal || '').match(/(?:^|\n\n)Requested changes:\n([\s\S]*)$/);
  return match ? match[1].trim() : '';
}

function buildReturnPrompt(imported, goal) {
  const basePrompt = (imported?.prompt || '').trim();
  if (imported?.kind === 'prompt') return String(goal || basePrompt).trim();

  const requestedChanges = (imported?.requestedChanges || requestedChangesFromGoal(goal)).trim();
  if (basePrompt && requestedChanges) {
    return `${basePrompt}\n\nMorphed changes:\n${requestedChanges}`;
  }
  return basePrompt || String(goal || '').trim();
}

async function prepareSvgBenchmarkReturnFiles({ files, entryFile, language }) {
  if (language !== 'html' || !entryFile) return { files, entryFile, renderedSvgCaptured: false };
  const entry = files.find(file => file.name === entryFile);
  if (!entry || !entry.name.endsWith('.html')) return { files, entryFile, renderedSvgCaptured: false };

  try {
    const result = await runHtml(entry.content, Object.fromEntries(files.map(file => [file.name, file.content])));
    const renderedSvg = (result.renderedSvg || '').trim();
    if (!renderedSvg) return { files, entryFile, renderedSvgCaptured: false };

    const renderedName = 'code-morph-rendered.svg';
    return {
      files: [
        { name: renderedName, content: renderedSvg },
        ...files.filter(file => file.name !== renderedName),
      ],
      entryFile: renderedName,
      renderedSvgCaptured: true,
    };
  } catch {
    return { files, entryFile, renderedSvgCaptured: false };
  }
}

function formatToolCallStream(call) {
  const name = call.function?.name || '(pending tool)';
  const args = call.function?.arguments || '';
  try {
    const parsed = JSON.parse(args);
    if (name === 'write_file' && parsed.filename && typeof parsed.content === 'string') {
      return `### write_file: ${parsed.filename}\n\n\`\`\`${parsed.filename.split('.').pop() || ''}\n${parsed.content}\n\`\`\``;
    }
    if (name === 'edit_file' && parsed.filename) {
      return [
        `### edit_file: ${parsed.filename}`,
        `Old string:`,
        '```',
        parsed.old_string || '',
        '```',
        `New string:`,
        '```',
        parsed.new_string || '',
        '```',
      ].join('\n');
    }
    return `### ${name}\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    // Keep partial JSON visible while the model is still streaming arguments.
  }
  return `### ${name}\n\n\`\`\`json\n${args || '{}'}\n\`\`\``;
}

function formatModelStream({ iteration, round, text, toolCalls, finishReason }) {
  const parts = [`# Model stream`, `Iteration ${iteration}${round ? `, round ${round}` : ''}`];
  if (text) {
    parts.push('## Assistant text', text);
  }
  if (toolCalls?.length) {
    parts.push('## Tool calls', toolCalls.map(formatToolCallStream).join('\n\n'));
  }
  if (!text && !toolCalls?.length) {
    parts.push('Waiting for model output...');
  }
  if (finishReason) parts.push(`Finish reason: ${finishReason}`);
  return parts.join('\n\n');
}

function App() {
  const [handle, setHandle] = useState(null);
  const [pickerRunning, setPickerRunning] = useState(false);
  const [pickerError, setPickerError] = useState(null);
  const [bootComplete, setBootComplete] = useState(false);

  const [theme, setTheme] = useState(() => localStorage.getItem(`${APP_ID}-theme`) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(`${APP_ID}-theme`, theme);
  }, [theme]);

  // Provider state
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    modelProviders.getEffectiveSelection(`${APP_ID}-provider`, `${APP_ID}-model`).provider
  );
  const [selectedModelId, setSelectedModelId] = useState(() =>
    modelProviders.getEffectiveSelection(`${APP_ID}-provider`, `${APP_ID}-model`).model
  );
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());
  const [showProviderSettings, setShowProviderSettings] = useState(false);

  // Start view form state
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('html');
  const [maxIterations, setMaxIterations] = useState(5);
  const [arrivedImport, setArrivedImport] = useState(null);
  const [pendingHandoff, setPendingHandoff] = useState(() => peekHandoff());

  // View + session state
  const [view, setView] = useState('start'); // 'start' | 'morph'
  const [session, setSession] = useState(null);
  const workspaceRef = useRef(null);
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [iterations, setIterations] = useState([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [running, setRunning] = useState(false);
  const [latestRunResult, setLatestRunResult] = useState(null);
  const [latestErrorInfo, setLatestErrorInfo] = useState(null);
  const [liveModelStream, setLiveModelStream] = useState('');
  const abortControllerRef = useRef(null);

  const [recentSessions, setRecentSessions] = useState([]);
  const [readOnlyView, setReadOnlyView] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  const sessionStoreRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        if (await getRoot()) {
          const h = await ensureAppNamespace(APP_ID);
          setHandle(h);
          sessionStoreRef.current = createSessionStore(h);
          const consumed = readHandoff();
          if (consumed) applyHandoff(consumed);
        }
      } finally {
        setBootComplete(true);
      }
    })();
  }, []);

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
  const handleProvidersChanged = useCallback(() => {
    setApiKeySet(hasApiKey());
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (selectedProviderId) localStorage.setItem(`${APP_ID}-provider`, selectedProviderId);
    if (selectedModelId) localStorage.setItem(`${APP_ID}-model`, selectedModelId);
  }, [selectedProviderId, selectedModelId]);

  const handlePickFolder = useCallback(async () => {
    setPickerRunning(true);
    setPickerError(null);
    try {
      const root = await connectRoot();
      if (!root) {
        setPickerError('No data root configured — go to Settings → Data Root.');
        return;
      }
      const appHandle = await ensureAppNamespace(APP_ID);
      setHandle(appHandle);
      sessionStoreRef.current = createSessionStore(appHandle);
      const consumed = readHandoff();
      if (consumed) applyHandoff(consumed);
    } catch (e) {
      setPickerError(e.message || String(e));
    } finally {
      setPickerRunning(false);
    }
  }, []);

  const loadRecentSessions = useCallback(async () => {
    const store = sessionStoreRef.current;
    if (!store) return;
    try {
      const list = await store.listSessions();
      setRecentSessions(list);
    } catch (e) {
      console.warn('listSessions failed', e);
    }
  }, []);

  useEffect(() => {
    if (handle) loadRecentSessions();
  }, [handle, loadRecentSessions]);

  const handleDeleteSession = useCallback(async (id, goal) => {
    const store = sessionStoreRef.current;
    if (!store) return;
    const label = goal ? `\n\n"${goal.slice(0, 120)}${goal.length > 120 ? '…' : ''}"` : '';
    if (!window.confirm(`Delete this morph permanently?${label}`)) return;
    try {
      await store.deleteSession(id);
      setRecentSessions(list => list.filter(s => s.id !== id));
    } catch (e) {
      console.warn('deleteSession failed', e);
      window.alert(`Failed to delete morph: ${e.message || e}`);
    }
  }, []);

  const handleOpenSession = useCallback(async (id) => {
    const store = sessionStoreRef.current;
    if (!store) return;
    try {
      const full = await store.loadSession(id);
      setSession({
        id: full.id,
        createdAt: full.createdAt,
        goal: full.goal,
        language: full.language,
        model: full.model,
        maxIterations: full.maxIterations,
        status: full.status,
        importedFrom: full.importedFrom || null,
      });
      const normalized = full.iterations.map(it => ({
        number: it.number,
        toolCalls: it.toolCalls || [],
        filesChanged: it.filesChanged || [],
        diffs: it.diffs || {},
        runResult: it.runResult || null,
        errorInfo: it.errorInfo || null,
        success: !!it.success,
        duration: it.duration || 0,
        snapshot: it.snapshot || {},
      }));
      setIterations(normalized);
      setCurrentIteration(normalized.length);
      const last = normalized[normalized.length - 1];
      setLatestRunResult(last?.runResult || null);
      setLatestErrorInfo(last?.errorInfo || null);
      setLiveModelStream('');
      workspaceRef.current = createWorkspace();
      workspaceRef.current.loadFromObject(snapshotFromLoadedSession(full, normalized));
      setSnapshotVersion(v => v + 1);
      setReadOnlyView(true);
      setView('morph');
    } catch (e) {
      console.warn('open session failed', e);
      alert('Failed to open session: ' + e.message);
    }
  }, []);

  const applyHandoff = useCallback((payload) => {
    setArrivedImport(payload);
    if (payload.language === 'python' || payload.language === 'html') {
      setLanguage(payload.language);
    } else if (payload.files?.some(f => f.name.endsWith('.py'))) {
      setLanguage('python');
    } else {
      setLanguage('html');
    }
    if (payload.kind === 'prompt' && payload.prompt) {
      setPrompt(payload.prompt);
    } else if (payload.kind === 'code') {
      setPrompt('');
    }
    setPendingHandoff(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    const store = sessionStoreRef.current;
    if (!store) return;

    const workspace = createWorkspace();
    workspaceRef.current = workspace;
    const importedFrom = buildImportedFrom(arrivedImport);
    const runGoal = buildRunGoal(prompt, arrivedImport);
    if (importedFrom && arrivedImport?.kind === 'code') {
      importedFrom.requestedChanges = (prompt || '').trim();
    }

    const sessionMeta = {
      id: buildSessionId(runGoal),
      createdAt: new Date().toISOString(),
      goal: runGoal,
      language,
      model: `${selectedProviderId}:${selectedModelId}`,
      maxIterations,
      status: 'running',
      importedFrom,
    };
    await store.createSession(sessionMeta);
    setSession(sessionMeta);
    setIterations([]);
    setCurrentIteration(0);
    setLatestRunResult(null);
    setLatestErrorInfo(null);
    setLiveModelStream('');
    setRunning(true);
    setView('morph');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const startingFiles = (arrivedImport?.kind === 'code' && arrivedImport.files)
      ? Object.fromEntries(arrivedImport.files.map(f => [f.name, f.content]))
      : null;

    try {
      const result = await runMorphLoop({
        goal: runGoal,
        language,
        workspace,
        startingFiles,
        maxIterations,
        completion: async ({ messages, tools, onChunk }) => {
          return modelProviders.streamChatCompletion({
            providerId: selectedProviderId,
            modelId: selectedModelId,
            messages,
            tools,
            appTitle: 'Code Morph Lab v3',
            onChunk,
            returnResponse: true,
            signal: abortController.signal,
          });
        },
        runner: (code, allFiles) => (language === 'python' ? runPython(code, allFiles) : runHtml(code, allFiles)),
        abortSignal: abortController.signal,
        onIterationStart: (n) => {
          setCurrentIteration(n);
          setLiveModelStream(formatModelStream({ iteration: n, round: 0, text: '', toolCalls: [] }));
        },
        onModelStream: (event) => setLiveModelStream(formatModelStream(event)),
        onWorkspaceUpdate: () => setSnapshotVersion(v => v + 1),
        onIterationEnd: async (iter, afterMap) => {
          const iterWithSnapshot = { ...iter, snapshot: Object.fromEntries(afterMap) };
          setIterations(prev => [...prev, iterWithSnapshot]);
          setSnapshotVersion(v => v + 1);
          if (iter.runResult) {
            setLatestRunResult(iter.runResult);
            setLatestErrorInfo(iter.errorInfo);
          }
          await store.appendIteration(sessionMeta.id, iter, afterMap);
        },
      });
      const finalStatus = abortController.signal.aborted
        ? 'stopped'
        : (result.finalSuccess ? 'success' : 'failed');
      await store.finalizeSession(sessionMeta.id, finalStatus, workspace.snapshot());
      await loadRecentSessions();
      setSession(s => s && { ...s, status: finalStatus });
    } catch (e) {
      console.error('morph loop failed', e);
      await store.finalizeSession(sessionMeta.id, 'failed', workspace.snapshot());
      await loadRecentSessions();
      setSession(s => s && { ...s, status: 'failed' });
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }, [prompt, language, maxIterations, selectedProviderId, selectedModelId, arrivedImport, loadRecentSessions]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleNewSession = useCallback(() => {
    if (running) return;
    setView('start');
    setSession(null);
    setIterations([]);
    setPrompt('');
    setLatestRunResult(null);
    setLatestErrorInfo(null);
    setLiveModelStream('');
    setArrivedImport(null);
    setReadOnlyView(false);
    setPreviewFullscreen(false);
  }, [running]);

  const handleExport = useCallback(async () => {
    const store = sessionStoreRef.current;
    if (!store || !session) return;
    try {
      const full = await store.loadSession(session.id);
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed: ' + e.message);
    }
  }, [session]);

  const handleFork = useCallback(async () => {
    const store = sessionStoreRef.current;
    if (!store || !session) return;
    const newId = buildSessionId(session.goal);
    const newGoal = session.status === 'success'
      ? session.goal
      : `Continue from previous attempt. ${session.goal}`;
    try {
      const newMeta = await store.forkSession(session.id, newId, newGoal);
      setPrompt('');
      setLanguage(newMeta.language);
      setMaxIterations(newMeta.maxIterations);
      setArrivedImport({
        ...(newMeta.importedFrom || {}),
        source: newMeta.importedFrom?.source || 'code-morph-lab-v3',
        kind: 'code',
        title: 'Forked from ' + session.id,
        prompt: newGoal,
        language: newMeta.language,
        files: Object.entries(newMeta.startingFiles || {}).map(([name, content]) => ({ name, content })),
      });
      setView('start');
      setReadOnlyView(false);
      setSession(null);
      setIterations([]);
      await loadRecentSessions();
    } catch (e) {
      alert('Fork failed: ' + e.message);
    }
  }, [session, loadRecentSessions]);

  const handleSendBack = useCallback(async () => {
    if (!session?.importedFrom) return;
    const snapshot = workspaceRef.current?.toObject() || {};
    let files = Object.entries(snapshot)
      .map(([name, content]) => ({ name, content }))
      .filter(file => file.name && typeof file.content === 'string');
    let entryFile = chooseReturnEntryFile({
      files,
      language: session.language,
      latestRunResult,
      iterations,
      imported: session.importedFrom,
    });
    if (!entryFile) {
      alert('No files are available to send back.');
      return;
    }

    const imported = session.importedFrom;
    try {
      const rendered = imported.source === 'svg-benchmark'
        ? await prepareSvgBenchmarkReturnFiles({ files, entryFile, language: session.language })
        : { files, entryFile, renderedSvgCaptured: false };
      files = rendered.files;
      entryFile = rendered.entryFile;
      const requestedChanges = (imported.requestedChanges || requestedChangesFromGoal(session.goal)).trim();
      const returnPrompt = buildReturnPrompt(imported, session.goal);

      sendCodeMorphResultBack({
        source: imported.source,
        title: imported.title || session.id,
        prompt: returnPrompt,
        goal: session.goal,
        language: session.language,
        files,
        entryFile,
        meta: {
          ...(imported.meta || {}),
          originalPrompt: imported.prompt || '',
          requestedChanges,
          returnedPrompt: returnPrompt,
          renderedSvgCaptured: rendered.renderedSvgCaptured,
          morphSessionId: session.id,
          morphModel: session.model,
          morphStatus: session.status,
        },
      });
    } catch (e) {
      alert('Send back failed: ' + e.message);
    }
  }, [session, latestRunResult, iterations]);

  const handleSendToNotebook = useCallback(async () => {
    if (!session) return;
    const snapshot = workspaceRef.current?.toObject() || {};
    const files = Object.entries(snapshot)
      .map(([name, content]) => ({ name, content }))
      .filter(file => file.name && typeof file.content === 'string');
    const entryFile = chooseReturnEntryFile({
      files,
      language: session.language,
      latestRunResult,
      iterations,
      imported: session.importedFrom,
    });
    if (!entryFile) {
      alert('No files are available to send to Notebook Lab.');
      return;
    }

    try {
      await saveMorphNotebook({
        session,
        files,
        entryFile,
        runResult: latestRunResult,
      });
      window.location.href = '../notebook-lab/';
    } catch (e) {
      alert('Send to Notebook failed: ' + e.message);
    }
  }, [session, latestRunResult, iterations]);

  const liveSnapshot = useMemo(() => {
    // re-read workspace on version bumps
    if (!workspaceRef.current) return {};
    return workspaceRef.current.toObject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotVersion]);

  if (!bootComplete) return html`<div style="padding:2rem;color:#777;">Loading…</div>`;

  if (!handle) {
    return html`
      <${WelcomeGate}
        onPickFolder=${handlePickFolder}
        pickerRunning=${pickerRunning}
        pendingHandoff=${pendingHandoff}
        error=${pickerError}
      />
    `;
  }

  const providerSelector = html`
    <${ProviderModelSelector}
      models=${allModels}
      providerId=${selectedProviderId}
      modelId=${selectedModelId}
      onChange=${(pId, mId) => { setSelectedProviderId(pId); setSelectedModelId(mId); }}
      loading=${modelsLoading}
      disabled=${running}
      onSettingsClick=${() => setShowProviderSettings(true)}
    />
  `;

  if (view === 'start') {
    const canGenerate = buildRunGoal(prompt, arrivedImport).trim().length > 0 && !!selectedModelId;
    return html`
      <${Toolbar}
        title="Code Morph Lab v3"
        backLabel="Hub"
        onBack=${() => { window.location.href = '../'; }}
        providerSelector=${providerSelector}
        theme=${theme}
        onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        folderName=${handle.name}
        route="start"
        apiKeySet=${apiKeySet}
        onProviderSettingsClick=${() => setShowProviderSettings(true)}
        onApiKeyClick=${() => setShowProviderSettings(true)}
        onHelpClick=${() => setShowHelp(true)}
      />
      <${StartView}
        prompt=${prompt}
        onPromptChange=${setPrompt}
        language=${language}
        onLanguageChange=${setLanguage}
        maxIterations=${maxIterations}
        onMaxIterationsChange=${setMaxIterations}
        canGenerate=${canGenerate}
        onGenerate=${handleGenerate}
        arrivedImport=${arrivedImport}
        onDismissImport=${() => setArrivedImport(null)}
        recentSessions=${recentSessions}
        onOpenSession=${handleOpenSession}
        onDeleteSession=${handleDeleteSession}
      />
      ${showProviderSettings && html`
        <${ProviderSettingsDialog}
          onClose=${() => setShowProviderSettings(false)}
          onProvidersChanged=${handleProvidersChanged}
        />
      `}
      ${showHelp && html`
        <${HelpDialog}
          src="./HELP.md"
          title="Code Morph Lab v3 \u2014 Help"
          onClose=${() => setShowHelp(false)}
        />
      `}
    `;
  }

  // morph view
  return html`
    <${Toolbar}
      title="Code Morph Lab v3"
      backLabel="New session"
      onBack=${handleNewSession}
      providerSelector=${providerSelector}
      theme=${theme}
      onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      folderName=${handle.name}
      route="morph"
      apiKeySet=${apiKeySet}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onApiKeyClick=${() => setShowProviderSettings(true)}
      onHelpClick=${() => setShowHelp(true)}
      rightExtras=${html`
        ${previewFullscreen && html`
          <button class="btn-icon" onClick=${() => setPreviewFullscreen(false)} title="Exit fullscreen preview">
            <i class="fa-solid fa-compress"></i>
          </button>
        `}
        ${running && html`<button class="btn btn-danger" onClick=${handleStop}><i class="fa-solid fa-stop"></i> Stop</button>`}
      `}
    />
    <${MorphView}
      session=${session}
      iterations=${iterations}
      currentIteration=${currentIteration}
      running=${running}
      liveSnapshot=${liveSnapshot}
      liveModelStream=${liveModelStream}
      latestRunResult=${latestRunResult}
      latestErrorInfo=${latestErrorInfo}
      readOnly=${readOnlyView}
      onFork=${handleFork}
      onExport=${handleExport}
      onSendBack=${session?.importedFrom ? handleSendBack : null}
      onSendToNotebook=${handleSendToNotebook}
      sourceLabel=${sourceLabel(session?.importedFrom?.source)}
      previewFullscreen=${previewFullscreen}
      onTogglePreviewFullscreen=${() => setPreviewFullscreen(v => !v)}
    />
    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${handleProvidersChanged}
      />
    `}
    ${showHelp && html`
      <${HelpDialog}
        src="./HELP.md"
        title="Code Morph Lab v3 \u2014 Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
  `;
}

render(html`<${App} />`, document.getElementById('app'));

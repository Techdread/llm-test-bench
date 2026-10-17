import { html, render } from 'htm/preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Toolbar } from './components/Toolbar.js';
import { SourceEditor } from './components/SourceEditor.js';
import { AssemblyPanel } from './components/AssemblyPanel.js';
import { RegistersPanel } from './components/RegistersPanel.js';
import { AluPanel } from './components/AluPanel.js';
import { MemoryMap } from './components/MemoryMap.js';
import { MemoryInspector } from './components/MemoryInspector.js';
import { PointerInspector } from './components/PointerInspector.js';
import { StackPanel } from './components/StackPanel.js';
import { HeapPanel } from './components/HeapPanel.js';
import { FileIoPanel } from './components/FileIoPanel.js';
import { InterruptsPanel } from './components/InterruptsPanel.js';
import { OutputPanel } from './components/OutputPanel.js';
import { LessonsPanel } from './components/LessonsPanel.js';
import { AiExplainPanel } from './components/AiExplainPanel.js';
import { RuntimeComparePanel } from './components/RuntimeComparePanel.js';
import { ConfigEditor } from './components/ConfigEditor.js';
import { Toast } from './components/Toast.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { hasApiKey } from '../shared/services/providers-openrouter.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { compile } from './services/compiler/index.js';
import { TeachingMachine } from './services/vm/machine.js';
import { loadConfig, saveConfig } from './services/config.js';
import { LESSONS, getLesson } from './services/lessons.js';
import { generateTeachingProgram, explainMachineState } from './services/generation.js';
import { runNativeComparison } from './services/nativeRun.js';
import { buildSession, downloadSession, readSessionFile } from './services/sessionStore.js';

const THEME_KEY = 'c-machine-lab-theme';
const LESSON_KEY = 'c-machine-lab-lesson';
const PROVIDER_KEY = 'c-machine-lab-provider';
const MODEL_KEY = 'c-machine-lab-model';

function App() {
  const initialLesson = getLesson(localStorage.getItem(LESSON_KEY) || LESSONS[0].id);
  const initialSelection = modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY);

  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [config, setConfig] = useState(() => loadConfig());
  const [lessonId, setLessonId] = useState(initialLesson.id);
  const [source, setSource] = useState(initialLesson.code);
  const [virtualFiles, setVirtualFiles] = useState(initialLesson.virtualFiles || []);
  const [compiled, setCompiled] = useState(null);
  const [machine, setMachine] = useState(null);
  const [machineVersion, setMachineVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [selectedInstruction, setSelectedInstruction] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [compareRun, setCompareRun] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(initialSelection.provider);
  const [selectedModelId, setSelectedModelId] = useState(initialSelection.model);
  const [apiKeySet, setApiKeySet] = useState(() => hasApiKey());
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const machineRef = useRef(machine);
  const importRef = useRef(null);

  const lesson = useMemo(() => getLesson(lessonId), [lessonId]);
  const diagnostics = compiled?.diagnostics || [];
  const hasFatalDiagnostics = diagnostics.some(item => item.severity === 'error');
  const lastEvent = machine?.lastEvent || null;
  const currentInstruction = selectedInstruction || machine?.currentInstruction || null;
  const inspection = machine && selectedAddress != null ? machine.inspectAddress(selectedAddress) : null;
  const canExecute = !!source.trim();

  useEffect(() => { machineRef.current = machine; }, [machine, machineVersion]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LESSON_KEY, lessonId);
  }, [lessonId]);

  useEffect(() => {
    if (selectedProviderId) localStorage.setItem(PROVIDER_KEY, selectedProviderId);
    if (selectedModelId) localStorage.setItem(MODEL_KEY, selectedModelId);
  }, [selectedProviderId, selectedModelId]);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(list => [...list, { id, message, type }]);
    setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 3500);
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
      if (!selectedProviderId && models[0]) {
        setSelectedProviderId(models[0].providerId);
        setSelectedModelId(models[0].modelId);
      }
    } catch (err) {
      console.warn('c-machine-lab: failed to load models', err);
    } finally {
      setModelsLoading(false);
    }
  }, [selectedProviderId]);

  useEffect(() => { loadModels().catch(() => {}); }, []);

  const buildMachine = useCallback((nextSource = source, nextConfig = config, nextFiles = virtualFiles) => {
    try {
      const nextCompiled = compile(nextSource, nextConfig);
      setCompiled(nextCompiled);
      setSelectedInstruction(null);
      const fatal = nextCompiled.diagnostics.some(item => item.severity === 'error');
      if (fatal) {
        setMachine(null);
        setDirty(false);
        addToast('Compile produced diagnostics; fix the source before running', 'error');
        return { compiled: nextCompiled, machine: null };
      }
      const nextMachine = new TeachingMachine(nextCompiled, nextConfig, nextFiles);
      setMachine(nextMachine);
      setMachineVersion(version => version + 1);
      setSelectedAddress(nextConfig.segments.stack.end - 32);
      setDirty(false);
      return { compiled: nextCompiled, machine: nextMachine };
    } catch (err) {
      addToast(`Compile failed: ${err.message}`, 'error');
      setMachine(null);
      return { compiled: null, machine: null };
    }
  }, [source, config, virtualFiles, addToast]);

  useEffect(() => {
    buildMachine(initialLesson.code, config, initialLesson.virtualFiles || []);
  }, []);

  const updateAddressFromEvent = event => {
    const access = event?.memoryWrites?.[0] || event?.memoryReads?.[0];
    if (access) setSelectedAddress(access.address);
  };

  const ensureMachine = useCallback(() => {
    if (dirty || !machineRef.current) return buildMachine().machine;
    return machineRef.current;
  }, [dirty, buildMachine]);

  const stepMachine = useCallback((activeMachine) => {
    if (!activeMachine || activeMachine.halted) return null;
    const event = activeMachine.step();
    updateAddressFromEvent(event);
    setMachineVersion(version => version + 1);
    return event;
  }, []);

  const handleStep = useCallback(() => {
    const active = ensureMachine();
    if (!active) return;
    const event = stepMachine(active);
    if (!event) addToast('VM is halted; reset to run again', 'info');
  }, [ensureMachine, stepMachine, addToast]);

  const handleStepOver = useCallback(() => {
    const active = ensureMachine();
    if (!active) return;
    const startDepth = active.callStack.length;
    const first = active.currentInstruction;
    stepMachine(active);
    if (first?.op !== 'CALL') return;
    let guard = 0;
    while (!active.halted && active.callStack.length > startDepth && guard < config.maxStepsBeforeAutoPause) {
      stepMachine(active);
      guard += 1;
    }
  }, [ensureMachine, stepMachine, config.maxStepsBeforeAutoPause]);

  useEffect(() => {
    if (!isRunning) return undefined;
    const delay = Math.max(16, Math.round(1000 / config.defaultRunSpeed));
    const id = setInterval(() => {
      const active = machineRef.current;
      if (!active || active.halted) {
        setIsRunning(false);
        return;
      }
      stepMachine(active);
    }, delay);
    return () => clearInterval(id);
  }, [isRunning, config.defaultRunSpeed, stepMachine]);

  const handleRunPause = useCallback(() => {
    if (isRunning) {
      setIsRunning(false);
      return;
    }
    const active = ensureMachine();
    if (!active) return;
    if (active.halted) {
      addToast('VM is halted; reset first', 'info');
      return;
    }
    setIsRunning(true);
  }, [isRunning, ensureMachine, addToast]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    buildMachine();
    setCompareRun(null);
  }, [buildMachine]);

  const handleSourceChange = useCallback((next) => {
    setSource(next);
    setDirty(true);
    setCompareRun(null);
  }, []);

  const handleLessonChange = useCallback((id) => {
    const nextLesson = getLesson(id);
    setIsRunning(false);
    setLessonId(nextLesson.id);
    setSource(nextLesson.code);
    setVirtualFiles(nextLesson.virtualFiles || []);
    setCompareRun(null);
    setExplanation('');
    buildMachine(nextLesson.code, config, nextLesson.virtualFiles || []);
    addToast(`Loaded ${nextLesson.title}`, 'info');
  }, [buildMachine, config, addToast]);

  const handleConfigSave = useCallback((nextConfig) => {
    saveConfig(nextConfig);
    setConfig(nextConfig);
    setShowConfig(false);
    setIsRunning(false);
    buildMachine(source, nextConfig, virtualFiles);
    addToast('Config saved and VM rebuilt', 'success');
  }, [source, virtualFiles, buildMachine, addToast]);

  const handleModelChange = useCallback((providerId, modelId) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedProviderId || !selectedModelId) {
      setShowProviderSettings(true);
      return;
    }
    setIsGenerating(true);
    setExplanation('');
    try {
      let latest = source;
      await generateTeachingProgram({
        providerId: selectedProviderId,
        modelId: selectedModelId,
        topic: lesson.topic,
        lesson,
        onChunk: partial => {
          latest = partial;
          setSource(partial);
          setDirty(true);
        },
      });
      buildMachine(latest, config, virtualFiles);
      addToast('Generated and compiled teaching program', 'success');
    } catch (err) {
      addToast(`Generation failed: ${err.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedProviderId, selectedModelId, source, lesson, config, virtualFiles, buildMachine, addToast]);

  const handleExplain = useCallback(async () => {
    const active = ensureMachine();
    if (!active) return;
    if (!selectedProviderId || !selectedModelId) {
      setShowProviderSettings(true);
      return;
    }
    setIsExplaining(true);
    setExplanation('');
    try {
      await explainMachineState({
        providerId: selectedProviderId,
        modelId: selectedModelId,
        context: {
          source,
          selectedLine: currentInstruction?.sourceLine,
          compiled,
          machine: active,
          recentEvents: active.trace,
          focus: currentInstruction?.text || 'current instruction',
        },
        onChunk: partial => setExplanation(partial),
      });
    } catch (err) {
      addToast(`Explain failed: ${err.message}`, 'error');
    } finally {
      setIsExplaining(false);
    }
  }, [ensureMachine, selectedProviderId, selectedModelId, source, currentInstruction, compiled, addToast]);

  const handleCompare = useCallback(async () => {
    setIsComparing(true);
    try {
      const result = await runNativeComparison(source);
      setCompareRun(result);
      addToast(result.runSucceeded ? 'C runtime comparison finished' : 'C runtime comparison failed', result.runSucceeded ? 'success' : 'error');
    } catch (err) {
      addToast(`Comparison failed: ${err.message}`, 'error');
    } finally {
      setIsComparing(false);
    }
  }, [source, addToast]);

  const handleExport = useCallback(() => {
    const active = ensureMachine();
    const session = buildSession({
      title: lesson.title,
      source,
      lessonId,
      compiled,
      machine: active,
      trace: active?.trace || [],
      compareRun,
      selectedProviderId,
      selectedModelId,
    });
    downloadSession(session);
    addToast('Session exported', 'success');
  }, [ensureMachine, lesson.title, source, lessonId, compiled, compareRun, selectedProviderId, selectedModelId, addToast]);

  const handleImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const session = await readSessionFile(file);
      setLessonId(session.lessonId || lessonId);
      setSource(session.source || '');
      setVirtualFiles(getLesson(session.lessonId)?.virtualFiles || []);
      setCompareRun(session.compareRun || null);
      buildMachine(session.source || '', config, getLesson(session.lessonId)?.virtualFiles || []);
      addToast('Session imported', 'success');
    } catch (err) {
      addToast(`Import failed: ${err.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  }, [lessonId, config, buildMachine, addToast]);

  const handleProvidersChanged = useCallback(() => {
    setApiKeySet(hasApiKey());
    loadModels().catch(() => {});
  }, [loadModels]);

  const onSelectInstruction = instruction => {
    setSelectedInstruction(instruction);
  };

  return html`
    <${Toolbar}
      theme=${theme}
      lessons=${LESSONS}
      lessonId=${lessonId}
      onLessonChange=${handleLessonChange}
      allModels=${allModels}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      onModelChange=${handleModelChange}
      modelsLoading=${modelsLoading}
      hasApiKey=${apiKeySet}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onGenerate=${handleGenerate}
      onExplain=${handleExplain}
      isGenerating=${isGenerating}
      isExplaining=${isExplaining}
      onCompile=${() => buildMachine()}
      onRunPause=${handleRunPause}
      onStep=${handleStep}
      onStepOver=${handleStepOver}
      onReset=${handleReset}
      onCompare=${handleCompare}
      onConfig=${() => setShowConfig(true)}
      onExport=${handleExport}
      onImport=${() => importRef.current?.click()}
      onHelpClick=${() => setShowHelp(true)}
      onToggleTheme=${() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
      isRunning=${isRunning}
      canExecute=${canExecute}
      dirty=${dirty}
    />

    <input ref=${importRef} type="file" accept="application/json,.json" style="display:none" onChange=${handleImportFile} />

    <main class="cml-workbench">
      <div class="workbench-main">
        <div class="top-grid">
          <${SourceEditor}
            source=${source}
            onSourceChange=${handleSourceChange}
            theme=${theme}
            currentLine=${currentInstruction?.sourceLine}
            diagnostics=${diagnostics}
            onCompile=${() => buildMachine()}
          />
          <${AssemblyPanel}
            assembly=${compiled?.assembly || []}
            currentInstruction=${machine?.currentInstruction}
            onSelectInstruction=${onSelectInstruction}
          />
        </div>
        <${MemoryMap}
          machine=${machine}
          config=${config}
          selectedAddress=${selectedAddress}
          onInspectAddress=${setSelectedAddress}
          lastEvent=${lastEvent}
        />
        <div class="bottom-grid">
          <${HeapPanel} machine=${machine} lastEvent=${lastEvent} onInspectAddress=${setSelectedAddress} />
          <${FileIoPanel}
            machine=${machine}
            virtualFiles=${virtualFiles}
            onVirtualFilesChange=${nextFiles => {
              setVirtualFiles(nextFiles);
              setDirty(true);
            }}
            lastEvent=${lastEvent}
          />
          <${RuntimeComparePanel} machine=${machine} compareRun=${compareRun} isComparing=${isComparing} />
          <${AiExplainPanel} explanation=${explanation} isExplaining=${isExplaining} />
        </div>
      </div>
      <aside class="workbench-side">
        <${RegistersPanel} machine=${machine} lastEvent=${lastEvent} onInspectAddress=${setSelectedAddress} />
        <${AluPanel} alu=${machine?.lastAlu} lastEvent=${lastEvent} />
        <${StackPanel} machine=${machine} onInspectAddress=${setSelectedAddress} />
        <${PointerInspector} machine=${machine} onInspectAddress=${setSelectedAddress} />
        <${MemoryInspector} inspection=${inspection} />
        <${InterruptsPanel} lastEvent=${lastEvent} />
        <${OutputPanel} machine=${machine} />
        <${LessonsPanel} lesson=${lesson} />
      </aside>
    </main>

    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => setShowProviderSettings(false)}
        onProvidersChanged=${handleProvidersChanged}
      />
    `}
    ${showConfig && html`
      <${ConfigEditor}
        config=${config}
        onSave=${handleConfigSave}
        onClose=${() => setShowConfig(false)}
      />
    `}
    ${showHelp && html`
      <${HelpDialog}
        src="./HELP.md"
        title="C Machine Lab - Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

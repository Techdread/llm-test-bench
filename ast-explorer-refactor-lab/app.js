import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { SourcePane } from './components/SourcePane.js';
import { AstTree } from './components/AstTree.js';
import { NodeDetails } from './components/NodeDetails.js';
import { RefactorPanel } from './components/RefactorPanel.js';
import { DiffOverlay } from './components/DiffOverlay.js';
import { SessionsDialog } from './components/SessionsDialog.js';
import { ApiKeyDialog } from '../shader-lab/components/ApiKeyDialog.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';

import * as parserJs from './services/parserJs.js';
import * as parserPy from './services/parserPy.js';
import * as sessionStore from './services/sessionStore.js';
import * as llm from './services/openrouter.js';
import { BUILTIN_RECIPES, filterByLanguage } from './services/refactorRecipes.js';
import { buildHunks, applyHunks, summariseHunks } from './services/diffEngine.js';
import * as modelProviders from '../shared/services/model-providers.js';

const APP_ID = 'ast-explorer-refactor-lab';

const STARTER = {
  js: `// Paste JavaScript here. Try selecting a block and running "Extract function".
function greet(name) {
  if (name) {
    const greeting = 'Hello, ' + name + '!';
    console.log(greeting);
    return greeting;
  }
  return null;
}

greet('world');
`,
  ts: `// TypeScript — syntactic parse only (no type checking).
interface User { id: number; name: string }

function pickName(u: User): string {
  return u.name;
}

const user: User = { id: 1, name: 'Ada' };
console.log(pickName(user));
`,
  tsx: `// TSX — syntactic parse only.
interface Props { label: string }

export function Button({ label }: Props) {
  return <button onClick={() => console.log(label)}>{label}</button>;
}
`,
  python: `# Python — parsed via Pyodide's ast module.
def fib(n):
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b

print(fib(10))
`,
};

function App() {
  // ── Theme ──
  const [theme, setTheme] = useState(() => localStorage.getItem(`${APP_ID}-theme`) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(`${APP_ID}-theme`, theme);
  }, [theme]);

  // ── Data root ──
  const [hasRoot, setHasRoot] = useState(false);
  useEffect(() => { sessionStore.hasRoot().then(setHasRoot); }, []);

  // ── Source state ──
  const [language, setLanguage] = useState(() => localStorage.getItem(`${APP_ID}-language`) || 'js');
  const [source, setSource] = useState(() => localStorage.getItem(`${APP_ID}-source`) || STARTER.js);
  const [sessionName, setSessionName] = useState('Untitled session');
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => { localStorage.setItem(`${APP_ID}-language`, language); }, [language]);
  useEffect(() => { localStorage.setItem(`${APP_ID}-source`, source); }, [source]);

  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang);
    // When switching to an empty-ish source, seed a starter example.
    if (!source.trim() || Object.values(STARTER).includes(source)) {
      setSource(STARTER[lang]);
    }
  }, [source]);

  // ── Parser state ──
  const [tree, setTree] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parseStatus, setParseStatus] = useState(null); // { message, error }
  const [parsingPy, setParsingPy] = useState(false);
  const parseTokenRef = useRef(0);

  useEffect(() => {
    const token = ++parseTokenRef.current;
    const run = async () => {
      const started = performance.now();
      if (language === 'python') {
        setParsingPy(true);
        setParseStatus({ message: 'Loading Pyodide…', error: null });
        const result = await parserPy.parse(source);
        if (token !== parseTokenRef.current) return;
        setParsingPy(false);
        if (result.error) {
          setParseError(result.error);
          setTree(null);
          setParseStatus({ message: '', error: `Python parse: ${result.error.message}` });
          return;
        }
        const built = parserPy.buildTree(result.ast);
        setTree(built);
        setParseError(null);
        const ms = (performance.now() - started).toFixed(0);
        setParseStatus({ message: `Parsed (${built.byId.size} nodes, ${ms} ms)`, error: null });
      } else {
        const result = parserJs.parse(source, language);
        if (token !== parseTokenRef.current) return;
        if (!result.ast) {
          setParseError(result.error);
          setTree(null);
          setParseStatus({ message: '', error: `Parse error: ${result.error?.message || 'unknown'}` });
          return;
        }
        const built = parserJs.buildTree(result.ast, source);
        setTree(built);
        setParseError(result.error || null);
        const ms = (performance.now() - started).toFixed(0);
        const looseNote = result.loose ? ' (recovered)' : '';
        const tsNote = result.tsStripped ? ' · TS stripped' : '';
        setParseStatus({ message: `Parsed (${built.byId.size} nodes, ${ms} ms${looseNote}${tsNote})`, error: null });
      }
    };
    run();
  }, [source, language]);

  // ── Selection state ──
  const [selectedId, setSelectedId] = useState(null);
  const [highlight, setHighlight] = useState(null); // [start, end] offsets
  const [expandedIds, setExpandedIds] = useState(() => new Set(['0']));
  const [expandAllToken, setExpandAllToken] = useState(0);
  const [rightTab, setRightTab] = useState('refactor');

  // Auto-expand root when tree changes.
  useEffect(() => {
    if (!tree?.root) return;
    setSelectedId(null);
    setHighlight(null);
    const init = new Set([tree.root.id]);
    // Expand first level too for better defaults.
    for (const group of tree.root.children) {
      for (const kid of group.nodes) init.add(kid.id);
    }
    setExpandedIds(init);
  }, [tree]);

  const handleCursorChange = useCallback((offset) => {
    if (!tree) return;
    const finder = language === 'python' ? parserPy.findNodeAtOffset : parserJs.findNodeAtOffset;
    const entry = finder(tree, offset);
    if (!entry) return;
    if (entry.id === selectedId) return;
    setSelectedId(entry.id);
    expandAncestors(entry, tree, setExpandedIds);
  }, [tree, selectedId, language]);

  const handleSelectFromTree = useCallback((entry) => {
    setSelectedId(entry.id);
    if (entry.range) setHighlight([entry.range[0], entry.range[1]]);
  }, []);

  const handleToggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectedEntry = useMemo(() => tree?.byId?.get(selectedId) || null, [tree, selectedId]);

  // ── LLM / providers ──
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

  // ── Refactor state ──
  const applicableRecipes = useMemo(() => filterByLanguage(language), [language]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(() => applicableRecipes[0]?.id || BUILTIN_RECIPES[0].id);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [streamingText, setStreamingText] = useState('');
  const [proposal, setProposal] = useState(null); // { newSource, hunks, rationale, parseOk }

  // Ensure the selected recipe stays applicable when the language changes.
  useEffect(() => {
    if (!applicableRecipes.find(r => r.id === selectedRecipeId)) {
      setSelectedRecipeId(applicableRecipes[0]?.id || '');
    }
  }, [applicableRecipes, selectedRecipeId]);

  const selection = useMemo(() => {
    if (!selectedEntry || !selectedEntry.range) return null;
    const [s, e] = selectedEntry.range;
    const text = source.slice(s, e);
    const lc = selectedEntry.loc
      ? `L${selectedEntry.loc.start.line}:${selectedEntry.loc.start.column}–L${selectedEntry.loc.end.line}:${selectedEntry.loc.end.column}`
      : null;
    return { range: [s, e], text, lineCol: lc };
  }, [selectedEntry, source]);

  const handleRunRefactor = useCallback(async () => {
    if (!selectedProviderId || !selectedModelId) {
      setStatus({ kind: 'error', message: 'Configure a provider/model first.' });
      return;
    }
    if (!apiKeyPresent) {
      setShowApiKeyDialog(true);
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', message: 'Calling model…' });
    setStreamingText('');
    try {
      const newSource = await llm.proposeRefactor({
        providerId: selectedProviderId,
        modelId: selectedModelId,
        recipeId: selectedRecipeId,
        source,
        language,
        selection: selection?.text || '',
        selectionRange: selection?.lineCol || 'whole file',
        extra,
        onChunk: (acc) => setStreamingText(acc),
      });

      if (!newSource || newSource === source) {
        setStatus({ kind: 'error', message: 'Model returned no change (or identical source).' });
        setBusy(false);
        return;
      }

      // Validate parseability of the new source before offering the diff.
      let parseOk = true;
      if (language === 'python') {
        const r = await parserPy.parse(newSource);
        parseOk = !r.error;
      } else {
        const r = parserJs.parse(newSource, language);
        parseOk = !!r.ast && !r.loose && !r.error;
      }

      const hunks = await buildHunks(source, newSource);
      const summary = summariseHunks(hunks);

      if (!parseOk) {
        setStatus({ kind: 'error', message: 'Proposed source fails to parse. Review the diff carefully — hunks are rejected by default.' });
        for (const h of hunks) h.accepted = false;
      } else {
        setStatus({ kind: 'success', message: `Proposal ready: ${summary.count} hunk${summary.count === 1 ? '' : 's'}, +${summary.add}/−${summary.del}. Review below.` });
      }
      setProposal({ newSource, hunks, rationale: '', parseOk });
    } catch (e) {
      setStatus({ kind: 'error', message: `Refactor failed: ${e.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [selectedProviderId, selectedModelId, selectedRecipeId, source, language, selection, extra, apiKeyPresent]);

  const handleToggleHunk = useCallback((id) => {
    setProposal(p => p && ({ ...p, hunks: p.hunks.map(h => h.id === id ? { ...h, accepted: !h.accepted } : h) }));
  }, []);

  const handleAcceptAll = useCallback(() => {
    setProposal(p => p && ({ ...p, hunks: p.hunks.map(h => ({ ...h, accepted: true })) }));
  }, []);
  const handleRejectAll = useCallback(() => {
    setProposal(p => p && ({ ...p, hunks: p.hunks.map(h => ({ ...h, accepted: false })) }));
  }, []);

  const handleApply = useCallback(() => {
    if (!proposal) return;
    const merged = applyHunks(source, proposal.hunks);
    setSource(merged);
    setProposal(null);
    setStatus({ kind: 'success', message: 'Applied. Source re-parsed below.' });
  }, [proposal, source]);

  const handleCancel = useCallback(() => {
    setProposal(null);
    setStatus(null);
  }, []);

  // ── Sessions ──
  const [sessions, setSessions] = useState([]);
  const [showSessions, setShowSessions] = useState(false);

  const refreshSessions = useCallback(async () => {
    if (!hasRoot) return;
    const list = await sessionStore.listSessions();
    setSessions(list);
  }, [hasRoot]);
  useEffect(() => { refreshSessions(); }, [hasRoot, refreshSessions]);

  const handlePickRoot = useCallback(async () => {
    try {
      await sessionStore.pickRoot();
      setHasRoot(true);
      refreshSessions();
    } catch (e) {
      if (e.name !== 'AbortError') alert('Failed to pick directory: ' + e.message);
    }
  }, [refreshSessions]);

  const handleSave = useCallback(async () => {
    if (!hasRoot) return;
    try {
      const saved = await sessionStore.saveSession({
        id: sessionId || undefined,
        name: sessionName,
        language,
        source,
      });
      setSessionId(saved.id);
      refreshSessions();
      setStatus({ kind: 'success', message: `Saved as "${saved.name}".` });
    } catch (e) {
      setStatus({ kind: 'error', message: 'Save failed: ' + e.message });
    }
  }, [hasRoot, sessionId, sessionName, language, source, refreshSessions]);

  const handleOpenSession = useCallback((s) => {
    setSessionId(s.id);
    setSessionName(s.name);
    setLanguage(s.language);
    setSource(s.source);
    setShowSessions(false);
    setProposal(null);
    setStatus(null);
  }, []);

  const handleDeleteSession = useCallback(async (id) => {
    await sessionStore.deleteSession(id);
    refreshSessions();
    if (sessionId === id) setSessionId(null);
  }, [refreshSessions, sessionId]);

  // ── Help ──
  const [showHelp, setShowHelp] = useState(false);

  // ── Render ──
  return html`
    <${Toolbar}
      theme=${theme}
      onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      language=${language}
      onLanguageChange=${handleLanguageChange}
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
      parseStatus=${parseStatus}
      onHelpClick=${() => setShowHelp(true)}
    />
    <div class="app-body split">
      <div class="pane pane-source">
        <div class="pane-header">
          <span>Source</span>
          ${parsingPy && html`<span class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Pyodide…</span>`}
          <div class="spacer"></div>
          <button class="btn btn-small" title="Reset to starter template"
                  onClick=${() => { if (confirm('Reset source to starter?')) setSource(STARTER[language]); }}>
            <i class="fa-solid fa-rotate-left"></i> Reset
          </button>
        </div>
        <div class="pane-body">
          <${SourcePane}
            value=${source}
            language=${language}
            theme=${theme}
            onChange=${setSource}
            onCursorChange=${handleCursorChange}
            highlight=${highlight}
          />
        </div>
      </div>
      <div class="pane pane-tree">
        <div class="pane-header">
          <span>AST</span>
          <div class="spacer"></div>
          <button class="btn btn-small" title="Expand all" onClick=${() => {
            if (!tree?.byId) return;
            setExpandedIds(new Set(tree.byId.keys()));
            setExpandAllToken(t => t + 1);
          }}>
            <i class="fa-solid fa-angles-down"></i>
          </button>
          <button class="btn btn-small" title="Collapse all" onClick=${() => {
            if (!tree?.root) return;
            setExpandedIds(new Set([tree.root.id]));
            setExpandAllToken(t => t + 1);
          }}>
            <i class="fa-solid fa-angles-up"></i>
          </button>
        </div>
        <div class="pane-body">
          <${AstTree}
            tree=${tree}
            selectedId=${selectedId}
            onSelect=${handleSelectFromTree}
            expandedIds=${expandedIds}
            onToggleExpand=${handleToggleExpand}
            expandAllToken=${expandAllToken}
          />
        </div>
      </div>
      <div class="pane pane-right">
        <div class="right-tabs">
          <button class=${`right-tab ${rightTab === 'details' ? 'active' : ''}`} onClick=${() => setRightTab('details')}>
            Node details
          </button>
          <button class=${`right-tab ${rightTab === 'refactor' ? 'active' : ''}`} onClick=${() => setRightTab('refactor')}>
            Refactor
          </button>
          <div class="right-tab-spacer"></div>
        </div>
        <div class="pane-body" style=${{ overflow: 'hidden' }}>
          ${rightTab === 'details'
            ? html`<${NodeDetails} entry=${selectedEntry} source=${source} />`
            : html`<${RefactorPanel}
                recipes=${applicableRecipes}
                selectedRecipeId=${selectedRecipeId}
                onSelectRecipe=${setSelectedRecipeId}
                selection=${selection}
                extra=${extra}
                onExtraChange=${setExtra}
                onRun=${handleRunRefactor}
                busy=${busy}
                status=${status}
                streamingText=${streamingText}
                modelReady=${!!selectedModelId}
                language=${language}
              />`
          }
        </div>
      </div>
    </div>
    ${proposal && html`
      <${DiffOverlay}
        hunks=${proposal.hunks}
        rationale=${proposal.rationale}
        parseOk=${proposal.parseOk}
        onToggleHunk=${handleToggleHunk}
        onAcceptAll=${handleAcceptAll}
        onRejectAll=${handleRejectAll}
        onApply=${handleApply}
        onCancel=${handleCancel}
      />
    `}
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
        title="AST Explorer & Refactor Lab — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
  `;
}

function expandAncestors(entry, tree, setExpandedIds) {
  // Build a parent map once per tree by walking down.
  if (!tree.byId || !tree.root) return;
  const parentOf = new Map();
  function walk(e, parent) {
    if (parent) parentOf.set(e.id, parent.id);
    for (const g of e.children) for (const k of g.nodes) walk(k, e);
  }
  walk(tree.root, null);

  setExpandedIds(prev => {
    const next = new Set(prev);
    let cur = entry.id;
    while (cur != null && parentOf.has(cur)) {
      cur = parentOf.get(cur);
      next.add(cur);
    }
    return next;
  });
}

render(html`<${App} />`, document.getElementById('app'));

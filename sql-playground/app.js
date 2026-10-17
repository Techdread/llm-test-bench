import { html, render } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { DbList } from './components/DbList.js';
import { TableTree } from './components/TableTree.js';
import { SnippetsList } from './components/SnippetsList.js';
import { SqlEditor } from './components/SqlEditor.js';
import { ResultsGrid } from './components/ResultsGrid.js';
import { SchemaDiagram } from './components/SchemaDiagram.js';
import { PlanTree } from './components/PlanTree.js';
import { AssistantPanel } from './components/AssistantPanel.js';
import { Toast } from './components/Toast.js';
import { ApiKeyDialog } from '../shader-lab/components/ApiKeyDialog.js';
import { ProviderSettingsDialog } from '../shared/components/ProviderSettingsDialog.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';

import * as sqljs from './services/sqljsBridge.js';
import * as store from './services/dbStore.js';
import * as llm from './services/openrouter.js';
import * as modelProviders from '../shared/services/model-providers.js';
import { parseCsv, stringifyCsv, inferType, triggerDownload } from './services/csv.js';

const THEME_KEY = 'sql-playground-theme';
const DEFAULT_SQL = `-- Welcome to SQL Playground (in-browser SQLite).
-- Ctrl+Enter to run. Click a table in the left panel to browse it.

CREATE TABLE IF NOT EXISTS customer (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT
);

CREATE TABLE IF NOT EXISTS "order" (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer(id),
  total REAL NOT NULL,
  placed_at TEXT
);

INSERT OR IGNORE INTO customer (id, name, country) VALUES
  (1, 'Alice',   'UK'),
  (2, 'Bob',     'US'),
  (3, 'Caroline','DE');

INSERT OR IGNORE INTO "order" (id, customer_id, total, placed_at) VALUES
  (1, 1, 42.00, '2025-01-01'),
  (2, 1, 9.50,  '2025-01-12'),
  (3, 2, 17.25, '2025-01-15'),
  (4, 3, 81.00, '2025-02-02');

SELECT c.name, SUM(o.total) AS spent
FROM customer c
JOIN "order" o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY spent DESC;`;

// ── Save-as dialog ──
function NameDialog({ title, placeholder, initial, onSubmit, onClose }) {
  const [value, setValue] = useState(initial || '');
  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name</label>
            <input class="form-input" autofocus value=${value}
                   placeholder=${placeholder || ''}
                   onInput=${(e) => setValue(e.target.value)}
                   onKeyDown=${(e) => e.key === 'Enter' && value.trim() && onSubmit(value.trim())} />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${() => value.trim() && onSubmit(value.trim())}>OK</button>
        </div>
      </div>
    </div>
  `;
}

function CsvImportDialog({ file, onImport, onClose }) {
  const [previewText, setPreviewText] = useState('');
  const [tableName, setTableName] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!file) return;
    file.text().then(text => {
      setPreviewText(text.slice(0, 4000));
      setRows(parseCsv(text));
      const base = (file.name || 'imported').replace(/\.csv$/i, '').replace(/[^a-z0-9_]+/gi, '_');
      setTableName(base);
    });
  }, [file]);

  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ width: '560px' }}>
        <div class="modal-header">
          <h2>Import CSV</h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Table name</label>
            <input class="form-input" value=${tableName} onInput=${(e) => setTableName(e.target.value)} />
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" checked=${hasHeader} onChange=${(e) => setHasHeader(e.target.checked)} />
              First row is header
            </label>
          </div>
          <div class="form-group">
            <label>Preview</label>
            <div class="csv-preview">${previewText}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary"
                  disabled=${!tableName.trim() || rows.length === 0}
                  onClick=${() => onImport({ tableName: tableName.trim(), rows, hasHeader })}>
            Import
          </button>
        </div>
      </div>
    </div>
  `;
}

function App() {
  // ── Theme ──
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ── DB state ──
  const dbRef = useRef(null);
  const [dbName, setDbName] = useState('scratchpad');
  const [persistent, setPersistent] = useState(false); // true once saved
  const [dirty, setDirty] = useState(false);
  const [schema, setSchema] = useState({ tables: [], indexes: [] });
  const [dbList, setDbList] = useState([]);
  const [loadingDb, setLoadingDb] = useState(true);

  // ── SQL state ──
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(null);
  const [running, setRunning] = useState(false);
  const [plan, setPlan] = useState([]);
  const [activeResultsTab, setActiveResultsTab] = useState('results'); // results | plan
  const [rightTab, setRightTab] = useState('schema'); // schema | diagram | assistant
  const [snippets, setSnippets] = useState([]);

  const editorApi = useRef(null);
  const fileInputRef = useRef(null);
  const sqlFileInputRef = useRef(null);
  const sqliteFileInputRef = useRef(null);

  // ── Toasts ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  // ── Dialogs ──
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [nameDialog, setNameDialog] = useState(null); // { title, initial, onSubmit }
  const [csvImport, setCsvImport] = useState(null); // File

  // ── Providers ──
  const [apiKeyPresent, setApiKeyPresent] = useState(() => llm.hasApiKey());
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    modelProviders.getEffectiveSelection('sql-playground-provider', 'sql-playground-model').provider);
  const [selectedModelId, setSelectedModelId] = useState(() =>
    modelProviders.getEffectiveSelection('sql-playground-provider', 'sql-playground-model').model);

  useEffect(() => {
    if (selectedProviderId) localStorage.setItem('sql-playground-provider', selectedProviderId);
    if (selectedModelId) localStorage.setItem('sql-playground-model', selectedModelId);
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
    } catch (e) {
      console.warn('load models', e);
    } finally {
      setModelsLoading(false);
    }
  }, [selectedProviderId]);

  // ── Schema refresh ──
  const refreshSchema = useCallback(() => {
    const db = dbRef.current;
    if (!db) return;
    try {
      setSchema(sqljs.introspect(db));
    } catch (e) {
      console.warn('introspect failed', e);
    }
  }, []);

  // ── Init: open in-memory DB, load bootstrap SQL, list persisted DBs ──
  useEffect(() => {
    (async () => {
      try {
        const db = await sqljs.createDb();
        dbRef.current = db;
        // Seed the default script so the schema shows up.
        try { sqljs.execScript(db, DEFAULT_SQL); } catch {}
        refreshSchema();
      } catch (e) {
        console.error(e);
        addToast(`Failed to load sql.js: ${e.message}`, 'error');
      } finally {
        setLoadingDb(false);
      }
      try { setDbList(await store.listDbs()); } catch {}
      loadModels();
    })();
  }, []);

  // ── Warn on close if dirty ──
  useEffect(() => {
    const handler = (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Run SQL ──
  const runSqlInternal = useCallback(async (sqlToRun, { silent = false } = {}) => {
    const db = dbRef.current;
    if (!db) return null;
    setRunning(true);
    setError(null);
    const started = performance.now();
    try {
      const results = sqljs.runScriptWithResults(db, sqlToRun);
      const elapsed = performance.now() - started;
      const last = results.length > 0
        ? { columns: results[results.length - 1].columns, rows: results[results.length - 1].rows }
        : { columns: [], rows: [] };
      if (!silent) {
        setResult(last);
        setDuration(elapsed);
        setActiveResultsTab('results');
        addToast(`Query OK · ${last.rows.length.toLocaleString()} row${last.rows.length === 1 ? '' : 's'} · ${Math.round(elapsed)} ms`, 'success');
      }
      setDirty(true);
      refreshSchema();
      return last;
    } catch (e) {
      if (!silent) {
        setError(String(e.message || e));
        setResult(null);
        setDuration(null);
      }
      throw e;
    } finally {
      setRunning(false);
    }
  }, [addToast, refreshSchema]);

  const handleRun = useCallback(async () => {
    const toRun = editorApi.current?.getSelectedOrAll() || sql;
    try {
      await runSqlInternal(toRun);
    } catch (e) {
      addToast(`SQL error: ${e.message}`, 'error');
    }
  }, [sql, runSqlInternal, addToast]);

  const handleRunPlan = useCallback(() => {
    const db = dbRef.current;
    if (!db) return;
    const toRun = editorApi.current?.getSelectedOrAll() || sql;
    try {
      const tree = sqljs.explainPlan(db, toRun);
      setPlan(tree);
      setActiveResultsTab('plan');
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
      setActiveResultsTab('results');
    }
  }, [sql]);

  // ── Table tree interactions ──
  const handleInsertRef = useCallback((text) => {
    // Quote the identifier if it collides with a reserved word or contains spaces.
    const quote = /[\s"]/.test(text) || /^(order|select|from|where|group|join|table|user)$/i.test(text);
    editorApi.current?.insertText(quote ? `"${text}"` : text);
  }, []);

  const handleBrowse = useCallback((tableName) => {
    const q = `SELECT * FROM ${/[\s"]|^(order|select|from|where|group|join|table|user)$/i.test(tableName) ? `"${tableName}"` : tableName} LIMIT 200;`;
    runSqlInternal(q).catch(e => addToast(`Browse failed: ${e.message}`, 'error'));
  }, [runSqlInternal, addToast]);

  // ── Format ──
  const handleFormat = useCallback(() => {
    editorApi.current?.format();
  }, []);

  // ── Save / Load DBs ──
  const refreshDbList = useCallback(async () => {
    try { setDbList(await store.listDbs()); } catch {}
  }, []);

  const saveCurrent = useCallback(async (name) => {
    const db = dbRef.current;
    if (!db) return;
    try {
      const bytes = sqljs.exportDb(db);
      const id = await store.saveDb(name, bytes);
      setDbName(id);
      setPersistent(true);
      setDirty(false);
      refreshDbList();
      addToast(`Saved "${id}"`, 'success');
    } catch (e) {
      addToast(`Save failed: ${e.message}`, 'error');
    }
  }, [addToast, refreshDbList]);

  const handleSave = useCallback(() => {
    if (persistent && dbName) {
      saveCurrent(dbName);
    } else {
      setNameDialog({
        title: 'Save database',
        initial: dbName,
        placeholder: 'e.g. my-store',
        onSubmit: (n) => { setNameDialog(null); saveCurrent(n); },
      });
    }
  }, [persistent, dbName, saveCurrent]);

  const handleSaveAs = useCallback(() => {
    setNameDialog({
      title: 'Save database as…',
      initial: dbName,
      onSubmit: (n) => { setNameDialog(null); saveCurrent(n); },
    });
  }, [dbName, saveCurrent]);

  const handleRename = useCallback(() => {
    setNameDialog({
      title: 'Rename database',
      initial: dbName,
      onSubmit: async (n) => {
        setNameDialog(null);
        if (!n || n === dbName) return;
        // "rename" = save under new name and delete old if persistent.
        try {
          const bytes = sqljs.exportDb(dbRef.current);
          const id = await store.saveDb(n, bytes);
          if (persistent && dbName && dbName !== id) {
            try { await store.deleteDb(dbName); } catch {}
          }
          setDbName(id);
          setPersistent(true);
          setDirty(false);
          refreshDbList();
          addToast(`Renamed to "${id}"`, 'success');
        } catch (e) {
          addToast(`Rename failed: ${e.message}`, 'error');
        }
      },
    });
  }, [dbName, persistent, refreshDbList, addToast]);

  const handleSelectDb = useCallback(async (name) => {
    if (dirty && !confirm(`Discard unsaved changes in "${dbName}"?`)) return;
    try {
      const bytes = await store.loadDb(name);
      if (!bytes) throw new Error('DB not found');
      const db = await sqljs.createDb(bytes);
      try { dbRef.current?.close?.(); } catch {}
      dbRef.current = db;
      setDbName(name);
      setPersistent(true);
      setDirty(false);
      setResult(null);
      setError(null);
      setPlan([]);
      refreshSchema();
      const snips = await store.loadSnippets(name);
      setSnippets(snips);
      addToast(`Loaded "${name}"`, 'info');
    } catch (e) {
      addToast(`Load failed: ${e.message}`, 'error');
    }
  }, [dirty, dbName, refreshSchema, addToast]);

  const handleDeleteDb = useCallback(async (name) => {
    if (!confirm(`Delete database "${name}"?`)) return;
    try {
      await store.deleteDb(name);
      refreshDbList();
      addToast(`Deleted "${name}"`, 'info');
      if (name === dbName) {
        setPersistent(false);
      }
    } catch (e) {
      addToast(`Delete failed: ${e.message}`, 'error');
    }
  }, [addToast, refreshDbList, dbName]);

  const handleNewDb = useCallback(() => {
    setNameDialog({
      title: 'New database',
      placeholder: 'e.g. notes',
      initial: '',
      onSubmit: async (n) => {
        setNameDialog(null);
        try {
          const db = await sqljs.createDb();
          try { dbRef.current?.close?.(); } catch {}
          dbRef.current = db;
          setDbName(n);
          setPersistent(false);
          setDirty(false);
          setResult(null);
          setError(null);
          setPlan([]);
          setSchema({ tables: [], indexes: [] });
          setSnippets([]);
          addToast(`New DB "${n}" ready (unsaved)`, 'info');
        } catch (e) {
          addToast(`New DB failed: ${e.message}`, 'error');
        }
      },
    });
  }, [addToast]);

  const handleExportDbFile = useCallback(async (name) => {
    try {
      const bytes = name === dbName
        ? sqljs.exportDb(dbRef.current)
        : await store.loadDb(name);
      if (!bytes) throw new Error('DB not found');
      const blob = new Blob([bytes], { type: 'application/vnd.sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.sqlite`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      addToast(`Export failed: ${e.message}`, 'error');
    }
  }, [addToast, dbName]);

  const handleImportDbFile = useCallback(() => sqliteFileInputRef.current?.click(), []);

  const handleSqliteFileChosen = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const db = await sqljs.createDb(bytes);
      try { dbRef.current?.close?.(); } catch {}
      dbRef.current = db;
      const base = (file.name || 'imported').replace(/\.(sqlite|db|sqlite3)$/i, '');
      setDbName(base);
      setPersistent(false);
      setDirty(true);
      setResult(null);
      setError(null);
      setPlan([]);
      refreshSchema();
      addToast(`Loaded "${file.name}" (unsaved)`, 'info');
    } catch (err) {
      addToast(`Import failed: ${err.message}`, 'error');
    }
  }, [addToast, refreshSchema]);

  // ── CSV import / export ──
  const handleImportCsvClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleCsvFileChosen = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCsvImport(file);
  }, []);

  const handleCsvImport = useCallback(({ tableName, rows, hasHeader }) => {
    const db = dbRef.current;
    if (!db) { setCsvImport(null); return; }
    try {
      if (rows.length === 0) throw new Error('CSV is empty');
      let columns, dataRows;
      if (hasHeader) {
        columns = rows[0].map(c => c.trim() || 'col');
        dataRows = rows.slice(1);
      } else {
        columns = rows[0].map((_, i) => `col${i + 1}`);
        dataRows = rows;
      }
      // De-dupe column names.
      const seen = new Set();
      columns = columns.map(c => {
        let base = c.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!base) base = 'col';
        let n = base, i = 2;
        while (seen.has(n)) { n = `${base}_${i++}`; }
        seen.add(n);
        return n;
      });
      const types = columns.map((_, colIdx) => inferType(dataRows.map(r => r[colIdx])));
      const quoted = (s) => sqljs.quoteIdent(s);
      const ddl = `CREATE TABLE ${quoted(tableName)} (${columns.map((c, i) => `${quoted(c)} ${types[i]}`).join(', ')});`;
      db.run(`DROP TABLE IF EXISTS ${quoted(tableName)};`);
      db.run(ddl);
      db.run('BEGIN');
      const stmt = db.prepare(`INSERT INTO ${quoted(tableName)} VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of dataRows) {
        const coerced = row.slice(0, columns.length).map((v, i) => {
          if (v === '') return null;
          if (types[i] === 'INTEGER') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
          if (types[i] === 'REAL') { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
          return v;
        });
        while (coerced.length < columns.length) coerced.push(null);
        stmt.run(coerced);
      }
      stmt.free();
      db.run('COMMIT');
      refreshSchema();
      setDirty(true);
      setCsvImport(null);
      addToast(`Imported ${dataRows.length.toLocaleString()} rows into "${tableName}"`, 'success');
    } catch (err) {
      try { dbRef.current?.run('ROLLBACK'); } catch {}
      addToast(`CSV import failed: ${err.message}`, 'error');
    }
  }, [addToast, refreshSchema]);

  const handleExportCsv = useCallback(() => {
    if (!result) { addToast('No results to export', 'error'); return; }
    const rows = [result.columns, ...result.rows.map(r => r.map(v => (v == null ? '' : v instanceof Uint8Array ? '' : v)))];
    const csv = stringifyCsv(rows);
    triggerDownload(`results-${Date.now()}.csv`, csv);
    addToast('Results exported', 'success');
  }, [result, addToast]);

  // ── SQL file import (run as script) ──
  const handleImportSqlClick = useCallback(() => sqlFileInputRef.current?.click(), []);
  const handleSqlFileChosen = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      await runSqlInternal(text);
      addToast(`Ran "${file.name}"`, 'success');
    } catch (err) {
      addToast(`Script failed: ${err.message}`, 'error');
    }
  }, [runSqlInternal, addToast]);

  // ── Snippets ──
  const persistSnippets = useCallback(async (list) => {
    if (!persistent) {
      // If the DB isn't saved yet, keep snippets in localStorage under the current name.
      localStorage.setItem(`sql-playground-snippets:${dbName}`, JSON.stringify(list));
    } else {
      try { await store.saveSnippets(dbName, list); } catch {}
    }
  }, [persistent, dbName]);

  const handleSaveSnippet = useCallback((name) => {
    const snippet = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, sql };
    const next = [...snippets, snippet];
    setSnippets(next);
    persistSnippets(next);
    addToast(`Saved snippet "${name}"`, 'success');
  }, [snippets, sql, persistSnippets, addToast]);

  const handleLoadSnippet = useCallback((snippet) => {
    editorApi.current?.setValue(snippet.sql);
  }, []);

  const handleDeleteSnippet = useCallback((id) => {
    const next = snippets.filter(s => s.id !== id);
    setSnippets(next);
    persistSnippets(next);
  }, [snippets, persistSnippets]);

  // ── LLM ──
  const llmReady = !!(selectedProviderId && selectedModelId && (apiKeyPresent || allModels.length > 0));
  const [llmBusy, setLlmBusy] = useState(false);

  const withLlm = useCallback(async (label, fn) => {
    if (!llmReady) {
      addToast('Pick a model first', 'error');
      setShowProviderSettings(true);
      throw new Error('no model');
    }
    setLlmBusy(true);
    try {
      return await fn();
    } catch (e) {
      addToast(`${label} failed: ${e.message}`, 'error');
      throw e;
    } finally {
      setLlmBusy(false);
    }
  }, [llmReady, addToast]);

  const handleSuggestQuery = useCallback(async (question) => {
    const { sql: out } = await withLlm('Suggest', () =>
      llm.suggestQuery({ schema, question, providerId: selectedProviderId, modelId: selectedModelId }));
    return out;
  }, [withLlm, schema, selectedProviderId, selectedModelId]);

  const handleDraftSchema = useCallback(async (description) => {
    const { sql: out } = await withLlm('Draft schema', () =>
      llm.draftSchema({ description, providerId: selectedProviderId, modelId: selectedModelId }));
    return out;
  }, [withLlm, selectedProviderId, selectedModelId]);

  const handleDraftSeed = useCallback(async (rowsPerTable) => {
    const { sql: out } = await withLlm('Seed data', () =>
      llm.draftSeed({ schema, rowsPerTable, providerId: selectedProviderId, modelId: selectedModelId }));
    return out;
  }, [withLlm, schema, selectedProviderId, selectedModelId]);

  const handleExplainQuery = useCallback(async (sqlText) => {
    const { text } = await withLlm('Explain', () =>
      llm.explainQuery({ schema, sql: sqlText, providerId: selectedProviderId, modelId: selectedModelId }));
    return text;
  }, [withLlm, schema, selectedProviderId, selectedModelId]);

  const handleInsertToEditor = useCallback((text) => {
    editorApi.current?.setValue(text);
    addToast('Inserted into editor', 'info');
  }, [addToast]);

  const handleRunSqlScript = useCallback(async (text) => {
    try {
      await runSqlInternal(text);
    } catch (e) {
      addToast(`SQL error: ${e.message}`, 'error');
    }
  }, [runSqlInternal, addToast]);

  // ── Right tab body ──
  const rightBody = useMemo(() => {
    switch (rightTab) {
      case 'schema':
        return html`<${TableTree} schema=${schema} onInsertRef=${handleInsertRef} onBrowse=${handleBrowse} />`;
      case 'diagram':
        return html`<${SchemaDiagram} schema=${schema} />`;
      case 'assistant':
        return html`
          <${AssistantPanel}
            schema=${schema}
            currentSql=${sql}
            busy=${llmBusy}
            disabled=${!llmReady}
            onSuggest=${handleSuggestQuery}
            onDraftSchema=${handleDraftSchema}
            onDraftSeed=${handleDraftSeed}
            onExplain=${handleExplainQuery}
            onInsertToEditor=${handleInsertToEditor}
            onRunSqlScript=${handleRunSqlScript}
          />
        `;
      default: return null;
    }
  }, [rightTab, schema, sql, llmBusy, llmReady, handleInsertRef, handleBrowse,
      handleSuggestQuery, handleDraftSchema, handleDraftSeed, handleExplainQuery,
      handleInsertToEditor, handleRunSqlScript]);

  if (loadingDb) {
    return html`
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
        <i class="fa-solid fa-spinner fa-spin" style=${{ marginRight: '10px' }}></i>
        Loading sql.js…
      </div>
    `;
  }

  return html`
    <${Toolbar}
      theme=${theme}
      onToggleTheme=${() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      onRun=${handleRun}
      onRunPlan=${handleRunPlan}
      running=${running}
      onFormat=${handleFormat}
      onImportCsv=${handleImportCsvClick}
      onExportCsv=${handleExportCsv}
      onImportSql=${handleImportSqlClick}
      dbName=${dbName}
      dirty=${dirty}
      onSave=${handleSave}
      onSaveAs=${handleSaveAs}
      onRename=${handleRename}
      allModels=${allModels}
      modelsLoading=${modelsLoading}
      selectedProviderId=${selectedProviderId}
      selectedModelId=${selectedModelId}
      onModelChange=${(p, m) => { setSelectedProviderId(p); setSelectedModelId(m); }}
      apiKeySet=${apiKeyPresent}
      onApiKeyClick=${() => setShowApiKeyDialog(true)}
      onProviderSettingsClick=${() => setShowProviderSettings(true)}
      onHelpClick=${() => setShowHelp(true)}
    />

    <div class="app-body">
      <aside class="left-panel">
        <${DbList}
          dbs=${dbList}
          current=${persistent ? dbName : null}
          dirty=${dirty}
          onSelect=${handleSelectDb}
          onNew=${handleNewDb}
          onDelete=${handleDeleteDb}
          onExport=${handleExportDbFile}
          onImport=${handleImportDbFile}
        />
        <${SnippetsList}
          snippets=${snippets}
          onLoad=${handleLoadSnippet}
          onDelete=${handleDeleteSnippet}
          onSaveCurrent=${handleSaveSnippet}
        />
      </aside>

      <section class="center-panel">
        <div class="sql-split">
          <div class="sql-editor-wrap">
            <${SqlEditor}
              value=${sql}
              theme=${theme}
              onChange=${setSql}
              onRun=${handleRun}
              apiRef=${editorApi}
            />
          </div>
          <div class="results-wrap">
            <div class="results-tabs">
              <button class=${`results-tab ${activeResultsTab === 'results' ? 'active' : ''}`}
                      onClick=${() => setActiveResultsTab('results')}>Results</button>
              <button class=${`results-tab ${activeResultsTab === 'plan' ? 'active' : ''}`}
                      onClick=${() => setActiveResultsTab('plan')}>Plan</button>
            </div>
            ${activeResultsTab === 'results'
              ? html`<${ResultsGrid} result=${result} error=${error} duration=${duration} />`
              : html`<div class="results-pane"><div style=${{ overflow: 'auto', padding: '8px' }}><${PlanTree} plan=${plan} /></div></div>`}
          </div>
        </div>
      </section>

      <aside class="right-panel">
        <div class="right-tabs">
          <button class=${`right-tab ${rightTab === 'schema' ? 'active' : ''}`} onClick=${() => setRightTab('schema')}>Schema</button>
          <button class=${`right-tab ${rightTab === 'diagram' ? 'active' : ''}`} onClick=${() => setRightTab('diagram')}>Diagram</button>
          <button class=${`right-tab ${rightTab === 'assistant' ? 'active' : ''}`} onClick=${() => setRightTab('assistant')}>Assistant</button>
        </div>
        <div class="right-tab-body">${rightBody}</div>
      </aside>
    </div>

    <input ref=${fileInputRef} type="file" accept=".csv,text/csv" style=${{ display: 'none' }}
           onChange=${handleCsvFileChosen} />
    <input ref=${sqlFileInputRef} type="file" accept=".sql,text/plain" style=${{ display: 'none' }}
           onChange=${handleSqlFileChosen} />
    <input ref=${sqliteFileInputRef} type="file" accept=".sqlite,.db,.sqlite3,application/x-sqlite3,application/vnd.sqlite3"
           style=${{ display: 'none' }} onChange=${handleSqliteFileChosen} />

    ${showApiKeyDialog && html`
      <${ApiKeyDialog}
        currentKey=${llm.getApiKey()}
        onSave=${(key) => {
          llm.saveApiKey(key);
          setApiKeyPresent(!!key);
          setShowApiKeyDialog(false);
          if (key) loadModels();
          addToast(key ? 'API key saved' : 'API key removed', 'success');
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
        title="SQL Playground — Help"
        onClose=${() => setShowHelp(false)}
      />
    `}
    ${nameDialog && html`
      <${NameDialog}
        title=${nameDialog.title}
        placeholder=${nameDialog.placeholder || ''}
        initial=${nameDialog.initial}
        onSubmit=${nameDialog.onSubmit}
        onClose=${() => setNameDialog(null)}
      />
    `}
    ${csvImport && html`
      <${CsvImportDialog}
        file=${csvImport}
        onImport=${handleCsvImport}
        onClose=${() => setCsvImport(null)}
      />
    `}
    <${Toast} toasts=${toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

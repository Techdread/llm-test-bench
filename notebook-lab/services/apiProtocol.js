import { cellId, newNotebookId } from './notebookStore.js';

export const API_VERSION = 'notebook-lab-api-v1';

const SUPPORTED_ACTIONS = new Set(['loadNotebook', 'runNotebook', 'saveNotebook', 'runAndSave']);

export function normalizeCommand(raw, fallbackRequestId = '') {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Command must be a JSON object');
  }
  const action = raw.action || 'runAndSave';
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error(`Unsupported Notebook Lab API action: ${action}`);
  }
  return {
    version: raw.version || API_VERSION,
    requestId: String(raw.requestId || fallbackRequestId || `job-${Date.now().toString(36)}`),
    action,
    notebook: raw.notebook ? normalizeNotebook(raw.notebook) : null,
    run: normalizeRunOptions(raw.run),
    save: normalizeSaveOptions(raw.save),
  };
}

export function normalizeNotebook(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Notebook payload is required');
  }
  const now = new Date().toISOString();
  const cells = Array.isArray(input.cells) ? input.cells : [];
  return {
    id: input.id || newNotebookId(),
    title: input.title || 'External Notebook',
    state: input.state && typeof input.state === 'object' ? input.state : {},
    cells: cells.map(normalizeCell),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function buildApiResult(command, runManifest, notebook, savedNotebook) {
  const target = savedNotebook || notebook || {};
  return {
    version: API_VERSION,
    requestId: command.requestId,
    ok: runManifest ? !!runManifest.ok : true,
    notebookId: target.id || null,
    notebookPath: target.id ? `notebook-lab/notebooks/${target.id}.json` : null,
    startedAt: runManifest?.startedAt || null,
    finishedAt: runManifest?.finishedAt || new Date().toISOString(),
    cells: runManifest?.cells || [],
  };
}

export function buildApiError(command, err) {
  return {
    version: API_VERSION,
    requestId: command?.requestId || null,
    ok: false,
    error: err?.message || String(err),
    finishedAt: new Date().toISOString(),
  };
}

function normalizeCell(cell) {
  if (!cell || typeof cell !== 'object') {
    throw new Error('Each notebook cell must be an object');
  }
  return {
    id: cell.id || cellId(),
    kind: cell.kind || 'md',
    source: cell.source || '',
    outputs: cell.outputs || null,
    error: cell.error || null,
    lastOutputText: cell.lastOutputText || '',
    metadata: cell.metadata || null,
  };
}

function normalizeRunOptions(run) {
  const opts = run && typeof run === 'object' ? run : {};
  return {
    mode: opts.mode || 'all',
    timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 10000,
    clearNbBeforeRun: opts.clearNbBeforeRun !== false,
    stopOnError: !!opts.stopOnError,
    cellIds: Array.isArray(opts.cellIds) ? opts.cellIds.map(String) : null,
  };
}

function normalizeSaveOptions(save) {
  const opts = save && typeof save === 'object' ? save : {};
  return {
    persistNotebook: opts.persistNotebook !== false,
    writeResultManifest: opts.writeResultManifest !== false,
  };
}

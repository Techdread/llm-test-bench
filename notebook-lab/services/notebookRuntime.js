import { runJs } from './runnerJs.js';
import { runPython } from './runnerPy.js';
import * as nbBridge from './nbBridge.js';
import { applyUiDefaults } from './uiCellModel.js';
import { installLuaNb } from './luaNb.js';
import { runSql } from './runnerSql.js';
import { tableOutputToText } from './sqlCell.js';
import { runSystemLanguage } from '../../shared/services/wasm-runtimes/runtimeManager.js';
import { getBackend } from '../../shared/services/runtime-backends.js';
import { kindAvailable, unavailableKindMessage } from './edition.js';

export const RUNNABLE_KINDS = new Set(['md', 'js', 'py', 'c', 'rust', 'lua', 'sql', 'java', 'go', 'scala', 'clojure']);

// Cell kinds that always run in the Debian guest (v86) — they boot the VM on
// first use (~30s) and compile under emulation, so they need a far larger
// ceiling than the wasm/remote runners.
const DEBIAN_VM_KINDS = new Set(['java', 'go']);
const DEBIAN_VM_TIMEOUT = 600000;

// Languages whose backend can be swapped via the toolbar runtimes dialog —
// when Debian is the active backend they need the long timeout too.
const SWAPPABLE_KINDS = new Set(['c', 'rust', 'py', 'scala', 'clojure']);

export function isRunnableKind(kind) {
  return RUNNABLE_KINDS.has(kind);
}

export function outputsToText(outputs, error) {
  if (error) return 'Error: ' + error;
  if (!outputs) return '';
  return outputs.map(o => {
    if (o.type === 'text') return o.value;
    if (o.type === 'image') return '[image]';
    if (o.type === 'table') return tableOutputToText(o);
    if (o.type === 'value') {
      if (typeof o.value === 'string') return o.value;
      try { return JSON.stringify(o.value); } catch { return String(o.value); }
    }
    return '';
  }).filter(Boolean).join('\n');
}

export async function executeCell(cell, options = {}) {
  const kind = cell.kind || 'md';

  if (kind === 'html' || kind === 'chart' || kind === 'ui') {
    // Running a UI cell seeds nb with any control defaults not already set, so
    // downstream cells see them even when the cell was never rendered (headless
    // runs, or a Run-All where the UI cell is still off-screen).
    if (kind === 'ui') {
      try { applyUiDefaults(cell.source || '', nbBridge); } catch { /* bad JSON — the editor surfaces it */ }
    }
    return {
      ok: true,
      outputs: null,
      error: null,
      lastOutputText: '',
      outputCleared: false,
      metadata: mergeMetadata(cell.metadata, { runtimeKind: 'rendered' }),
    };
  }

  let result;
  if (!kindAvailable(kind)) {
    result = { ok: false, outputs: [], error: unavailableKindMessage(kind) };
  } else if (kind === 'js') {
    result = await runJs(cell.source || '');
  } else if (kind === 'py') {
    // Pyodide path (default) keeps two-way nb + matplotlib figure capture.
    // Debian path falls back to the emit-only system-language pipeline.
    if (getBackend('py') === 'debian') {
      result = runResultToNotebookResult(
        await runSystemLanguage('py', cell.source || '', { timeout: DEBIAN_VM_TIMEOUT, onStatus: options.onStatus })
      );
    } else {
      result = await runPython(cell.source || '', options.onStatus || (() => {}));
    }
  } else if (kind === 'sql') {
    result = await runSql(cell.source || '', nbBridge);
  } else if (kind === 'lua') {
    // Lua runs in this page (Wasmoon), so it gets a live, two-way `nb`.
    result = runResultToNotebookResult(
      await runSystemLanguage('lua', cell.source || '', {
        timeout: options.timeoutMs,
        onStatus: options.onStatus,
        prepare: (lua) => installLuaNb(lua, nbBridge),
      })
    );
  } else if (SWAPPABLE_KINDS.has(kind)) {
    const timeout = getBackend(kind) === 'debian' ? DEBIAN_VM_TIMEOUT : options.timeoutMs;
    // C (xcc, <nb.h>) and Clojure (nb/get and nb/set, on either backend) read
    // and write nb; the other backends ignore this.
    const nb = kind === 'c' || kind === 'clojure' ? { snapshot: nbBridge.snapshot, set: nbBridge.setValue } : undefined;
    result = runResultToNotebookResult(
      await runSystemLanguage(kind, cell.source || '', { timeout, onStatus: options.onStatus, nb })
    );
  } else if (DEBIAN_VM_KINDS.has(kind)) {
    result = runResultToNotebookResult(
      await runSystemLanguage(kind, cell.source || '', { timeout: DEBIAN_VM_TIMEOUT, onStatus: options.onStatus })
    );
  } else if (kind === 'md') {
    result = { ok: true, outputs: [] };
  } else {
    result = {
      ok: false,
      outputs: [],
      error: `Unsupported cell kind: ${kind}`,
    };
  }

  return {
    outputs: result.outputs || [],
    error: result.ok ? null : result.error || 'Unknown error',
    lastOutputText: outputsToText(result.outputs, result.ok ? null : result.error),
    outputCleared: false,
    metadata: mergeMetadata(cell.metadata, result.metadata),
    ok: !!result.ok,
  };
}

export async function runNotebook(notebook, options = {}) {
  const startedAt = new Date().toISOString();
  const stopOnError = !!options.stopOnError;
  const cells = (notebook.cells || []).map(c => ({ ...c }));
  const cellResults = [];

  if (options.clearNbBeforeRun) {
    nbBridge.clear();
  }

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (options.cellIds && !options.cellIds.includes(cell.id)) continue;

    if (options.onCellStart) options.onCellStart(cell, i);

    let patch;
    try {
      patch = await executeCell(cell, {
        timeoutMs: options.timeoutMs,
        onStatus: options.onStatus,
      });
    } catch (err) {
      patch = {
        ok: false,
        outputs: null,
        error: err.message || String(err),
        lastOutputText: 'Error: ' + (err.message || String(err)),
        outputCleared: false,
        metadata: null,
      };
    }

    cells[i] = { ...cell, ...patch };
    const cellSummary = cellToResult(cells[i], patch);
    cellResults.push(cellSummary);

    if (options.onCellResult) options.onCellResult(cells[i], i, patch);
    if (!patch.ok && stopOnError) break;
  }

  const finishedAt = new Date().toISOString();
  const nextNotebook = {
    ...notebook,
    cells,
    state: nbBridge.snapshot(),
    updatedAt: finishedAt,
  };

  return {
    notebook: nextNotebook,
    manifest: {
      version: 'notebook-lab-api-v1',
      ok: cellResults.every(c => c.ok),
      notebookId: nextNotebook.id,
      startedAt,
      finishedAt,
      cells: cellResults,
    },
  };
}

function mergeMetadata(existing, patch) {
  if (!patch) return existing || null;
  return {
    ...(existing || {}),
    ...patch,
  };
}

export function runResultToNotebookResult(result) {
  const outputs = [];
  const stdout = applyNbMarkers(result.stdout || '');

  if (stdout) outputs.push({ type: 'text', value: stdout });
  if (result.compileLog) outputs.push({ type: 'text', role: 'compile', value: result.compileLog });
  if (result.stderr) outputs.push({ type: 'text', role: 'stderr', value: result.stderr });

  const ok = !!result.runSucceeded;
  return {
    ok,
    outputs,
    error: ok ? null : leadWithPrinted(stdout, result.stderr || result.compileLog || 'Execution failed'),
    metadata: {
      language: result.language,
      runtimeKind: result.runtimeKind,
      compileSucceeded: result.compileSucceeded,
      durationMs: result.durationMs,
    },
  };
}

// A failed cell shows only its error, so the error starts with what the program
// printed before it failed. The browser runners (xcc, Scittle) already put it
// there; the Debian ones (Java, Go, Clojure on the JVM, …) report it separately.
const squash = (text) => text.replace(/\s+/g, ' ').trim();
function leadWithPrinted(printed, problem) {
  const before = squash(printed);
  if (!before || squash(problem).startsWith(before)) return problem;
  return `${printed.replace(/\n+$/, '')}\n${problem}`;
}

function applyNbMarkers(stdout) {
  const clean = [];
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('__NB_SET__')) {
      const raw = trimmed.slice('__NB_SET__'.length).trim();
      try {
        const msg = JSON.parse(raw);
        if (msg && Object.prototype.hasOwnProperty.call(msg, 'key')) {
          nbBridge.setValue(msg.key, msg.value);
        }
      } catch {
        clean.push(line);
      }
    } else {
      clean.push(line);
    }
  }
  return clean.join('\n').replace(/\n+$/g, stdout.endsWith('\n') ? '\n' : '');
}

function cellToResult(cell, patch) {
  return {
    id: cell.id,
    kind: cell.kind,
    ok: !!patch.ok,
    outputs: patch.outputs || [],
    error: patch.error || null,
    metadata: patch.metadata || null,
  };
}

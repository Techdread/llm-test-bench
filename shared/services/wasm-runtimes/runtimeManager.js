// Shared runtime manager for constrained system-language execution.
//
// Each language has a map of `{ backendId: runner }`. The user-selected backend
// for multi-backend languages lives in runtime-backends.js (toolbar dialog).
// Single-backend languages run the only runner they have.

import { runC } from './c.js';
import { runCXcc } from './c-xcc.js';
import { runCDebian } from './c-debian.js';
import { runRust } from './rust.js';
import { runRustDebian } from './rust-debian.js';
import { runPythonDebian } from './python-debian.js';
import { runLua } from './lua.js';
import { runJava } from './java.js';
import { runGo } from './go.js';
import { runClojure } from './clojure.js';
import { runClojureScittle } from './clojure-scittle.js';
import { runScalaDebian } from './scala.js';
import { getBackend, BACKENDS } from '../runtime-backends.js';

// Map: lang → backend id → runner. `py` is here only for the Debian path;
// Pyodide stays inside notebook-lab's own runnerPy (it integrates the nb
// bridge + matplotlib figure capture, which the manager doesn't know about).
const RUNNERS = {
  c:       { xcc:    runCXcc,     wasm:   runC,      debian: runCDebian },
  rust:    { remote: runRust,     debian: runRustDebian },
  py:      {                      debian: runPythonDebian },
  lua:     { wasm:   runLua },
  java:    { debian: runJava },
  go:      { debian: runGo },
  scala:   { debian: runScalaDebian },
  clojure: { scittle: runClojureScittle, debian: runClojure },
};

const DEFAULT_TIMEOUT = 10000;
const DEBIAN_TIMEOUT  = 600000;

export async function runSystemLanguage(language, code, options = {}) {
  const table = RUNNERS[language];
  if (!table) {
    return failure(language, `Unsupported system language: ${language}`, options);
  }

  const backend = pickBackend(language, table);
  const runner = table[backend];
  if (!runner) {
    return failure(language, `No runner registered for ${language}/${backend}`, options);
  }

  // Debian backends boot/use the v86 guest and need a far longer ceiling than
  // the in-process wasm/remote runners. Caller can still override with a
  // larger timeout.
  const ceiling = backend === 'debian' ? DEBIAN_TIMEOUT : DEFAULT_TIMEOUT;
  const timeout = Math.max(options.timeout || 0, ceiling);
  const start = performance.now();

  try {
    const result = await Promise.race([
      runner(code, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout)
      ),
    ]);
    const durationMs = Math.round(performance.now() - start);
    return { ...result, language, backend, durationMs };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    return {
      language,
      backend,
      runtimeKind: getRuntimeKind(language, backend),
      compileSucceeded: null,
      runSucceeded: false,
      stdout: '',
      stderr: err.message || String(err),
      compileLog: '',
      stdin: options.stdin || '',
      durationMs,
    };
  }
}

export const run = runSystemLanguage;

/** Languages with more than one registered backend, for callers that want to
 *  query availability without importing the BACKENDS table directly. */
export function availableBackends(language) {
  const t = RUNNERS[language];
  return t ? Object.keys(t) : [];
}

function pickBackend(lang, table) {
  const wanted = BACKENDS[lang] ? getBackend(lang) : null;
  if (wanted && table[wanted]) return wanted;
  // First registered backend is the fallback. Matches the previous behaviour
  // (single-backend languages all worked).
  return Object.keys(table)[0];
}

function failure(language, msg, options) {
  return {
    language,
    backend: null,
    runtimeKind: 'unknown',
    compileSucceeded: null,
    runSucceeded: false,
    stdout: '',
    stderr: msg,
    compileLog: '',
    stdin: options.stdin || '',
    durationMs: 0,
  };
}

function getRuntimeKind(language, backend) {
  // Best-effort label for error envelopes (the real runners return their own).
  if (backend === 'debian') return 'native (Debian/v86)';
  if (backend === 'remote') return 'remote';
  if (backend === 'wasm')   return 'wasm';
  if (backend === 'xcc')    return 'wasm (xcc)';
  if (backend === 'scittle') return 'browser (Scittle)';
  return 'unknown';
}

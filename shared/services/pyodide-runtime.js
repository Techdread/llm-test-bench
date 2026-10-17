// Shared Pyodide loader. Singleton — only one Pyodide instance per page,
// because Pyodide is heavy (~10 MB wasm) and the first call wins on version.
//
// Public API:
//   loadPyodide({ version, indexURL, onStatus }) -> Promise<PyodideAPI>
//   getPyodide()                                  -> PyodideAPI | null
//   isLoading()                                   -> boolean
//   withCapturedStreams(py, fn, { stdinController }) -> Promise<{stdout, stderr, error, value}>
//   capOutput(text, maxLen)                       -> string
//
// Apps that need a specific Pyodide version should pass `version` on the
// first call; later callers receive whatever was already loaded (a console
// warning is emitted on mismatch so duplicate-version pins surface early).

const DEFAULT_VERSION = '0.26.4';
const DEFAULT_OUTPUT_CAP = 50000;

let pyodideInstance = null;
let loadingPromise = null;
let loadedVersion = null;

function runtimeUrlFor(version) {
  return new URL(`../lib/pyodide/${version}/full/`, import.meta.url).href;
}

async function injectScriptOnce(src) {
  if (window.loadPyodide) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Pyodide from ' + src));
    document.head.appendChild(script);
  });
}

/**
 * Load Pyodide (idempotent). The first call decides the version + indexURL;
 * subsequent calls return the cached instance and warn on version mismatch.
 *
 * @param {object} [options]
 * @param {string} [options.version='0.26.4']
 * @param {string} [options.indexURL]   - overrides the version-derived runtime URL
 * @param {(msg: string) => void} [options.onStatus]
 * @returns {Promise<any>} Pyodide API
 */
export async function loadPyodide(options = {}) {
  if (pyodideInstance) {
    if (options.version && loadedVersion && options.version !== loadedVersion) {
      console.warn(
        `[pyodide-runtime] requested v${options.version} but v${loadedVersion} is already loaded; reusing existing instance`
      );
    }
    return pyodideInstance;
  }
  if (loadingPromise) return loadingPromise;

  const version = options.version || DEFAULT_VERSION;
  const indexURL = options.indexURL || runtimeUrlFor(version);
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  loadingPromise = (async () => {
    onStatus('Loading Pyodide runtime…');
    let lp;
    if (typeof document === 'undefined') {
      // Web Worker / no-DOM context: load the ESM build directly (script-tag
      // injection needs a document, which a Worker doesn't have).
      ({ loadPyodide: lp } = await import(indexURL + 'pyodide.mjs'));
    } else {
      await injectScriptOnce(indexURL + 'pyodide.js');
      lp = self.loadPyodide;
    }
    const py = await lp({ indexURL });
    pyodideInstance = py;
    loadedVersion = version;
    onStatus('Pyodide ready');
    return py;
  })();

  try {
    return await loadingPromise;
  } finally {
    if (!pyodideInstance) loadingPromise = null;
  }
}

/** Returns the loaded Pyodide instance or null if not loaded yet. */
export function getPyodide() {
  return pyodideInstance;
}

/** True while loadPyodide() is in flight and not yet resolved. */
export function isLoading() {
  return !!loadingPromise && !pyodideInstance;
}

/**
 * Run an async function with sys.stdout/stderr redirected to StringIO and
 * (optionally) a stdin controller wired in. Always restores the streams,
 * even if the function throws. The Python error (if any) is returned in the
 * `error` field rather than re-thrown, so callers can build their own result.
 *
 * `stdinController` is anything matching the shape returned by
 * `shared/services/wasm-runtimes/stdin.js` — an object with `readBytes(buf)`
 * (and is treated as a TTY).
 *
 * @param {any} py
 * @param {() => Promise<any> | any} fn
 * @param {object} [opts]
 * @param {{ readBytes: (buf: Uint8Array) => number }} [opts.stdinController]
 * @param {boolean} [opts.isatty=false]
 * @returns {Promise<{ stdout: string, stderr: string, error: Error|null, value: any }>}
 */
export async function withCapturedStreams(py, fn, opts = {}) {
  const { stdinController, isatty = false } = opts;

  if (stdinController) {
    py.setStdin({
      read: (buffer) => stdinController.readBytes(buffer),
      isatty,
    });
  }
  py.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
sys.stderr = StringIO()
`);

  let value;
  let error = null;
  try {
    value = await fn();
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  const stdout = py.runPython('sys.stdout.getvalue()') || '';
  const capturedStderr = py.runPython('sys.stderr.getvalue()') || '';

  py.runPython(`
import sys
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
`);
  if (stdinController) py.setStdin();

  return { stdout, stderr: capturedStderr, error, value };
}

/** Truncate long output with a trailing notice. Apps share this so caps stay consistent. */
export function capOutput(text, maxLen = DEFAULT_OUTPUT_CAP) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (output truncated)';
}

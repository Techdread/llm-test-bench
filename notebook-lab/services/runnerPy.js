// runnerPy — executes a Python cell via Pyodide. Pyodide is persistent across
// runs so earlier cells' imports and variables stay available. Exposes `nb` as
// a dict-like proxy bridged to the shared JS store.

import * as nbBridge from './nbBridge.js';
import {
  loadPyodide as sharedLoadPyodide,
  isLoading as sharedIsLoading,
  getPyodide as sharedGetPyodide,
} from '../../shared/services/pyodide-runtime.js';
import {
  PYODIDE_VERSION,
  loadPackagesForCode,
} from './pyodidePackageCache.js';

let nbBridgeInstalled = false;

export function getPyodideLoading() {
  return sharedIsLoading() && !sharedGetPyodide();
}

export async function ensurePyodide(onStatus = () => {}) {
  const py = await sharedLoadPyodide({ version: PYODIDE_VERSION, onStatus });
  if (nbBridgeInstalled) return py;
  nbBridgeInstalled = true;

  // Bridge: Python -> JS values arrive as Pyodide PyProxies. Convert dicts to
  // plain JS objects (not Maps) so downstream JS cells see natural shapes.
  // Do NOT destroy the proxy — Pyodide manages its lifecycle; destroying an
  // auto-proxy can invalidate the caller's reference and raise
  // "PyProxy has been destroyed" on subsequent access.
  const fromPy = (v) => {
    if (v && typeof v.toJs === 'function') {
      try { return v.toJs({ dict_converter: Object.fromEntries }); }
      catch { return v; }
    }
    return v;
  };
  // Names start with a single underscore — Python name-mangles any
  // identifier starting with `__` inside a class body (e.g. `__nb_js_keys`
  // would become `_NB__nb_js_keys`), which breaks the shim.
  py.globals.set('_nb_js_set', (k, v) => nbBridge.setValue(String(k), fromPy(v)));
  py.globals.set('_nb_js_get', (k) => nbBridge.getValue(String(k)));
  py.globals.set('_nb_js_keys', () => [...Object.keys(nbBridge.snapshot())]);
  // The Python shim converts JsProxy return values to native Python objects
  // so users can use natural dict/list access (e.g. summary['average']).
  py.runPython(`
def _unwrap(v):
    to_py = getattr(v, 'to_py', None)
    if callable(to_py):
        try:
            return to_py()
        except Exception:
            return v
    return v

class _NB:
    def __setitem__(self, k, v):
        _nb_js_set(k, v)
    def __getitem__(self, k):
        if k not in list(_nb_js_keys()):
            raise KeyError(k)
        return _unwrap(_nb_js_get(k))
    def __contains__(self, k):
        return k in list(_nb_js_keys())
    def keys(self):
        return list(_nb_js_keys())
    def set(self, k, v):
        _nb_js_set(k, v)
    def get(self, k, default=None):
        if k in list(_nb_js_keys()):
            return _unwrap(_nb_js_get(k))
        return default
nb = _NB()
`);
  onStatus('Pyodide ready');
  return py;
}

/** Run a python cell. Returns {ok, outputs, error?}. */
export async function runPython(code, onStatus = () => {}) {
  const py = await ensurePyodide(onStatus);
  const outputs = [];

  // Resolve imports before executing user code. Missing packages are loaded
  // from the vendored distribution, the versioned data-root cache, or (when
  // enabled) the matching official Pyodide distribution. Package failures are
  // surfaced directly instead of being swallowed and followed by a confusing
  // duplicate ModuleNotFoundError traceback.
  try {
    await loadPackagesForCode(py, code, { onStatus });
  } catch (error) {
    const message = error?.message || String(error);
    console.error('[runnerPy] Python package setup failed:', error);
    return { ok: false, outputs, error: `Python package setup failed: ${message}` };
  }

  // Install a matplotlib hook that captures figures as base64 PNG.
  py.runPython(`
import sys
from io import StringIO
_stdout_buf = StringIO()
_stderr_buf = StringIO()
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
try:
    import matplotlib
    matplotlib.use('AGG')
except Exception:
    pass
`);

  // Expose user code to Python so we can wrap it and always dump a traceback
  // to stderr — Pyodide's PythonError.message sometimes comes back bare as
  // just "PythonError" with no detail.
  py.globals.set('__nb_user_code__', code);

  let ok = true;
  let error = null;
  let lastValue = undefined;
  try {
    lastValue = await py.runPythonAsync(`
import traceback as __nb_tb__, sys as __nb_sys__
from pyodide.code import eval_code_async as __nb_eval__
try:
    __nb_result__ = await __nb_eval__(__nb_user_code__, globals=globals())
except BaseException:
    __nb_sys__.stderr.write(__nb_tb__.format_exc())
    raise
__nb_result__
`);
  } catch (err) {
    ok = false;
    let msg = err && err.message ? String(err.message) : '';
    if (!msg || msg === 'PythonError') {
      try { msg = err.toString(); } catch { msg = String(err); }
    }
    error = msg || String(err);
    console.error('[runnerPy] PythonError:', err);
  }

  const stdout = py.runPython('_stdout_buf.getvalue()') || '';
  const stderr = py.runPython('_stderr_buf.getvalue()') || '';
  py.runPython('sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__');

  // If the wrapper dumped a traceback to stderr, that's more useful than the
  // opaque Pyodide `PythonError` — promote it as the error message.
  if (!ok && stderr && (!error || error === 'PythonError')) {
    error = stderr;
  }

  // Capture any active matplotlib figures.
  try {
    const b64 = py.runPython(`
def __capture_figs():
    try:
        import matplotlib.pyplot as plt
        import io, base64
        figs = [plt.figure(n) for n in plt.get_fignums()]
        images = []
        for f in figs:
            buf = io.BytesIO()
            f.savefig(buf, format='png', bbox_inches='tight')
            buf.seek(0)
            images.append(base64.b64encode(buf.read()).decode('ascii'))
        plt.close('all')
        return images
    except Exception:
        return []
__capture_figs()
`);
    if (b64 && typeof b64.toJs === 'function') {
      const arr = b64.toJs();
      for (const img of arr) {
        outputs.push({ type: 'image', mime: 'image/png', data: img });
      }
      b64.destroy && b64.destroy();
    }
  } catch (_) { /* ignore figure capture errors */ }

  if (stdout) outputs.push({ type: 'text', value: stdout });
  if (stderr && ok) outputs.push({ type: 'text', value: stderr });

  // Show the last expression value only if non-None and no explicit print.
  if (ok && lastValue !== undefined && lastValue !== null) {
    let display = lastValue;
    if (lastValue && typeof lastValue.toJs === 'function') {
      try { display = lastValue.toJs({ dict_converter: Object.fromEntries }); }
      catch { display = String(lastValue); }
      try { lastValue.destroy && lastValue.destroy(); } catch {}
    }
    outputs.push({ type: 'value', value: display });
  }

  return { ok, outputs, error: error || (stderr && !ok ? stderr : undefined) };
}

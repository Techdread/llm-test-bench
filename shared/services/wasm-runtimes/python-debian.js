// Debian-Python runner — real CPython 3.11 in the v86 Debian guest. Picked
// when the user flips Python's backend to "Debian Linux" in the toolbar
// runtimes dialog. No matplotlib / numpy / Pyodide-style two-way nb; this is
// emit-only Python (publish to nb by printing __NB_SET__ lines, just like the
// Java/Go/Clojure cells).

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

// Minimal `nb` shim so cells written for Pyodide still emit values when run
// under Debian: writes are turned into __NB_SET__ stdout lines (the same
// envelope Java/Go/Clojure use), and reads raise a clear KeyError telling the
// user to flip back to Pyodide if they need two-way nb access.
const NB_SHIM = [
  'import json as __nb_json__',
  'class __NbEmit:',
  '    def __setitem__(self, k, v):',
  "        print('__NB_SET__ ' + __nb_json__.dumps({'key': k, 'value': v}))",
  '    def __getitem__(self, k):',
  '        raise KeyError("Debian Python is emit-only — cannot read nb[" + repr(k) + "]. Switch the Python backend to Pyodide to read nb values.")',
  '    def set(self, k, v): self[k] = v',
  '    def get(self, k, default=None): return default',
  '    def __contains__(self, k): return False',
  '    def keys(self): return []',
  'nb = __NbEmit()',
  '',
].join('\n');

export async function runPythonDebian(code, options = {}) {
  const stdin = options.stdin || '';
  const source = NB_SHIM + (code || '');
  const r = await compileAndRun({
    source, stdin, srcName: 'main.py',
    compileCmd: 'true',                          // no compile step
    runCmd: 'python3 -u main.py',                // -u: unbuffered stdout
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  return toRunResult(r, 'native (python3, Debian/v86)', stdin);
}

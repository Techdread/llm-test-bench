// Python instrumentation via Pyodide + `sys.settrace`.
// Loads Pyodide on demand (it's ~10 MB), wraps the user code in a small
// harness that records a trace of `(t, var, value, line)` entries by reading
// frame locals after every line event.

import {
  loadPyodide as sharedLoadPyodide,
  getPyodide as sharedGetPyodide,
} from '../../shared/services/pyodide-runtime.js';

const PYODIDE_VERSION = '0.25.1';
let tracerInstalled = false;

export function isPyodideReady() { return sharedGetPyodide() !== null; }

export async function ensurePyodide(onProgress) {
  const py = await sharedLoadPyodide({ version: PYODIDE_VERSION, onStatus: onProgress });
  if (!tracerInstalled) {
    await py.runPythonAsync(PYTHON_TRACER);
    tracerInstalled = true;
  }
  return py;
}

// The Python tracer runs the user source with sys.settrace. At every 'line'
// event we diff the frame's locals against the previous snapshot and emit
// one record per change. Scalars and small containers are cloned; large
// containers are truncated. Emits a JSON-encoded events list that JS parses.
const PYTHON_TRACER = `
import sys, json, traceback

def _clone(value, depth=0):
    if depth > 4:
        return {'__truncated': True}
    if value is None or isinstance(value, (int, float, bool, str)):
        return value
    if isinstance(value, (list, tuple)):
        if len(value) > 1024:
            return {'__array': [_clone(v, depth+1) for v in list(value)[:1024]], '__truncated': len(value)}
        return [_clone(v, depth+1) for v in value]
    if isinstance(value, dict):
        out = {}
        i = 0
        for k, v in value.items():
            if i > 64:
                out['__truncated'] = True; break
            out[str(k)] = _clone(v, depth+1)
            i += 1
        return out
    if isinstance(value, set):
        arr = []
        for v in list(value)[:1024]:
            arr.append(_clone(v, depth+1))
        return {'__set': arr}
    try:
        return repr(value)
    except Exception:
        return '<unreprable>'

def run_trace(source, max_events=50000):
    events = []
    prev = {}
    counter = {'t': 0}
    overrun = {'flag': False}

    def _tracer(frame, event, arg):
        if overrun['flag']:
            return _tracer
        if event != 'line':
            return _tracer
        # Only trace frames in our synthetic module
        if frame.f_globals.get('__algvis_module__') is not True:
            return _tracer
        line = frame.f_lineno
        locs = dict(frame.f_locals)
        for name, value in locs.items():
            if name.startswith('_') or name in ('__algvis_module__',):
                continue
            try:
                cloned = _clone(value)
            except Exception:
                cloned = '<uncloneable>'
            prior = prev.get(name, _MISSING)
            if prior is _MISSING or _jsonish(prior) != _jsonish(cloned):
                events.append({'t': counter['t'], 'var': name, 'value': cloned, 'line': line})
                counter['t'] += 1
                prev[name] = cloned
                if counter['t'] >= max_events:
                    overrun['flag'] = True
                    return _tracer
        return _tracer

    g = {'__algvis_module__': True, '__name__': '__main__'}
    try:
        compiled = compile(source, '<algo-vis>', 'exec')
    except SyntaxError as e:
        return json.dumps({'error': f'SyntaxError: {e.msg} at line {e.lineno}', 'events': []})
    sys.settrace(_tracer)
    err = None
    try:
        exec(compiled, g, g)
    except Exception as e:
        err = f'{type(e).__name__}: {e}'
    finally:
        sys.settrace(None)
    return json.dumps({'error': err, 'events': events, 'overrun': overrun['flag']})

_MISSING = object()

def _jsonish(v):
    try:
        return json.dumps(v, sort_keys=True, default=str)
    except Exception:
        return repr(v)
`;

export async function tracePy(source, { maxEvents = 50000, onProgress } = {}) {
  try {
    const py = await ensurePyodide(onProgress);
    py.globals.set('__algvis_source', source);
    py.globals.set('__algvis_max', maxEvents);
    const jsonStr = await py.runPythonAsync('run_trace(__algvis_source, __algvis_max)');
    const data = JSON.parse(jsonStr);
    const events = data.events || [];
    return {
      error: data.error || null,
      events,
      overrun: data.overrun || false,
      vars: uniqueVarNames(events),
      stats: { events: events.length },
    };
  } catch (err) {
    return {
      error: err.message || String(err),
      events: [],
      overrun: false,
      vars: [],
      stats: { events: 0 },
    };
  }
}

function uniqueVarNames(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (e.var && !seen.has(e.var)) { seen.add(e.var); out.push(e.var); }
  }
  return out;
}

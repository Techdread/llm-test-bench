// runtime-backends — picks which runtime executes each language cell.
//
// Some languages have more than one backend (e.g. Python: Pyodide WASM vs real
// CPython in the Debian/v86 guest). This module is the single source of truth
// for that choice. Selection is persisted in localStorage; subscribers (the
// toolbar dialog) are notified on change.
//
// Adding a new backend? Bolt the runner onto `runtimeManager.js` and add an
// entry below — the dialog reads `BACKENDS` directly.

const STORAGE_KEY = 'notebook-lab.runtime-backends';

export const BACKENDS = {
  py: {
    default: 'wasm',
    options: [
      {
        id: 'wasm',
        label: 'Pyodide (WASM)',
        desc: 'CPython in WebAssembly, with numpy/matplotlib bundled. Two-way ' +
              'nb access, last-expression value, and figure capture all work.',
      },
      {
        id: 'debian',
        label: 'Debian Linux (python3)',
        desc: 'Real CPython 3.11 in the v86 Debian guest. Stdlib only — no ' +
              'numpy/matplotlib. Emit-only: publish values to nb via ' +
              '__NB_SET__ print lines, same as Java/Go/Clojure.',
      },
    ],
  },
  rust: {
    default: 'remote',
    options: [
      {
        id: 'remote',
        label: 'Rust Playground (remote)',
        desc: 'play.rust-lang.org — fast, no local boot, requires internet, ' +
              'no stdin support.',
      },
      {
        id: 'debian',
        label: 'Debian Linux (rustc)',
        desc: 'Real rustc in the v86 Debian guest. Fully offline; stdin works; ' +
              'rustc is slow under emulation (tens of seconds for a debug build).',
      },
    ],
  },
  c: {
    default: 'wasm',
    options: [
      {
        id: 'wasm',
        label: 'JSCPP (browser)',
        desc: 'Small JS-based C/C++ interpreter. Instant; limited language ' +
              'coverage; no system headers beyond a basic subset.',
      },
      {
        id: 'debian',
        label: 'Debian Linux (gcc / g++)',
        desc: 'Real GNU toolchain in the v86 Debian guest. Full C99/C++17, ' +
              'real diagnostics. Compiles in seconds once the VM is warm.',
      },
    ],
  },
};

let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(load())); }
  catch { /* private mode, full disk — just keep the in-memory cache */ }
}

function emit() { for (const fn of listeners) { try { fn(snapshot()); } catch {} } }

/** Currently selected backend id for a language (falls back to its default). */
export function getBackend(lang) {
  const cfg = BACKENDS[lang];
  if (!cfg) return null;
  const chosen = load()[lang];
  if (chosen && cfg.options.some((o) => o.id === chosen)) return chosen;
  return cfg.default;
}

/** Update the selected backend. Notifies subscribers. */
export function setBackend(lang, id) {
  const cfg = BACKENDS[lang];
  if (!cfg || !cfg.options.some((o) => o.id === id)) return;
  const c = load();
  c[lang] = id;
  save();
  emit();
}

/** Snapshot of every language's current backend. */
export function snapshot() {
  const out = {};
  for (const lang of Object.keys(BACKENDS)) out[lang] = getBackend(lang);
  return out;
}

/** Subscribe to backend changes; returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

/** True if `lang` is multi-backend (the dialog only lists those). */
export function hasMultipleBackends(lang) {
  return !!BACKENDS[lang] && BACKENDS[lang].options.length > 1;
}

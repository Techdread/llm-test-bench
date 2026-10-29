// nbBridge — the shared `nb` object that flows values between cells.
// JS cells see `nb.set(k, v)` / `nb.get(k)`.
// Python cells see `nb["k"]` via a dict-like shim that calls these.

const store = new Map();
const listeners = new Set();

// Subscribers receive (snapshot, change). `change` describes the mutation so
// consumers can react to a single key instead of re-processing the whole
// state — the HTML-cell bridge uses it to patch one value into each iframe
// rather than re-cloning the entire (possibly large) state on every set.
//   { type: 'set', key, value } | { type: 'delete', key }
//   { type: 'replace' } | { type: 'clear' } | null (initial subscribe)
function emit(change) {
  const snapshot = Object.fromEntries(store);
  for (const l of listeners) {
    try { l(snapshot, change || null); } catch (e) { /* ignore */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(Object.fromEntries(store), null);
  return () => listeners.delete(fn);
}

export function snapshot() {
  return Object.fromEntries(store);
}

export function replaceAll(values = {}) {
  store.clear();
  if (values && typeof values === 'object') {
    for (const [key, value] of Object.entries(values)) {
      store.set(String(key), value);
    }
  }
  emit({ type: 'replace' });
}

export function clear() {
  store.clear();
  emit({ type: 'clear' });
}

export function setValue(key, value) {
  const k = String(key);
  store.set(k, value);
  emit({ type: 'set', key: k, value });
}

export function getValue(key) {
  return store.get(String(key));
}

export function hasKey(key) {
  return store.has(String(key));
}

export function deleteKey(key) {
  const k = String(key);
  store.delete(k);
  emit({ type: 'delete', key: k });
}

// JS cells trade copies in both directions. Handing out the stored object let
// a cell change shared state in place (`nb.get('list').push(x)`) without a
// change event, so the Variables panel, live HTML cells and Save never saw
// it. Python and HTML cells already received copies; this makes JS match.
function copyForCell(value, key) {
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError(`nb.set('${key}') can't share this value: functions and page elements can't be copied between cells. Store plain data (numbers, strings, arrays, objects).`);
  }
}

// The object passed into JS cell sandboxes.
export function makeNbProxy() {
  return {
    set: (key, value) => setValue(key, copyForCell(value, key)),
    get: (key) => copyForCell(getValue(key), key),
    has: hasKey,
    delete: deleteKey,
    keys: () => [...store.keys()],
    all: () => copyForCell(Object.fromEntries(store), '*'),
  };
}

// Cross-tab runtime inventory for Notebook Lab. No browser globals are touched
// until createRuntimeMonitor() is called, keeping the helpers testable in Node.

export const RUNTIME_CHANNEL = 'notebook-lab-runtime-v1';
const STALE_AFTER_MS = 8000;

function jsonSize(value) {
  try { return JSON.stringify(value ?? null).length * 2; } catch { return 0; }
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function describeNotebookRuntime({ notebook, state = {}, runtimes = {}, heapBytes = null } = {}) {
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
  const outputs = cells.flatMap(cell => Array.isArray(cell.outputs) ? cell.outputs : []);
  return {
    notebookId: notebook?.id || null,
    title: notebook?.title || 'Untitled Notebook',
    cells: cells.length,
    variables: Object.keys(state || {}).length,
    outputs: outputs.length,
    charts: cells.filter(cell => cell.kind === 'chart').length
      + outputs.filter(output => output?.type === 'value' && output.value?.$schema?.includes?.('vega-lite')).length,
    htmlFrames: cells.filter(cell => cell.kind === 'html').length,
    retainedBytes: jsonSize({ state, outputs }),
    heapBytes: Number.isFinite(heapBytes) ? heapBytes : null,
    runtimes: {
      pyodide: runtimes.pyodide || 'cold',
      debian: runtimes.debian || 'cold',
      vegaViews: Number(runtimes.vegaViews) || 0,
    },
  };
}

export function createRuntimeMonitor({
  getSnapshot,
  onReset,
  channelFactory = (name) => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null,
  now = () => Date.now(),
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  heartbeatMs = 2500,
} = {}) {
  if (typeof getSnapshot !== 'function') throw new Error('getSnapshot is required');
  const sessionId = globalThis.crypto?.randomUUID?.()
    || `tab-${now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const channel = channelFactory?.(RUNTIME_CHANNEL) || null;
  const peers = new Map();
  const listeners = new Set();

  function currentSnapshot() {
    return {
      ...getSnapshot(),
      sessionId,
      current: true,
      updatedAt: now(),
    };
  }

  function prune() {
    const cutoff = now() - STALE_AFTER_MS;
    for (const [id, peer] of peers) {
      if (id !== sessionId && peer.updatedAt < cutoff) peers.delete(id);
    }
  }

  function list() {
    prune();
    const self = currentSnapshot();
    peers.set(sessionId, self);
    return [...peers.values()]
      .map(peer => ({ ...peer, current: peer.sessionId === sessionId }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt);
  }

  function emit() {
    const sessions = list();
    for (const listener of listeners) listener(sessions);
  }

  function publish() {
    const snapshot = currentSnapshot();
    peers.set(sessionId, snapshot);
    try { channel?.postMessage({ type: 'status', snapshot }); } catch { /* unsupported payload */ }
    emit();
  }

  if (channel) {
    channel.onmessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'status' && message.snapshot?.sessionId) {
        peers.set(message.snapshot.sessionId, { ...message.snapshot, current: false });
        emit();
      } else if (message.type === 'query') {
        publish();
      } else if (message.type === 'reset-all') {
        onReset?.({ remote: true });
      }
    };
  }

  publish();
  try { channel?.postMessage({ type: 'query' }); } catch { /* no channel */ }
  const timer = setIntervalFn?.(publish, heartbeatMs) || null;

  return {
    sessionId,
    subscribe(listener) {
      listeners.add(listener);
      listener(list());
      return () => listeners.delete(listener);
    },
    refresh() {
      try { channel?.postMessage({ type: 'query' }); } catch { /* no channel */ }
      publish();
    },
    resetAll() {
      try { channel?.postMessage({ type: 'reset-all', source: sessionId }); } catch { /* no channel */ }
    },
    dispose() {
      if (timer && clearIntervalFn) clearIntervalFn(timer);
      listeners.clear();
      try { channel?.close(); } catch { /* already closed */ }
    },
  };
}

// Hub Pipes — Milestone 1 (spec 246).
//
// Canonical handoff API. Harvests the mechanism the 8 existing
// `*-handoff.js` services already use into one place. The 8 files are
// retained as thin shims so existing consumers see no API change.
//
// Two transports:
//
//   1. LS-JSON  — small payloads (< ~2 MB) serialised to localStorage under
//                 a fixed key per-handoff. Receiver reads + clears (or
//                 peek/clear for non-destructive consumers).
//
//   2. IDB-Blob — large payloads (images, audio) stored as Blobs in a per-
//                 transport IndexedDB, with a small pointer in localStorage
//                 telling the receiver which id to fetch. TTL-based GC.
//
// Plus:
//
//   - Pipe registry (in-memory) — labs call registerPipe({...}) at module
//     load time so future "Send to" menus can list compatible targets.
//
//   - Append-only execution log — every send() records the pipe execution
//     so future Pipes Lab UI can browse + replay. Best-effort; failures do
//     not block the send.
//
//   - navigateToLab() — single, consistent navigation helper that all
//     transports use after a stash.

// ─────────────────────────────────────────────────────────────────────────
// Pipe registry
// ─────────────────────────────────────────────────────────────────────────

const _registry = new Map();

/**
 * Register a pipe definition. Labs typically call this at module load time
 * from `<lab>/services/pipes.js` (Milestone 2). Re-registration replaces
 * the previous entry under the same id — idempotent.
 *
 * @param {Object} def
 * @param {string} def.id                 Stable id (kebab-case).
 * @param {{lab:string, kind:string}} def.source
 * @param {{lab:string, kind:string}} def.target
 * @param {string} [def.transform]        Transform module id; identity if absent.
 * @param {string} [def.title]            Menu label.
 */
export function registerPipe(def) {
  if (!def || !def.id) throw new Error('registerPipe: id required');
  _registry.set(def.id, def);
  return def;
}

export function getRegisteredPipes() {
  return [..._registry.values()];
}

export function listPipesFromKind(kind) {
  return [..._registry.values()].filter(p => p.source?.kind === kind);
}

export function listPipesToLab(lab) {
  return [..._registry.values()].filter(p => p.target?.lab === lab);
}

// ─────────────────────────────────────────────────────────────────────────
// LS-JSON transport
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Stash a JSON-serialisable payload under a localStorage key. Caller picks
 * the key — Milestone 1 keeps the legacy keys verbatim so existing readers
 * keep finding payloads.
 *
 * @throws if the serialised payload exceeds `maxBytes`.
 */
export function stashLsPayload({ key, payload, maxBytes = DEFAULT_MAX_BYTES }) {
  if (!key) throw new Error('stashLsPayload: key required');
  const json = JSON.stringify(payload);
  if (json.length > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    throw new Error(`Payload too large for handoff (>${mb}MB)`);
  }
  localStorage.setItem(key, json);
  return json.length;
}

/**
 * Read a JSON payload from localStorage. Pass `destructive: true` to remove
 * after reading (default) or `false` to peek.
 */
export function readLsPayload(key, { destructive = true } = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    if (destructive) localStorage.removeItem(key);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearLsPayload(key) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

// ─────────────────────────────────────────────────────────────────────────
// IDB-Blob transport factory
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Build a blob-transport bound to one IndexedDB + LS-key prefix. The image
 * and audio handoffs each get their own instance with their own DB name so
 * payloads stay isolated and one transport's TTL purge can't touch the
 * other's queue.
 *
 * @param {Object} cfg
 * @param {string} cfg.dbName        e.g. 'devtools-hub-image-handoff'
 * @param {string} cfg.lsPrefix      e.g. 'devtools-hub-image-handoff:'
 * @param {string} [cfg.storeName='handoffs']
 * @param {number} [cfg.ttlMs=3600000]
 * @param {string} [cfg.idPrefix='ho']
 */
export function createBlobTransport({
  dbName,
  lsPrefix,
  storeName = 'handoffs',
  ttlMs = DEFAULT_TTL_MS,
  idPrefix = 'ho',
}) {
  if (!dbName || !lsPrefix) throw new Error('createBlobTransport: dbName and lsPrefix required');

  function lsKey(targetApp) { return `${lsPrefix}${targetApp}`; }
  function makeId() { return `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withTx(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName], mode);
      let captured;
      const capture = (v) => { captured = v; };
      t.oncomplete = () => resolve(captured);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('handoff tx aborted'));
      try { fn(t.objectStore(storeName), capture); } catch (err) { reject(err); }
    });
  }

  function readPointer(targetApp) {
    try {
      const raw = localStorage.getItem(lsKey(targetApp));
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && p.v === 1 && p.id ? p : null;
    } catch {
      return null;
    }
  }

  /**
   * Stash a payload (containing a Blob) and write a pointer to LS so the
   * receiver knows there's something waiting. Caller handles navigation.
   *
   * @param {Object} args
   * @param {string} args.targetApp
   * @param {string} args.source
   * @param {Object} args.payload  Full payload object (must include `blob`).
   * @returns {Promise<{ id: string }>}
   */
  async function stash({ targetApp, source, payload }) {
    if (!targetApp) throw new Error('stash: targetApp required');
    if (!source) throw new Error('stash: source required');
    if (!payload?.blob || !(payload.blob instanceof Blob)) {
      throw new Error('stash: payload.blob (Blob) required');
    }
    const id = payload.id || makeId();
    const sentAt = payload.sentAt || Date.now();
    const full = { ...payload, v: payload.v || 1, id, sentAt };
    await withTx('readwrite', (store) => { store.put(full, id); });
    try {
      localStorage.setItem(lsKey(targetApp), JSON.stringify({
        v: 1, id, ts: sentAt, source, fileName: payload.fileName || '',
      }));
    } catch (err) {
      console.warn(`[hub-pipes:${dbName}] LS pointer write failed:`, err);
    }
    return { id };
  }

  async function peek(targetApp) {
    const pointer = readPointer(targetApp);
    if (!pointer) return null;
    if (Date.now() - (pointer.ts || 0) > ttlMs) {
      await clear(targetApp, pointer.id).catch(() => {});
      return null;
    }
    try {
      return await withTx('readonly', (store, capture) => {
        const req = store.get(pointer.id);
        req.onsuccess = () => capture(req.result || null);
      });
    } catch (err) {
      console.warn(`[hub-pipes:${dbName}] peek failed:`, err);
      return null;
    }
  }

  async function take(targetApp) {
    const pointer = readPointer(targetApp);
    if (!pointer) return null;
    const id = pointer.id;
    let payload = null;
    try {
      payload = await withTx('readwrite', (store, capture) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          capture(getReq.result || null);
          store.delete(id);
        };
      });
    } catch (err) {
      console.warn(`[hub-pipes:${dbName}] take failed:`, err);
    }
    try { localStorage.removeItem(lsKey(targetApp)); } catch {}
    if (!payload) return null;
    if (Date.now() - (payload.sentAt || 0) > ttlMs) return null;
    return payload;
  }

  async function clear(targetApp, id) {
    const resolvedId = id || readPointer(targetApp)?.id || null;
    try { localStorage.removeItem(lsKey(targetApp)); } catch {}
    if (!resolvedId) return;
    try {
      await withTx('readwrite', (store) => { store.delete(resolvedId); });
    } catch (err) {
      console.warn(`[hub-pipes:${dbName}] clear failed:`, err);
    }
  }

  return { stash, peek, take, clear, lsKey, _readPointer: readPointer };
}

// ─────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Single canonical navigation helper. Builds `../<targetApp>/<path><hash>`
 * and assigns to window.location. Path is optional; hash is optional.
 */
export function navigateToLab({ targetApp, path = '', hash = '' }) {
  if (!targetApp) throw new Error('navigateToLab: targetApp required');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const cleanHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  const url = `../${targetApp}/${cleanPath}${cleanHash}`;
  window.location.href = url;
}

// ─────────────────────────────────────────────────────────────────────────
// Execution log (append-only, best-effort)
// ─────────────────────────────────────────────────────────────────────────

const LOG_DB_NAME = 'devtools-hub-pipes-log';
const LOG_STORE = 'executions';
const LOG_DB_VERSION = 1;

let _logDbPromise = null;

function openLogDb() {
  if (_logDbPromise) return _logDbPromise;
  _logDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        const store = db.createObjectStore(LOG_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('pipeId', 'pipeId', { unique: false });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _logDbPromise;
}

/**
 * Append an execution record. Best-effort: returns false on any error
 * rather than throwing — logging must never block a real send.
 *
 * @param {Object} execution
 * @param {string} [execution.pipeId]   Registered pipe id if known.
 * @param {string} execution.source     Sender lab id.
 * @param {string} [execution.targetApp]
 * @param {string} [execution.kind]     Payload kind (e.g. 'image/static').
 * @param {string} [execution.title]
 * @param {Object} [execution.meta]
 */
export async function logExecution(execution) {
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE, 'readwrite');
      const req = tx.objectStore(LOG_STORE).add({ ts: new Date().toISOString(), ...execution });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (err) {
    console.warn('[hub-pipes] logExecution failed (non-fatal):', err);
    return false;
  }
}

export async function listExecutions({ pipeId, limit = 200 } = {}) {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE, 'readonly');
      const store = tx.objectStore(LOG_STORE);
      const out = [];
      const req = pipeId
        ? store.index('pipeId').openCursor(IDBKeyRange.only(pipeId), 'prev')
        : store.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && out.length < limit) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

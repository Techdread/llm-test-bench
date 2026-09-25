// The server's data root, shaped like a directory handle.
//
// Picking a folder needs the File System Access API, which only desktop
// Chrome and Edge have — the Quest and every other Android browser are shut
// out, and each device ends up with its own copy of everything in browser
// storage. serve.py already owns the real data root, so these objects put its
// `/__data/*` file API behind the same methods the FS Access API exposes.
//
// That shape is the whole point: ~250 files across the hub call
// `getDirectoryHandle` / `getFileHandle` / `createWritable` / `getFile`
// directly, and none of them need to know which root they were handed.
//
// Only the subset the hub actually uses is implemented, plus the async
// iterators. Every call is one HTTP request; app-config's cache does the
// coalescing, as it already did for a local folder.

const BASE = '/__data';

function notFound(path) {
  const error = new Error(`No such entry: ${path}`);
  // Callers branch on this name (`e.name === 'NotFoundError'`) to mean
  // "nothing saved yet", so a DOMException is used where one exists.
  if (typeof DOMException === 'function') return new DOMException(error.message, 'NotFoundError');
  error.name = 'NotFoundError';
  return error;
}

function joinPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function checkName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/')) {
    throw new TypeError(`Invalid name: ${name}`);
  }
  return name;
}

async function api(path, { method = 'GET', query = {}, body = null, raw = false } = {}) {
  const params = new URLSearchParams(query);
  const res = await fetch(`${BASE}${path}?${params}`, {
    method,
    ...(body === null ? {} : { body, headers: { 'Content-Type': 'application/octet-stream' } }),
  });
  if (raw) return res;
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `data root ${method} ${path} failed (${res.status})`);
  }
  return res.json();
}

function toBytes(chunk) {
  if (chunk === null || chunk === undefined) return new Uint8Array();
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return new TextEncoder().encode(String(chunk));
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

/** A writable that buffers and sends the finished file on close(). */
function createWriter(path, initial) {
  let bytes = initial || new Uint8Array();
  let position = initial ? initial.byteLength : 0;
  let closed = false;

  const put = (chunk, at) => {
    const data = toBytes(chunk);
    const end = at + data.byteLength;
    if (end > bytes.byteLength) {
      const grown = new Uint8Array(end);
      grown.set(bytes.subarray(0, Math.min(bytes.byteLength, at)));
      bytes = grown;
    }
    bytes.set(data, at);
    position = end;
  };

  return {
    async write(input) {
      if (closed) throw new TypeError('The writable stream is closed');
      if (input && typeof input === 'object' && 'type' in input && !(input instanceof Blob)
          && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)) {
        if (input.type === 'seek') { position = Number(input.position) || 0; return; }
        if (input.type === 'truncate') { await this.truncate(Number(input.size) || 0); return; }
        put(input.data instanceof Blob ? new Uint8Array(await input.data.arrayBuffer()) : input.data,
          input.position === undefined ? position : Number(input.position));
        return;
      }
      put(input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input, position);
    },
    async seek(to) { position = Number(to) || 0; },
    async truncate(size) {
      const next = new Uint8Array(Number(size) || 0);
      next.set(bytes.subarray(0, Math.min(bytes.byteLength, next.byteLength)));
      bytes = next;
      if (position > bytes.byteLength) position = bytes.byteLength;
    },
    async close() {
      if (closed) return;
      closed = true;
      await api('/file', { method: 'PUT', query: { path }, body: bytes });
      forgetTrees();
    },
    // Nothing was sent yet, so abandoning costs nothing.
    async abort() { closed = true; },
  };
}

function fileHandle(path, name) {
  return {
    kind: 'file',
    name,
    _path: path,
    async getFile() {
      const res = await api('/file', { query: { path }, raw: true });
      if (res.status === 404) throw notFound(path);
      if (!res.ok) throw new Error(`Could not read ${path} (${res.status})`);
      const buffer = await res.arrayBuffer();
      const lastModified = Number(res.headers.get('X-Last-Modified-Ms')) || Date.now();
      // A real File, so text() / arrayBuffer() / slice() / stream() all behave.
      return new File([buffer], name, { lastModified });
    },
    async createWritable({ keepExistingData = false } = {}) {
      let initial = null;
      if (keepExistingData) {
        const res = await api('/file', { query: { path }, raw: true });
        if (res.ok) initial = new Uint8Array(await res.arrayBuffer());
      }
      return createWriter(path, initial);
    },
    async isSameEntry(other) { return !!other && other._path === path; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
}

// One recursive listing answers a whole walk. Apps iterate a folder and then
// immediately ask about its children (Prompt Gallery: 180 folders, each with
// its own listing and stats), which was a request each; with the tree in hand
// those are answered locally. Short-lived: it is a burst cache for one walk,
// not a view of the filesystem.
const TREE_TTL_MS = 15000;
const treeCache = new Map();   // path -> { at, byPath: Map<path, entry> }

function cachedEntry(path) {
  for (const [, cached] of treeCache) {
    if (Date.now() - cached.at > TREE_TTL_MS) continue;
    const hit = cached.byPath.get(path);
    if (hit) return hit;
    // Absent only when its parent is a directory whose contents we have.
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (cached.listed.has(parent)) return { missing: true };
  }
  return null;
}

function rememberTree(path, entries, depth) {
  const byPath = new Map();
  // Only directories the server actually opened may answer "not there" for a
  // child. A directory at the depth limit was named but not read, and treating
  // it as listed would report its real contents as missing.
  const listed = new Set([path]);
  const prefix = path ? `${path}/` : '';
  for (const entry of entries) {
    byPath.set(entry.path, entry);
    const level = entry.path.slice(prefix.length).split('/').length - 1;
    if (entry.kind === 'directory' && (depth <= 0 || level + 1 < depth)) listed.add(entry.path);
  }
  treeCache.set(path, { at: Date.now(), byPath, listed });
  if (treeCache.size > 8) treeCache.delete(treeCache.keys().next().value);
}

function forgetTrees() {
  treeCache.clear();
}

async function statOf(path) {
  const cached = cachedEntry(path);
  if (cached) return cached.missing ? { exists: false } : { exists: true, ...cached };
  return api('/stat', { query: { path } });
}

function directoryHandle(path, name) {
  const self = {
    kind: 'directory',
    name,
    _path: path,
    // Writes here land through one atomic PUT (serve.py writes a temp file and
    // replaces), so callers must not repeat the tmp-file dance themselves —
    // over HTTP that is three round trips and twice the bytes per save.
    _atomicWrites: true,

    async getDirectoryHandle(child, { create = false } = {}) {
      checkName(child);
      const childPath = joinPath(path, child);
      if (create) {
        await api('/dir', { method: 'POST', query: { path: childPath } });
        forgetTrees();
      } else {
        const stat = await statOf(childPath);
        if (!stat.exists) throw notFound(childPath);
        if (stat.kind !== 'directory') throw new TypeError(`${childPath} is a file`);
      }
      return directoryHandle(childPath, child);
    },

    async getFileHandle(child, { create = false } = {}) {
      checkName(child);
      const childPath = joinPath(path, child);
      const stat = await statOf(childPath);
      if (!stat.exists) {
        if (!create) throw notFound(childPath);
        // The real API creates the empty file at this point, and callers rely
        // on it existing before anything is written to it.
        await api('/file', { method: 'PUT', query: { path: childPath }, body: new Uint8Array() });
        forgetTrees();
      } else if (stat.kind !== 'file') {
        throw new TypeError(`${childPath} is a directory`);
      }
      return fileHandle(childPath, child);
    },

    async removeEntry(child, { recursive = false } = {}) {
      checkName(child);
      const childPath = joinPath(path, child);
      const res = await api('/file', {
        method: 'DELETE',
        query: { path: childPath, ...(recursive ? { recursive: '1' } : {}) },
        raw: true,
      });
      forgetTrees();
      if (res.status === 404) throw notFound(childPath);
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `Could not remove ${childPath}`);
      }
    },

    async *entries() {
      // depth 3: an app folder, its items, and what is inside them — the shape
      // of every walk in the hub (gallery → generation → files, benchmark →
      // submissions → files), so one request answers the whole scan.
      let entries;
      try {
        const tree = await api('/tree', { query: { path, depth: '3' } });
        // A truncated tree has holes, so it must not answer "not there".
        if (!tree.truncated) rememberTree(path, tree.entries, 3);
        const prefix = path ? `${path}/` : '';
        entries = tree.entries.filter(e => e.path.slice(prefix.length).indexOf('/') === -1);
      } catch {
        // An older bridge has no /tree.
        entries = (await api('/list', { query: { path } })).entries;
      }
      for (const entry of entries) {
        yield [entry.name, entry.kind === 'directory'
          ? directoryHandle(joinPath(path, entry.name), entry.name)
          : fileHandle(joinPath(path, entry.name), entry.name)];
      }
    },
    async *values() {
      for await (const [, handle] of self.entries()) yield handle;
    },
    async *keys() {
      for await (const [key] of self.entries()) yield key;
    },
    [Symbol.asyncIterator]() { return self.entries(); },

    /** Path segments from here down to a descendant, or null (FS Access API). */
    async resolve(descendant) {
      const target = descendant?._path;
      if (typeof target !== 'string') return null;
      if (target === path) return [];
      const prefix = path ? `${path}/` : '';
      return target.startsWith(prefix) ? target.slice(prefix.length).split('/') : null;
    },

    async isSameEntry(other) { return !!other && other._path === path; },
    // There is no per-origin permission to ask for: reaching the bridge at all
    // is the permission, and the token gate is what guards it.
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  return self;
}

/** Is this hub served by a serve.py that exposes its data root? */
export async function serverRootStatus() {
  try {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return null;
    const status = await res.json();
    return status?.features?.includes('write') ? status : null;
  } catch {
    return null;
  }
}

/** The server's data root as a directory handle. */
export function serverRoot(name = 'server data root') {
  return directoryHandle('', name);
}

export const _internals = { directoryHandle, fileHandle, createWriter, toBytes, concat, forgetTrees };

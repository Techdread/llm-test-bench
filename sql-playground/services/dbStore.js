// Persistent DB store — binary .sqlite files under the shared data root.
// Falls back to IndexedDB (via a minimal inline wrapper) when no data root is
// configured, so the app stays useful before the user picks a root folder.

import { resolveDir, resolveFile, isRootReady } from '../../shared/services/storage-adapter.js';

const APP_ID = 'sql-playground';
const AREA = 'projects';
const SEG = 'dbs';
const IDB_NAME = 'sql-playground-dbs';
const IDB_STORE = 'dbs';

export async function hasDataRoot() {
  return isRootReady();
}

function slug(name) {
  return String(name || 'db')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'db';
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp(mode, fn) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const store = tx.objectStore(IDB_STORE);
    const out = fn(store);
    tx.oncomplete = () => resolve(out?.result ?? out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listDbs() {
  if (await isRootReady()) {
    try {
      const dir = await resolveDir(APP_ID, AREA, SEG);
      const names = [];
      for await (const [name, handle] of dir) {
        if (handle.kind === 'file' && name.endsWith('.sqlite')) {
          names.push(name.replace(/\.sqlite$/, ''));
        }
      }
      names.sort((a, b) => a.localeCompare(b));
      return names;
    } catch {
      return [];
    }
  }
  return idbOp('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve((req.result || []).sort());
      req.onerror = () => reject(req.error);
    });
  });
}

export async function loadDb(name) {
  const id = slug(name);
  if (await isRootReady()) {
    const { dir, fileName } = await resolveFile(APP_ID, AREA, SEG, `${id}.sqlite`);
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
  const bytes = await idbOp('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
  return bytes;
}

export async function saveDb(name, bytes) {
  const id = slug(name);
  if (await isRootReady()) {
    const { dir, fileName } = await resolveFile(APP_ID, AREA, SEG, `${id}.sqlite`);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    return id;
  }
  await idbOp('readwrite', (store) => store.put(bytes, id));
  return id;
}

export async function deleteDb(name) {
  const id = slug(name);
  if (await isRootReady()) {
    try {
      const dir = await resolveDir(APP_ID, AREA, SEG);
      await dir.removeEntry(`${id}.sqlite`);
    } catch {}
    return;
  }
  await idbOp('readwrite', (store) => store.delete(id));
}

// Saved queries/snippets — JSON file per DB.
export async function saveSnippets(name, snippets) {
  const id = slug(name);
  const text = JSON.stringify(snippets, null, 2);
  if (await isRootReady()) {
    const { dir, fileName } = await resolveFile(APP_ID, AREA, SEG, `${id}.snippets.json`);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return;
  }
  localStorage.setItem(`sql-playground-snippets:${id}`, text);
}

export async function loadSnippets(name) {
  const id = slug(name);
  if (await isRootReady()) {
    try {
      const { dir, fileName } = await resolveFile(APP_ID, AREA, SEG, `${id}.snippets.json`);
      const fh = await dir.getFileHandle(fileName, { create: false });
      const file = await fh.getFile();
      const text = await file.text();
      return text ? JSON.parse(text) : [];
    } catch {
      return [];
    }
  }
  const raw = localStorage.getItem(`sql-playground-snippets:${id}`);
  return raw ? JSON.parse(raw) : [];
}

// Shared IndexedDB storage for directory handle persistence.
// All apps share the same root directory handle. The IDB itself is opened
// via shared/services/idb.js — that module is the single source of truth
// for DB_NAME and DB_VERSION across the suite.
//
// Origin pinning: alongside the handle we persist the page origin that
// picked it (e.g. `http://127.0.0.1:8080`). FileSystemDirectoryHandle is
// already origin-scoped at the IDB layer, so this isn't a security
// boundary — it's a diagnostic. If the user later visits the same app via
// a different origin (`http://localhost:8080`, a LAN IP, etc.) the saved
// handle is invisible to that origin's IDB. By recording the picking
// origin we can at least surface a useful "you're on origin X but the
// handle was saved on origin Y" hint when something looks wrong.

import { openDevtoolsHubDB } from './idb.js';

const STORE_NAME = 'handles';
const HANDLE_KEY = 'rootDir';
const ORIGIN_KEY = 'rootDirOrigin';

function currentOrigin() {
  try {
    return typeof window !== 'undefined' && window.location ? window.location.origin : '';
  } catch { return ''; }
}

export async function saveHandle(handle) {
  const db = await openDevtoolsHubDB();
  const origin = currentOrigin();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(handle, HANDLE_KEY);
    if (origin) store.put(origin, ORIGIN_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadHandle() {
  const db = await openDevtoolsHubDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns the page origin that was active when the current handle was
 * saved (e.g. `http://127.0.0.1:8080`), or null if no handle was ever
 * saved on this origin's IDB. Useful for diagnostics — see currentOrigin
 * comparisons in data-root-manager.getRootStatus().
 */
export async function loadHandleOrigin() {
  const db = await openDevtoolsHubDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(ORIGIN_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** The origin of the current page; null in non-browser environments. */
export function getCurrentOrigin() {
  return currentOrigin() || null;
}

export async function clearHandle() {
  const db = await openDevtoolsHubDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(HANDLE_KEY);
    store.delete(ORIGIN_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Load a per-app directory handle scoped to a subfolder of the shared root.
 * Returns root/{appId}/ (auto-created), or null if no root is set / permission denied.
 * @param {string} appId — App identifier used as the subfolder name (e.g. 'code-arena')
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function loadAppHandle(appId) {
  const rootHandle = await loadHandle();
  if (!rootHandle) return null;
  try {
    const perm = await rootHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    return await rootHandle.getDirectoryHandle(appId, { create: true });
  } catch {
    return null;
  }
}

/**
 * Pick directory, save as root, return the app-scoped subfolder handle.
 * Used by individual apps so a user can set the root from any app.
 * @param {string} appId
 * @returns {Promise<{root: FileSystemDirectoryHandle, appHandle: FileSystemDirectoryHandle}>}
 */
export async function pickAndSaveAppHandle(appId) {
  const root = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveHandle(root);
  const appHandle = await root.getDirectoryHandle(appId, { create: true });
  return { root, appHandle };
}

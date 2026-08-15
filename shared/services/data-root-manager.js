// Shared Data Root Manager
// Implements the directory contract from DATA_ROOT_MANAGER_SPEC.md.
//
// Browser context: the "root" is a FileSystemDirectoryHandle persisted in
// IndexedDB (via shared/services/storage.js). All app data lives under
// <root>/<appId>/ with standard subfolders bootstrapped on demand.

import {
  loadHandle,
  saveHandle,
  loadHandleOrigin,
  getCurrentOrigin,
} from './storage.js';

export const REGISTRY_FILENAME = 'data-root.json';
export const REGISTRY_VERSION = 1;
export const STANDARD_SUBFOLDERS = ['config', 'projects', 'runs', 'exports', 'cache', 'logs'];

const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function validateAppId(appId) {
  if (typeof appId !== 'string' || !APP_ID_RE.test(appId)) {
    throw new Error(`Invalid appId: ${appId}. Must match ${APP_ID_RE}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

/** @returns {Promise<FileSystemDirectoryHandle|null>} */
export async function getRoot() {
  const handle = await loadHandle();
  if (!handle) return null;
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    return handle;
  } catch {
    return null;
  }
}

/**
 * Inspect the saved root handle without prompting. Lets apps tell the
 * difference between "no root configured" and "root configured but the
 * browser dropped the permission on this page load" — the latter is
 * fixable with one user-gesture click.
 *
 * The returned object also carries `savedOrigin` and `currentOrigin` so
 * apps can surface a hint when the user is on a different origin than the
 * one that picked the directory (per-origin IDB scoping makes the handle
 * invisible across origins). `originMismatch` is set when both origins
 * are known and differ.
 *
 * @returns {Promise<
 *   {status:'none', error?:string, savedOrigin?:null, currentOrigin?:string|null}
 *   | {status:'needs-permission', name:string, savedOrigin:string|null, currentOrigin:string|null, originMismatch:boolean}
 *   | {status:'ready', handle:FileSystemDirectoryHandle, name:string, savedOrigin:string|null, currentOrigin:string|null, originMismatch:boolean}
 * >}
 */
export async function getRootStatus() {
  const currentOrigin = getCurrentOrigin();
  let handle;
  try {
    handle = await loadHandle();
  } catch (e) {
    console.error('[data-root-manager] getRootStatus loadHandle failed:', e);
    return { status: 'none', error: (e && e.message) || String(e), currentOrigin };
  }
  if (!handle) return { status: 'none', currentOrigin };
  let savedOrigin = null;
  try {
    savedOrigin = await loadHandleOrigin();
  } catch (e) {
    console.warn('[data-root-manager] getRootStatus loadHandleOrigin failed:', e);
  }
  const originMismatch = !!(savedOrigin && currentOrigin && savedOrigin !== currentOrigin);
  if (originMismatch) {
    console.warn(
      `[data-root-manager] handle was saved on ${savedOrigin}; current page is ${currentOrigin}. ` +
      `Per-origin IDB scoping means handles do not cross origins.`
    );
  }
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      return { status: 'ready', handle, name: handle.name, savedOrigin, currentOrigin, originMismatch };
    }
    return { status: 'needs-permission', name: handle.name, savedOrigin, currentOrigin, originMismatch };
  } catch (e) {
    console.error('[data-root-manager] getRootStatus queryPermission failed:', e);
    return { status: 'none', error: (e && e.message) || String(e), savedOrigin, currentOrigin };
  }
}

/**
 * Prompt the user to pick a directory, save it as the global root, and
 * ensure the registry file exists.
 * @deprecated Use only from the Settings page. Individual apps should call
 * connectRoot() instead so they cannot change the shared data root.
 */
export async function setRoot() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveHandle(handle);
  await ensureRegistry(handle);
  return handle;
}

/**
 * Non-interactive root access for individual apps. Returns the existing
 * root handle if one is configured and permission is granted, otherwise null.
 * Unlike setRoot(), this never opens a directory picker — if null is returned
 * the app should direct the user to Settings → Data Root.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function connectRoot() {
  let handle;
  try {
    handle = await loadHandle();
  } catch (e) {
    console.error('[data-root-manager] loadHandle failed:', e);
    return null;
  }
  if (!handle) return null;
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') return null;
    await ensureRegistry(handle);
    return handle;
  } catch (e) {
    console.error('[data-root-manager] connectRoot permission/registry step failed:', e);
    return null;
  }
}

/**
 * Ensure the root handle is usable and the registry file exists/valid.
 * Returns the root handle, or throws if no root is set.
 */
export async function ensureRoot() {
  const root = await getRoot();
  if (!root) throw new Error('No data root is set. Open Settings → Data Root to pick one.');
  await ensureRegistry(root);
  return root;
}

async function ensureRegistry(root) {
  try {
    await root.getFileHandle(REGISTRY_FILENAME);
    const reg = await readRegistry(root);
    if (!reg || typeof reg !== 'object' || reg.version !== REGISTRY_VERSION) {
      await writeRegistryAtomic(root, defaultRegistry());
    }
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || err instanceof SyntaxError)) {
      console.warn('[data-root-manager] Registry missing or corrupted, recreating:', err.message);
      await writeRegistryAtomic(root, defaultRegistry());
    } else {
      throw err;
    }
  }
}

function defaultRegistry() {
  const ts = nowIso();
  return {
    version: REGISTRY_VERSION,
    createdAt: ts,
    updatedAt: ts,
    suite: { name: 'TechBot App Suite' },
    apps: {},
  };
}

/** @param {FileSystemDirectoryHandle} [rootArg] */
export async function readRegistry(rootArg) {
  const root = rootArg || await ensureRoot();
  const fileHandle = await root.getFileHandle(REGISTRY_FILENAME, { create: false });
  const file = await fileHandle.getFile();
  const text = await file.text();
  if (!text.trim()) return defaultRegistry();
  return JSON.parse(text);
}

/**
 * Atomic-ish write: write to a temp file, then overwrite the target.
 * File System Access API has no atomic rename, but writing to a sibling
 * temp file first bounds corruption risk to the swap step.
 */
async function writeRegistryAtomic(root, registry) {
  registry.updatedAt = nowIso();
  const text = JSON.stringify(registry, null, 2);
  const tmpName = `${REGISTRY_FILENAME}.tmp`;

  const tmp = await root.getFileHandle(tmpName, { create: true });
  let w = await tmp.createWritable();
  await w.write(text);
  await w.close();

  const target = await root.getFileHandle(REGISTRY_FILENAME, { create: true });
  w = await target.createWritable();
  await w.write(text);
  await w.close();

  try {
    await root.removeEntry(tmpName);
  } catch { /* best-effort cleanup */ }
}

/**
 * Read-modify-write helper. `mutator(registry)` may return a new registry
 * or mutate in place; either way the result is persisted.
 */
export async function updateRegistry(mutator) {
  const root = await ensureRoot();
  const reg = await readRegistry(root);
  const next = (await mutator(reg)) || reg;
  await writeRegistryAtomic(root, next);
  return next;
}

/**
 * Ensure <root>/<appId>/ and all STANDARD_SUBFOLDERS exist, and that the
 * registry has an entry for the app. Returns the app directory handle.
 */
export async function ensureAppNamespace(appId) {
  validateAppId(appId);
  const root = await ensureRoot();
  const appHandle = await root.getDirectoryHandle(appId, { create: true });
  for (const sub of STANDARD_SUBFOLDERS) {
    await appHandle.getDirectoryHandle(sub, { create: true });
  }
  await updateRegistry((reg) => {
    reg.apps = reg.apps || {};
    if (!reg.apps[appId]) {
      reg.apps[appId] = {
        appId,
        path: appId,
        initializedAt: nowIso(),
        migration: { status: 'not-started', lastRunAt: null },
      };
    }
  });
  return appHandle;
}

/**
 * Returns the logical path map for an app. Paths are relative strings
 * (e.g. 'html-viewer/config'), since browsers can't expose absolute paths.
 * Use StorageAdapter.resolve() to get live directory handles.
 */
export function getAppPaths(appId) {
  validateAppId(appId);
  const base = appId;
  const out = { base };
  for (const sub of STANDARD_SUBFOLDERS) {
    out[sub] = `${base}/${sub}`;
  }
  out.migration = `${base}/migration`;
  return out;
}

/** Convenience: registry status for a single app (or null if not registered). */
export async function getAppRegistryEntry(appId) {
  validateAppId(appId);
  try {
    const reg = await readRegistry();
    return (reg.apps && reg.apps[appId]) || null;
  } catch {
    return null;
  }
}

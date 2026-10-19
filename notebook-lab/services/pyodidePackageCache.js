// Version-pinned Pyodide package cache for Notebook Lab.
//
// The Pyodide core is vendored under shared/lib, but the full distribution is
// intentionally much larger than the app. Missing packages are downloaded from
// the matching Pyodide release, verified against its vendored lockfile, and
// stored under:
//   <data-root>/notebook-lab/cache/pyodide/<version>/packages/

// Installation uses Pyodide's own package-loader helpers so cached WASM wheels
// and shared-library archives (for example OpenBLAS) are loaded correctly.

import { getAppHandle, initHandle } from './notebookStore.js';
import { isWebEdition } from './edition.js';

export const PYODIDE_VERSION = '0.26.4';
export const COMMON_PACKAGE_SET = ['numpy', 'pandas', 'matplotlib', 'scipy', 'sympy'];

const AUTO_DOWNLOAD_KEY = 'notebook-lab-pyodide-package-cache-auto';
const LOCAL_DIST_URL = new URL(
  `../../shared/lib/pyodide/${PYODIDE_VERSION}/full/`,
  import.meta.url,
);
const UPSTREAM_DIST_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PACKAGE_PROXY_PATH = '/__pyodide/packages';
const CACHE_PATH = ['cache', 'pyodide', PYODIDE_VERSION];
const INDEX_FILE = 'cache-index.json';

let lockPromise = null;
const installPromises = new WeakMap();

export function getAutoDownloadPackages() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(AUTO_DOWNLOAD_KEY) !== 'false';
}

export function setAutoDownloadPackages(enabled) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(AUTO_DOWNLOAD_KEY, enabled ? 'true' : 'false');
  }
  return !!enabled;
}

export async function loadPackageLock() {
  if (!lockPromise) {
    lockPromise = fetch(new URL('pyodide-lock.json', LOCAL_DIST_URL))
      .then((res) => {
        if (!res.ok) throw new Error(`Unable to read Pyodide package lock (${res.status})`);
        return res.json();
      });
  }
  return lockPromise;
}

/** Resolve package names for Python import roots using a Pyodide lockfile. */
export function packagesForImports(imports, lock) {
  const wanted = new Set((imports || []).map((name) => String(name).split('.')[0]));
  const result = [];
  for (const [name, pkg] of Object.entries(lock?.packages || {})) {
    if ((pkg.imports || []).some((importName) => wanted.has(String(importName).split('.')[0]))) {
      result.push(name);
    }
  }
  return result;
}

/** Return dependencies before dependants, without duplicates. */
export function dependencyOrder(packageNames, lock) {
  const packages = lock?.packages || {};
  const aliases = new Map();
  for (const [key, pkg] of Object.entries(packages)) {
    aliases.set(normalizeName(key), key);
    aliases.set(normalizeName(pkg.name || key), key);
  }
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (requested) => {
    const name = aliases.get(normalizeName(requested));
    if (!name || visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular Pyodide package dependency at ${name}`);
    visiting.add(name);
    for (const dep of packages[name].depends || []) visit(dep);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of packageNames || []) visit(name);
  return ordered;
}

export async function sha256Hex(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Run an optional cache operation without allowing browser-persisted storage
 * state to break package loading. A revoked File System Access handle, a
 * disconnected drive, or a read-only data root must behave like a cache miss.
 */
export async function bestEffortCache(operation, { fallback = null, onError = () => {} } = {}) {
  try {
    return await operation();
  } catch (error) {
    onError(error);
    return fallback;
  }
}

/**
 * Read a vendored artifact and recover once from a stale/corrupt HTTP-cache
 * entry. This matters in long-lived Chrome profiles: incognito starts with an
 * empty cache, while a normal profile can retain an older response at the same
 * versioned URL.
 */
export async function fetchVerifiedVendoredArtifact(
  url,
  expectedSha256,
  { fetchImpl = globalThis.fetch } = {},
) {
  const attempts = ['force-cache', 'reload'];
  let firstError = null;

  for (const cache of attempts) {
    try {
      const response = await fetchImpl(url, { cache });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (await sha256Hex(bytes) === expectedSha256) return bytes;
      firstError ||= new Error('cached response failed SHA-256 verification');
    } catch (error) {
      firstError ||= error;
      if (cache === 'force-cache') continue;
      return null;
    }
  }

  throw new Error(
    `Vendored artifact does not match the Pyodide lockfile after bypassing the browser cache${
      firstError?.message ? ` (${firstError.message})` : ''
    }`,
  );
}

export function packageDownloadUrls(fileName, origin = globalThis.location?.origin) {
  const encodedFile = encodeURIComponent(String(fileName));
  const urls = [];
  if (origin && /^https?:/i.test(origin)) {
    urls.push(`${String(origin).replace(/\/$/, '')}${PACKAGE_PROXY_PATH}/${encodeURIComponent(PYODIDE_VERSION)}/${encodedFile}`);
  }
  urls.push(`${UPSTREAM_DIST_URL}${encodedFile}`);
  return urls;
}

/** Load every locked package imported by a cell, using vendor -> cache -> network. */
export async function loadPackagesForCode(py, code, { onStatus = () => {} } = {}) {
  const imports = findImports(py, code);
  if (!imports.length) return [];
  const lock = await loadPackageLock();
  const requested = packagesForImports(imports, lock);
  if (!requested.length) return [];
  return installPackageSet(py, requested, lock, { onStatus });
}

export async function installPackageSet(py, packageNames, lock = null, { onStatus = () => {} } = {}) {
  const packageLock = lock || await loadPackageLock();
  const ordered = dependencyOrder(packageNames, packageLock);
  let perRuntime = installPromises.get(py);
  if (!perRuntime) {
    perRuntime = new Map();
    installPromises.set(py, perRuntime);
  }

  const installed = [];
  for (const name of ordered) {
    if (isLoaded(py, name, packageLock.packages[name])) continue;
    if (!perRuntime.has(name)) {
      perRuntime.set(name, installOne(py, name, packageLock.packages[name], { onStatus })
        .catch((error) => {
          perRuntime.delete(name);
          throw error;
        }));
    }
    await perRuntime.get(name);
    installed.push(name);
  }
  return installed;
}

/** Download the common scientific stack into the selected data root. */
export async function prefetchCommonPackages({ force = false, onStatus = () => {} } = {}) {
  const lock = await loadPackageLock();
  const ordered = dependencyOrder(COMMON_PACKAGE_SET, lock);
  const cache = await requireCacheHandles();
  let downloaded = 0;
  let reused = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const name = ordered[index];
    const pkg = lock.packages[name];
    onStatus(`${force ? 'Refreshing' : 'Caching'} ${name} (${index + 1}/${ordered.length})…`);
    // Do not duplicate artifacts already carried by the portable app bundle.
    // They remain the first source in the runtime loading order.
    if (await readVendoredArtifact(pkg)) {
      reused += 1;
      continue;
    }
    if (!force) {
      const cached = await readVerifiedCachedArtifact(cache, name, pkg);
      if (cached) {
        reused += 1;
        continue;
      }
    }
    const bytes = await downloadVerifiedArtifact(name, pkg);
    await writeCachedArtifact(cache, name, pkg, bytes);
    downloaded += 1;
  }
  return { downloaded, reused, total: ordered.length };
}

export async function getPackageCacheStatus() {
  const appHandle = await resolveAppHandle();
  if (!appHandle) {
    return {
      configured: false,
      version: PYODIDE_VERSION,
      autoDownload: getAutoDownloadPackages(),
      entries: [],
      count: 0,
      bytes: 0,
    };
  }
  const cache = await getCacheHandles(appHandle, true);
  const entries = [];
  for await (const [fileName, handle] of cache.packages.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    entries.push({ fileName, bytes: file.size, updatedAt: new Date(file.lastModified).toISOString() });
  }
  entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return {
    configured: true,
    version: PYODIDE_VERSION,
    autoDownload: getAutoDownloadPackages(),
    entries,
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export async function verifyPackageCache({ onStatus = () => {} } = {}) {
  const cache = await requireCacheHandles();
  const lock = await loadPackageLock();
  const byFile = new Map(Object.entries(lock.packages).map(([name, pkg]) => [pkg.file_name, { name, pkg }]));
  const valid = [];
  const invalid = [];
  let checked = 0;

  for await (const [fileName, handle] of cache.packages.entries()) {
    if (handle.kind !== 'file') continue;
    checked += 1;
    onStatus(`Verifying ${fileName}…`);
    const known = byFile.get(fileName);
    if (!known) {
      invalid.push({ fileName, reason: 'not present in this runtime lockfile' });
      continue;
    }
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const actual = await sha256Hex(bytes);
    if (actual === known.pkg.sha256) valid.push(fileName);
    else invalid.push({ fileName, reason: 'SHA-256 mismatch' });
  }
  return { checked, valid, invalid };
}

export async function clearPackageCache() {
  const appHandle = await resolveAppHandle();
  if (!appHandle) return false;
  try {
    let parent = appHandle;
    for (const part of CACHE_PATH.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    await parent.removeEntry(CACHE_PATH.at(-1), { recursive: true });
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') return false;
    throw error;
  }
}

function findImports(py, code) {
  py.globals.set('_nb_package_source', String(code || ''));
  const proxy = py.runPython(`
from pyodide.code import find_imports as _nb_find_imports
list(_nb_find_imports(_nb_package_source))
`);
  try {
    return proxy?.toJs ? Array.from(proxy.toJs()) : Array.from(proxy || []);
  } finally {
    try { proxy?.destroy?.(); } catch {}
    try { py.globals.delete('_nb_package_source'); } catch {}
  }
}

async function installOne(py, name, pkg, { onStatus }) {
  if (!pkg) throw new Error(`Package ${name} is not present in the Pyodide ${PYODIDE_VERSION} lockfile`);
  onStatus(`Loading Python package ${name}…`);

  let bytes = await readVendoredArtifact(pkg);
  let source = 'Notebook Lab vendored distribution';
  // The web edition serves its own packages and never fetches from a CDN.
  if (!bytes && isWebEdition()) {
    throw new Error(`Python package “${name}” is not included in the web edition of Notebook Lab. It ships numpy, pandas, matplotlib and sympy.`);
  }
  if (!bytes) {
    const reportCacheFailure = (action) => (error) => {
      console.warn(`[pyodide-package-cache] Could not ${action}:`, error);
      onStatus(`Python package cache unavailable; continuing without it.`);
    };
    const cache = await bestEffortCache(
      () => optionalCacheHandles(),
      { onError: reportCacheFailure('open the data-root cache') },
    );
    bytes = cache
      ? await bestEffortCache(
          () => readVerifiedCachedArtifact(cache, name, pkg),
          { onError: reportCacheFailure(`read cached ${name}`) },
        )
      : null;
    source = 'Notebook Lab data-root cache';
    if (!bytes) {
      if (!getAutoDownloadPackages()) {
        throw new Error(
          `Python package “${name}” is not cached. Enable automatic package downloads in Runtime Center → Python package cache, then run the cell again.`,
        );
      }
      onStatus(`Downloading ${name} ${pkg.version}…`);
      bytes = await downloadVerifiedArtifact(name, pkg);
      source = `${UPSTREAM_DIST_URL}${pkg.file_name}`;
      if (cache) {
        await bestEffortCache(
          () => writeCachedArtifact(cache, name, pkg, bytes),
          { fallback: false, onError: reportCacheFailure(`cache downloaded ${name}`) },
        );
      }
    }
  }

  await installArtifactBytes(py, name, pkg, bytes, source);
  onStatus(`Loaded ${name} ${pkg.version}`);
}

async function installArtifactBytes(py, name, pkg, bytes, source) {
  py.globals.set('_nb_pkg_buffer', bytes);
  py.globals.set('_nb_pkg_name', name);
  py.globals.set('_nb_pkg_filename', pkg.file_name);
  py.globals.set('_nb_pkg_target', pkg.install_dir || 'site');
  py.globals.set('_nb_pkg_type', pkg.package_type || 'package');
  py.globals.set('_nb_pkg_shared', !!pkg.shared_library);
  py.globals.set('_nb_pkg_source', source);
  try {
    await py.runPythonAsync(`
import importlib as _nb_importlib
import pyodide_js as _nb_pyodide_js
from types import SimpleNamespace as _NBPackageData
from pyodide._package_loader import unpack_buffer as _nb_unpack_buffer
from pyodide_js._api import loadDynlibsFromPackage as _nb_load_dynlibs

_nb_dynlibs = _nb_unpack_buffer(
    _nb_pkg_buffer,
    filename=_nb_pkg_filename,
    target=_nb_pkg_target,
    calculate_dynlibs=True,
    installer="notebook-lab-cache",
    source=_nb_pkg_source,
)
_nb_package_data = _NBPackageData(
    file_name=_nb_pkg_filename,
    package_type=_nb_pkg_type,
    shared_library=_nb_pkg_shared,
)
await _nb_load_dynlibs(_nb_package_data, _nb_dynlibs)
setattr(_nb_pyodide_js.loadedPackages, _nb_pkg_name, _nb_pkg_source)
_nb_importlib.invalidate_caches()
`);
  } finally {
    for (const key of [
      '_nb_pkg_buffer', '_nb_pkg_name', '_nb_pkg_filename', '_nb_pkg_target',
      '_nb_pkg_type', '_nb_pkg_shared', '_nb_pkg_source',
    ]) {
      try { py.globals.delete(key); } catch {}
    }
  }
}

async function readVendoredArtifact(pkg) {
  return fetchVerifiedVendoredArtifact(new URL(pkg.file_name, LOCAL_DIST_URL), pkg.sha256);
}

async function downloadVerifiedArtifact(name, pkg) {
  const errors = [];
  for (const url of packageDownloadUrls(pkg.file_name)) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        errors.push(`${sourceLabel(url)} returned HTTP ${response.status}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = await sha256Hex(bytes);
      if (actual !== pkg.sha256) {
        errors.push(`${sourceLabel(url)} failed SHA-256 verification`);
        continue;
      }
      return bytes;
    } catch (error) {
      errors.push(`${sourceLabel(url)}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(
    `Unable to download ${name} ${pkg.version}. ${errors.join('; ')}. `
    + 'Run Notebook Lab with “python3 serve.py 8084” so package downloads use its safe same-origin proxy.',
  );
}

async function readVerifiedCachedArtifact(cache, name, pkg) {
  try {
    const handle = await cache.packages.getFileHandle(pkg.file_name);
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (await sha256Hex(bytes) === pkg.sha256) return bytes;
    await cache.packages.removeEntry(pkg.file_name);
    await removeIndexEntry(cache, name);
    return null;
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeCachedArtifact(cache, name, pkg, bytes) {
  const handle = await cache.packages.getFileHandle(pkg.file_name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
  const index = await readCacheIndex(cache);
  index.entries[name] = {
    name,
    version: pkg.version,
    fileName: pkg.file_name,
    sha256: pkg.sha256,
    bytes: bytes.byteLength,
    cachedAt: new Date().toISOString(),
  };
  index.updatedAt = new Date().toISOString();
  await writeJson(cache.root, INDEX_FILE, index);
}

async function removeIndexEntry(cache, name) {
  const index = await readCacheIndex(cache);
  delete index.entries[name];
  index.updatedAt = new Date().toISOString();
  await writeJson(cache.root, INDEX_FILE, index);
}

async function readCacheIndex(cache) {
  try {
    const handle = await cache.root.getFileHandle(INDEX_FILE);
    const value = JSON.parse(await (await handle.getFile()).text());
    if (value?.runtimeVersion === PYODIDE_VERSION && value.entries) return value;
  } catch {}
  return {
    schemaVersion: 1,
    runtimeVersion: PYODIDE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

async function writeJson(directory, fileName, value) {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(value, null, 2));
  } finally {
    await writable.close();
  }
}

async function resolveAppHandle() {
  let handle = getAppHandle();
  if (!handle) {
    try { await initHandle(); } catch {}
    handle = getAppHandle();
  }
  return handle;
}

async function optionalCacheHandles() {
  const appHandle = await resolveAppHandle();
  return appHandle ? getCacheHandles(appHandle, true) : null;
}

async function requireCacheHandles() {
  const handles = await optionalCacheHandles();
  if (!handles) {
    throw new Error('Choose a Data Root in Settings before downloading Python packages.');
  }
  return handles;
}

async function getCacheHandles(appHandle, create) {
  let root = appHandle;
  for (const part of CACHE_PATH) root = await root.getDirectoryHandle(part, { create });
  const packages = await root.getDirectoryHandle('packages', { create });
  return { root, packages };
}

function isLoaded(py, name, pkg) {
  const loaded = py.loadedPackages || {};
  return [name, pkg?.name, normalizeName(name)].some((key) => key && loaded[key] != null);
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[_.]+/g, '-');
}

function sourceLabel(url) {
  return String(url).includes(PACKAGE_PROXY_PATH) ? 'local package proxy' : 'Pyodide CDN';
}

// Copy a visitor's work from browser storage into the folder they chose.
//
// On the public site work starts in the browser's private storage
// (browser-data-root.js). Choosing a folder later switches where new work is
// saved, but leaves what was already made in the browser. This copies it over.
//
// Nothing is ever overwritten or deleted, in either place:
//  - a file the folder does not have is copied as it is;
//  - a file the folder already has with identical bytes is skipped;
//  - a file the folder has with DIFFERENT bytes is kept, and the browser's
//    version is written beside it as `name (from browser).ext`;
//  - the browser copy is left in place, so the copy can be repeated safely.
// The two data-root registries are merged (apps the folder lacks are added),
// and hub settings under `_suite/` only fill gaps (see SETTINGS_DIR).
//
// DOM-free: it only uses the directory-handle methods, so tests drive it with
// in-memory handles.

export const REGISTRY_FILENAME = 'data-root.json';
// Hub-wide settings (providers, key settings, caches), not work. The folder's
// own copy always wins: one missing from the folder is filled in, one present
// is left alone, and no "(from browser)" duplicate is ever made of a setting.
export const SETTINGS_DIR = '_suite';
const SUFFIX = 'from browser';

/** Every file under `dir`, depth first, as { path: ['a', 'b.json'], handle }. */
export async function* walkFiles(dir, prefix = [], skip = null) {
  for await (const [name, handle] of dir.entries()) {
    const path = [...prefix, name];
    if (skip && path.length === skip.length && path.every((part, i) => part === skip[i])) continue;
    if (handle.kind === 'directory') yield* walkFiles(handle, path, skip);
    else yield { path, handle };
  }
}

/** Where `target` sits inside `source`, if it does: a copy must never walk
 *  into its own destination. */
async function pathInside(source, target) {
  try {
    const path = await source.resolve?.(target);
    return Array.isArray(path) && path.length ? path : null;
  } catch {
    return null;
  }
}

/** Count what browser storage holds, for the Settings page. */
export async function summarizeStorage(root) {
  let files = 0;
  let bytes = 0;
  const apps = new Set();
  for await (const { path, handle } of walkFiles(root)) {
    if (path.length === 1 && path[0] === REGISTRY_FILENAME) continue;
    if (path[0] === SETTINGS_DIR) continue;
    const file = await handle.getFile();
    files += 1;
    bytes += file.size;
    if (path.length > 1) apps.add(path[0]);
  }
  return { files, bytes, apps: [...apps].sort() };
}

/** `report.json` → `report (from browser).json`, then `(from browser 2)`, … */
export function alternateName(name, attempt = 1) {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  return `${stem} (${SUFFIX}${attempt > 1 ? ` ${attempt}` : ''})${ext}`;
}

async function readBytes(fileHandle) {
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

async function existingFile(dir, name) {
  try {
    return await dir.getFileHandle(name, { create: false });
  } catch (error) {
    if (error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError') return null;
    throw error;
  }
}

async function writeBytes(dir, name, bytes) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function mergeRegistry(source, target) {
  const read = async (root) => {
    const handle = await existingFile(root, REGISTRY_FILENAME);
    if (!handle) return null;
    try { return JSON.parse(await (await handle.getFile()).text()); } catch { return null; }
  };
  const from = await read(source);
  if (!from?.apps) return 0;
  const into = (await read(target)) || { version: from.version || 1, apps: {} };
  into.apps = into.apps || {};
  let added = 0;
  for (const [appId, entry] of Object.entries(from.apps)) {
    if (into.apps[appId]) continue;
    into.apps[appId] = entry;
    added += 1;
  }
  if (added) await writeBytes(target, REGISTRY_FILENAME, new TextEncoder().encode(JSON.stringify(into, null, 2)));
  return added;
}

/**
 * @param {FileSystemDirectoryHandle} source  browser storage root
 * @param {FileSystemDirectoryHandle} target  the chosen folder
 * @param {{ onProgress?: (p: {done:number, path:string}) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{copied:number, identical:number, keptBoth:string[], settingsKept:number, failed:{path:string, error:string}[], registryAppsAdded:number}>}
 */
export async function copyStorageInto(source, target, { onProgress, signal } = {}) {
  const report = { copied: 0, identical: 0, keptBoth: [], settingsKept: 0, failed: [], registryAppsAdded: 0 };
  let done = 0;
  const skip = await pathInside(source, target);
  for await (const { path, handle } of walkFiles(source, [], skip)) {
    signal?.throwIfAborted?.();
    const display = path.join('/');
    if (path.length === 1 && path[0] === REGISTRY_FILENAME) continue;
    try {
      let dir = target;
      for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const name = path.at(-1);
      const bytes = await readBytes(handle);
      const existing = await existingFile(dir, name);
      if (!existing) {
        await writeBytes(dir, name, bytes);
        report.copied += 1;
      } else if (path[0] === SETTINGS_DIR) {
        report.settingsKept += 1;
      } else if (sameBytes(bytes, await readBytes(existing))) {
        report.identical += 1;
      } else {
        // Both versions are kept. A previous copy may already have written the
        // browser's version beside it; if so, that counts as identical.
        let attempt = 1;
        for (;;) {
          const alt = alternateName(name, attempt);
          const there = await existingFile(dir, alt);
          if (!there) {
            await writeBytes(dir, alt, bytes);
            report.keptBoth.push([...path.slice(0, -1), alt].join('/'));
            break;
          }
          if (sameBytes(bytes, await readBytes(there))) { report.identical += 1; break; }
          attempt += 1;
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      report.failed.push({ path: display, error: error?.message || String(error) });
    }
    done += 1;
    onProgress?.({ done, path: display });
  }
  report.registryAppsAdded = await mergeRegistry(source, target).catch(() => 0);
  return report;
}

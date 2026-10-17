// Shared Storage Adapter
// App-scoped path resolution + IO helpers built on top of the data root.
// All operations stay inside <root>/<appId>/ — path traversal is rejected.

import { ensureRoot, ensureAppNamespace, STANDARD_SUBFOLDERS } from './data-root-manager.js';

const SEGMENT_RE = /^[^\\/\x00]+$/;

function validateSegment(seg) {
  if (typeof seg !== 'string' || seg === '' || seg === '.' || seg === '..') {
    throw new Error(`Invalid path segment: ${JSON.stringify(seg)}`);
  }
  if (!SEGMENT_RE.test(seg)) {
    throw new Error(`Path segment contains disallowed characters: ${JSON.stringify(seg)}`);
  }
}

function splitSegments(segments) {
  const parts = [];
  for (const s of segments) {
    if (s == null) continue;
    const str = String(s);
    for (const part of str.split('/')) {
      if (part === '') continue;
      validateSegment(part);
      parts.push(part);
    }
  }
  return parts;
}

function assertLogicalArea(area) {
  if (area !== 'migration' && !STANDARD_SUBFOLDERS.includes(area)) {
    throw new Error(`Unknown logical area: ${area}. Expected one of ${STANDARD_SUBFOLDERS.join(', ')} or 'migration'.`);
  }
}

/**
 * Resolve a directory handle at <root>/<appId>/<logicalArea>/<segments...>.
 * Trailing segments that don't exist are created. This returns a directory
 * handle — use openFile/writeFile helpers for files.
 */
export async function resolveDir(appId, logicalArea, ...segments) {
  assertLogicalArea(logicalArea);
  const appHandle = await ensureAppNamespace(appId);
  let current = await appHandle.getDirectoryHandle(logicalArea, { create: true });
  for (const part of splitSegments(segments)) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

/**
 * Resolve {dir, fileName} for <root>/<appId>/<logicalArea>/<segments...>/<fileName>.
 * The parent dir is created. Call getFileHandle on `dir` with `fileName` yourself,
 * or use the readJson/writeJsonAtomic/exists helpers below.
 */
export async function resolveFile(appId, logicalArea, ...segments) {
  assertLogicalArea(logicalArea);
  const parts = splitSegments(segments);
  if (parts.length === 0) throw new Error('resolveFile requires at least one segment (the file name).');
  const fileName = parts.pop();
  const appHandle = await ensureAppNamespace(appId);
  let dir = await appHandle.getDirectoryHandle(logicalArea, { create: true });
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return { dir, fileName };
}

/** True if a file exists at <appId>/<logicalArea>/<segments...>. */
export async function exists(appId, logicalArea, ...segments) {
  try {
    const { dir, fileName } = await resolveFile(appId, logicalArea, ...segments);
    await dir.getFileHandle(fileName, { create: false });
    return true;
  } catch (err) {
    if (err && err.name === 'NotFoundError') return false;
    throw err;
  }
}

/** Ensure a directory path exists. Returns the final directory handle. */
export async function mkdirp(appId, logicalArea, ...segments) {
  return resolveDir(appId, logicalArea, ...segments);
}

export async function readText(appId, logicalArea, ...segments) {
  const { dir, fileName } = await resolveFile(appId, logicalArea, ...segments);
  const fh = await dir.getFileHandle(fileName, { create: false });
  const file = await fh.getFile();
  return file.text();
}

/**
 * Write text content to a file. `segments` is an array ending with the
 * filename; content is a separate arg so it's never confused with a path.
 */
export async function writeText(appId, logicalArea, segments, content) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('writeText requires a non-empty segments array ending with the filename.');
  }
  const { dir, fileName } = await resolveFile(appId, logicalArea, ...segments);
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function readJson(appId, logicalArea, ...segments) {
  const text = await readText(appId, logicalArea, ...segments);
  if (!text.trim()) return null;
  return JSON.parse(text);
}

/**
 * Atomic-ish JSON write: writes to `<name>.tmp`, then overwrites target.
 * Same caveat as the registry writer: no true atomic rename in the browser.
 */
export async function writeJsonAtomic(appId, logicalArea, segments, data) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('writeJsonAtomic requires a non-empty segments array ending with the filename.');
  }
  const parts = [...segments];
  const fileName = parts.pop();
  validateSegment(fileName);
  const text = JSON.stringify(data, null, 2);
  const tmpName = `${fileName}.tmp`;

  const { dir } = await resolveFile(appId, logicalArea, ...parts, fileName);

  const tmp = await dir.getFileHandle(tmpName, { create: true });
  let w = await tmp.createWritable();
  await w.write(text);
  await w.close();

  const target = await dir.getFileHandle(fileName, { create: true });
  w = await target.createWritable();
  await w.write(text);
  await w.close();

  try { await dir.removeEntry(tmpName); } catch { /* best-effort */ }
}

/** List files (optionally filtered by extension) inside a directory path. */
export async function listFiles(appId, logicalArea, options = {}, ...segments) {
  const dir = await resolveDir(appId, logicalArea, ...segments);
  const ext = options.extension || null;
  const names = [];
  for await (const [name, handle] of dir) {
    if (handle.kind !== 'file') continue;
    if (ext && !name.endsWith(ext)) continue;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/** Check the root is available without initializing any namespace. */
export async function isRootReady() {
  try {
    await ensureRoot();
    return true;
  } catch {
    return false;
  }
}

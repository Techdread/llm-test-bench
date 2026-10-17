const encoder = new TextEncoder();

export const DEFAULT_EXTRACTION_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

export function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return encoder.encode(String(value ?? ''));
}

function fnv1a(bytes) {
  let hash = 2166136261;
  for (const value of bytes) hash = Math.imul(hash ^ value, 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function hashBytes(value, algorithm = 'SHA-256') {
  const bytes = asBytes(value);
  if (/fnv/i.test(algorithm)) return fnv1a(bytes);
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this runtime');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeArchivePath(path) {
  const raw = String(path || '');
  if (!raw || raw.includes('\0') || raw.includes('\\')) throw new Error(`Unsafe archive path: ${raw || '(empty)'}`);
  if (raw.startsWith('/') || raw.startsWith('//') || /^[a-zA-Z]:/.test(raw)) throw new Error(`Absolute archive path is forbidden: ${raw}`);
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Archive traversal path is forbidden: ${raw}`);
  return parts.join('/');
}

export function validateArchiveEntries(entries, limits = {}) {
  const resolved = { ...DEFAULT_EXTRACTION_LIMITS, ...limits };
  const normalized = {};
  const errors = [];
  let totalBytes = 0;
  const source = entries && typeof entries === 'object' ? entries : {};
  for (const [path, value] of Object.entries(source)) {
    try {
      const safe = normalizeArchivePath(path);
      const bytes = asBytes(value);
      if (bytes.byteLength > resolved.maxFileBytes) errors.push(`${safe} exceeds the per-file extraction limit`);
      totalBytes += bytes.byteLength;
      normalized[safe] = bytes;
    } catch (error) { errors.push(error.message); }
  }
  if (Object.keys(normalized).length > resolved.maxFiles) errors.push(`archive exceeds the ${resolved.maxFiles}-file extraction limit`);
  if (totalBytes > resolved.maxTotalBytes) errors.push(`archive exceeds the ${resolved.maxTotalBytes}-byte extraction limit`);
  return { entries: normalized, errors, totalBytes, fileCount: Object.keys(normalized).length, limits: resolved };
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

/** Inspect ZIP metadata before decompression so bombs and Unix symlinks fail closed. */
export function inspectZipArchive(value, limits = {}) {
  const bytes = asBytes(value);
  const resolved = { ...DEFAULT_EXTRACTION_LIMITS, ...limits };
  const errors = [];
  const entries = [];
  if (bytes.byteLength < 22) return { ok: false, errors: ['ZIP is truncated'], entries, limits: resolved };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) return { ok: false, errors: ['ZIP central directory is missing'], entries, limits: resolved };
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0) errors.push('multi-disk ZIP archives are unsupported');
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) errors.push('ZIP64 archives are unsupported');
  if (centralOffset + centralSize > bytes.byteLength) errors.push('ZIP central directory exceeds the archive bounds');
  const decoder = new TextDecoder();
  let offset = centralOffset;
  let totalBytes = 0;
  let fileCount = 0;
  let parsedCount = 0;
  for (let index = 0; index < count && offset + 46 <= bytes.byteLength; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) { errors.push('ZIP central directory entry is invalid'); break; }
    const madeBy = view.getUint16(offset + 4, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > bytes.byteLength) { errors.push('ZIP filename exceeds the archive bounds'); break; }
    const path = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    parsedCount += 1;
    const isDirectory = path.endsWith('/');
    if (!isDirectory) {
      try { normalizeArchivePath(path); } catch (error) { errors.push(error.message); }
      const hostSystem = madeBy >>> 8;
      const unixMode = externalAttributes >>> 16;
      if (hostSystem === 3 && (unixMode & 0o170000) === 0o120000) errors.push(`Symlink-like ZIP entry is forbidden: ${path}`);
      if (uncompressedBytes > resolved.maxFileBytes) errors.push(`${path} exceeds the per-file extraction limit`);
      totalBytes += uncompressedBytes;
      fileCount += 1;
      entries.push({ path, uncompressedBytes, unixMode });
    }
    offset = nameEnd + extraLength + commentLength;
  }
  if (parsedCount !== count) errors.push('ZIP central directory entry count does not match the archive');
  if (fileCount > resolved.maxFiles) errors.push(`archive exceeds the ${resolved.maxFiles}-file extraction limit`);
  if (totalBytes > resolved.maxTotalBytes) errors.push(`archive exceeds the ${resolved.maxTotalBytes}-byte extraction limit`);
  return { ok: errors.length === 0, errors, entries, totalBytes, fileCount, limits: resolved };
}

export async function createIntegrityInventory(entries, { kind = 'game-refinement-integrity' } = {}) {
  const files = {};
  for (const path of Object.keys(entries || {}).sort()) {
    const bytes = asBytes(entries[path]);
    files[path] = { bytes: bytes.byteLength, sha256: await hashBytes(bytes) };
  }
  return { kind, schemaVersion: 1, algorithm: 'SHA-256', files };
}

export async function verifyIntegrityInventory(entries, inventory, { rejectUnlisted = false } = {}) {
  const errors = [];
  if (!inventory || typeof inventory.files !== 'object') return { ok: false, errors: ['integrity inventory is missing or invalid'] };
  const algorithm = inventory.algorithm || 'SHA-256';
  for (const [path, expected] of Object.entries(inventory.files)) {
    const value = entries[path];
    if (value == null) { errors.push(`integrity file is missing: ${path}`); continue; }
    const bytes = asBytes(value);
    if (bytes.byteLength !== Number(expected.bytes)) errors.push(`integrity byte count changed: ${path}`);
    const actual = await hashBytes(bytes, algorithm);
    if (actual !== expected.sha256) errors.push(`integrity hash changed: ${path}`);
  }
  if (rejectUnlisted) {
    for (const path of Object.keys(entries)) if (!inventory.files[path]) errors.push(`file is absent from integrity inventory: ${path}`);
  }
  return { ok: errors.length === 0, errors };
}

export async function integrityIdentity(inventory) {
  const stable = Object.keys(inventory?.files || {}).sort().map(path => {
    const item = inventory.files[path];
    return `${path}\0${item.bytes}\0${item.sha256}`;
  }).join('\n');
  return hashBytes(stable);
}

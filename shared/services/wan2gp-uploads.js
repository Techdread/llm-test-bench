// Turn whatever an app has — a File, a Blob, a data: URL, a blob: URL, or a
// path the node already knows — into a server-side path usable in a job payload.
//
// Uploads are content-addressed and cached per node for the session, so the
// same reference image handed to three services uploads once. That matters:
// a cast reference or a mask gets re-sent on every re-roll.
//
// `POST /api/uploads` arrived in agent API 0.6.0. Against an older node the
// upload 404s, and the error says so rather than surfacing a bare HTTP code.

import { uploadMedia, resolveActiveNodeId } from './wan2gp.js';

// nodeKey -> (contentHash -> Promise<uploadResult>)
const uploads = new Map();

function nodeKey(opts = {}) {
  if (opts.nodeId) return String(opts.nodeId);
  try {
    return String(resolveActiveNodeId({ appId: opts.appId }) || 'default');
  } catch {
    return 'default';
  }
}

function cacheFor(opts) {
  const key = nodeKey(opts);
  let map = uploads.get(key);
  if (!map) {
    map = new Map();
    uploads.set(key, map);
  }
  return map;
}

/** Forget cached uploads. Omit `opts` to clear every node. */
export function invalidateUploads(opts) {
  if (!opts) return uploads.clear();
  uploads.delete(nodeKey(opts));
}

function looksLikeServerPath(value) {
  const str = String(value);
  if (/^(data|blob|https?):/i.test(str)) return false;
  return str.includes('/') || str.includes('\\');
}

async function toBlob(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (typeof value === 'string') {
    const res = await fetch(value);
    if (!res.ok) throw new Error(`resolveMediaInput: could not read ${value.slice(0, 60)}`);
    return res.blob();
  }
  throw new Error('resolveMediaInput: unsupported media value');
}

async function hashBlob(blob) {
  const buffer = await blob.arrayBuffer();
  // crypto.subtle is available in secure contexts and under node; when it is
  // not, fall back to a size+type key. Worst case that means an extra upload,
  // never a wrong one, because the key still includes the byte length.
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `nohash-${blob.size}-${blob.type || 'bin'}`;
}

function extensionFor(blob, fallbackName) {
  if (fallbackName && /\.[a-z0-9]{2,5}$/i.test(fallbackName)) return '';
  const type = String(blob?.type || '');
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
  };
  return map[type] || '';
}

/**
 * Resolve one media input to a server-side path.
 *
 * @param {File|Blob|string} value  File/Blob, `data:`/`blob:`/`http(s):` URL,
 *   or a path the node already holds (returned unchanged).
 * @param {object} [opts] `{ nodeId, appId, signal, name }`
 * @returns {Promise<string>} server-side path
 */
export async function resolveMediaInput(value, opts = {}) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object' && !(typeof Blob !== 'undefined' && value instanceof Blob)) {
    if (value.path) return String(value.path);
  }
  if (typeof value === 'string' && looksLikeServerPath(value)) return value;

  const blob = await toBlob(value);
  const hash = await hashBlob(blob);
  const cache = cacheFor(opts);
  if (cache.has(hash)) {
    const cached = await cache.get(hash);
    return cached.path;
  }

  const name = opts.name || value?.name || `upload-${hash.slice(0, 12)}${extensionFor(blob, opts.name)}`;
  const file = typeof File !== 'undefined' && blob instanceof File
    ? blob
    : new File([blob], name, { type: blob.type || 'application/octet-stream' });

  const promise = uploadMedia(file, { nodeId: opts.nodeId, appId: opts.appId, signal: opts.signal })
    .catch((err) => {
      cache.delete(hash);
      const message = String(err?.message || err);
      if (/\b404\b/.test(message)) {
        throw new Error(
          'Wan2GP node does not support uploads (POST /api/uploads needs agent API 0.6.0). Update the node, or pass a path it already has.',
        );
      }
      throw err;
    });
  cache.set(hash, promise);

  const result = await promise;
  if (!result?.path) throw new Error('resolveMediaInput: upload did not return a path');
  return result.path;
}

/** Resolve a list of media inputs, preserving order and dropping empties. */
export async function resolveMediaInputs(values, opts = {}) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const paths = [];
  for (const value of list) {
    const path = await resolveMediaInput(value, opts);
    if (path) paths.push(path);
  }
  return paths;
}

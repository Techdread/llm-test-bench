// Browser client for the LAN Wan2GP Agent API.
//
// Node-aware: every public function accepts an optional `{ nodeId, appId }`
// to choose which backend to talk to. With nothing supplied, falls back to
// the per-app override (if `appId` is given) and then the global active node.

import {
  resolveNode,
  getNodes,
  getNode,
  saveNodes,
  addNode,
  updateNode,
  removeNode,
  getGlobalActiveNodeId,
  setGlobalActiveNodeId,
  getAppOverrideNodeId,
  setAppOverrideNodeId,
  resolveActiveNodeId,
  FALLBACK_NODE,
} from './wan2gp-nodes.js';
import { suite, hydrateSuite, setSuite, getSuiteField } from './suite-prefs.js';

const PREFS_AREA = 'wan2gp';
const FIELD_JOB_LIMIT = 'jobLimit';
const FIELD_AUTO_REFRESH = 'autoRefresh';

const PREFS_LEGACY = {
  [FIELD_JOB_LIMIT]: 'devtools-hub-wan2gp-job-limit',
  [FIELD_AUTO_REFRESH]: 'devtools-hub-wan2gp-auto-refresh',
};

export const DEFAULT_ENDPOINT = '/__wan2gp';
export const RTX_3090_ENDPOINT = 'http://127.0.0.1:8100';
export const RTX_3060_ENDPOINT = 'http://127.0.0.1:8100';
export const DIRECT_ENDPOINT = RTX_3090_ENDPOINT;
export const DEFAULT_JOB_LIMIT = 50;

// Seed the suite-prefs snapshot from any legacy localStorage scratch on
// import, then kick off the disk hydrate. Sync getters below read from
// this snapshot — they stay synchronous so existing call sites are
// unaffected.
const PREFS_DEFAULTS = {
  [FIELD_JOB_LIMIT]: String(DEFAULT_JOB_LIMIT),
  [FIELD_AUTO_REFRESH]: 'true',
};
suite(PREFS_AREA, { defaults: PREFS_DEFAULTS, legacyKeys: PREFS_LEGACY });
hydrateSuite(PREFS_AREA, { defaults: PREFS_DEFAULTS, legacyKeys: PREFS_LEGACY });

// Re-export node helpers for callers that need the registry directly.
export {
  resolveNode,
  getNodes,
  getNode,
  saveNodes,
  addNode,
  updateNode,
  removeNode,
  getGlobalActiveNodeId,
  setGlobalActiveNodeId,
  getAppOverrideNodeId,
  setAppOverrideNodeId,
  resolveActiveNodeId,
  FALLBACK_NODE,
};

// Kept for back-compat with any old caller still iterating presets.
export const ENDPOINT_PRESETS = [
  { id: 'proxy',    label: 'Local proxy', endpoint: DEFAULT_ENDPOINT,  detail: 'Uses serve.py from this dashboard computer.' },
  { id: 'rtx-3090', label: 'RTX 3090',    endpoint: RTX_3090_ENDPOINT, detail: 'Direct LAN call to the Windows 3090 API node.' },
  { id: 'rtx-3060', label: 'RTX 3060',    endpoint: RTX_3060_ENDPOINT, detail: 'Previous direct LAN API node.' },
];

function cleanEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isProxyEndpoint(baseUrl) {
  return cleanEndpoint(baseUrl) === DEFAULT_ENDPOINT;
}

function tokenForRequest(node) {
  if (node?.token) return node.token;
  if (!isProxyEndpoint(node?.baseUrl)) return '';

  // The local proxy target is configured server-side, so the browser cannot
  // inspect it. In the seeded registry it points at the RTX 3090 node; if the
  // user saved the token there but kept the dashboard on "/__wan2gp", reuse it.
  const nodes = getNodes();
  const preferred = nodes.find(n => n.id === 'rtx-3090' && n.token)
    || nodes.find(n => cleanEndpoint(n.baseUrl) === cleanEndpoint(RTX_3090_ENDPOINT) && n.token);
  if (preferred?.token) return preferred.token;

  const tokenNodes = nodes.filter(n => n.token);
  return tokenNodes.length === 1 ? tokenNodes[0].token : '';
}

// Many existing callers pass a bare AbortSignal as the second positional
// argument (e.g. getJob(id, signal)). Detect that shape and wrap it.
function asOpts(arg) {
  if (!arg) return {};
  if (typeof arg !== 'object') return {};
  if (typeof AbortSignal !== 'undefined' && arg instanceof AbortSignal) return { signal: arg };
  return arg;
}

// Deprecated: persist edits into the active node. Kept so the dashboard's
// existing settings dialog continues to work while we migrate it.
export function saveEndpoint(endpoint) {
  const cleaned = cleanEndpoint(endpoint || DEFAULT_ENDPOINT);
  const activeId = getGlobalActiveNodeId();
  const nodes = getNodes();
  const idx = nodes.findIndex(n => n.id === activeId);
  if (idx !== -1) {
    nodes[idx] = { ...nodes[idx], baseUrl: cleaned };
    saveNodes(nodes);
    return;
  }
  // No active node? Create one.
  addNode({ name: 'Active', baseUrl: cleaned, token: '' });
}

// Deprecated: persist token into the active node.
export function saveToken(token) {
  const value = String(token || '').trim();
  const activeId = getGlobalActiveNodeId();
  const nodes = getNodes();
  const idx = nodes.findIndex(n => n.id === activeId);
  if (idx !== -1) {
    nodes[idx] = { ...nodes[idx], token: value };
    saveNodes(nodes);
  }
}

// Active-node convenience accessors. Pass `{ appId, nodeId }` to scope.
export function getEndpoint(opts) {
  return cleanEndpoint(resolveNode(opts).baseUrl) || DEFAULT_ENDPOINT;
}

export function getToken(opts) {
  return resolveNode(opts).token || '';
}

export function hasToken(opts) {
  return Boolean(getToken(opts));
}

// jobLimit and autoRefresh are stored as strings in both the localStorage
// scratch and the disk JSON. The LS scratch fallback in suite-prefs only
// writes string values, so keeping the same shape on disk keeps the two
// stores trivially comparable. The getters coerce on read.

export function getJobLimit() {
  const raw = getSuiteField(PREFS_AREA, FIELD_JOB_LIMIT, '');
  const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JOB_LIMIT;
}

export function saveJobLimit(limit) {
  const parsed = parseInt(limit, 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JOB_LIMIT;
  setSuite(PREFS_AREA, FIELD_JOB_LIMIT, String(normalized));
}

export function getAutoRefresh() {
  return getSuiteField(PREFS_AREA, FIELD_AUTO_REFRESH, 'true') !== 'false';
}

export function saveAutoRefresh(enabled) {
  setSuite(PREFS_AREA, FIELD_AUTO_REFRESH, enabled ? 'true' : 'false');
}

function apiUrl(path, params, baseUrl) {
  const base = cleanEndpoint(baseUrl) || DEFAULT_ENDPOINT;
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const normalizedBase = base.startsWith('http')
    ? `${base}/`
    : `${base.replace(/\/+$/, '')}/`;
  const url = base.startsWith('http')
    ? new URL(cleanPath, normalizedBase)
    : new URL(normalizedBase + cleanPath, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function responseMessage(status, statusText, payloadText) {
  if (!payloadText) return `${status} ${statusText}`.trim();
  try {
    const json = JSON.parse(payloadText);
    const detail = json.error?.message || json.detail || json.error || json.message;
    if (detail) return `${status} ${statusText}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  } catch {
    // Fall back to the raw body below.
  }
  return `${status} ${statusText}: ${payloadText.slice(0, 300)}`.trim();
}

/**
 * Issue a JSON request against the resolved node.
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.nodeId]   Explicit node override (highest precedence).
 * @param {string} [options.appId]    Per-app node override.
 * @param {string} [options.method]   Default GET.
 * @param {*}      [options.body]
 * @param {boolean}[options.auth]     Default true (sends Authorization header if a token exists).
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.params]   Querystring params.
 * @param {object} [options.headers]
 */
export async function requestJson(path, options = {}) {
  const {
    method = 'GET',
    body,
    auth = true,
    signal,
    params,
    nodeId,
    appId,
  } = options;

  const node = resolveNode({ nodeId, appId });

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let payload = body;
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (!multipart && body !== undefined && body !== null && typeof body !== 'string') {
    payload = JSON.stringify(body);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const token = auth ? tokenForRequest(node) : '';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(path, params, node.baseUrl), {
    method,
    headers,
    body: payload,
    signal,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(responseMessage(res.status, res.statusText, text));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// All API helpers accept `{ nodeId, appId, signal }` so callers can scope
// without dragging the node lookup through their own code.

export async function fetchHealth(opts) {
  return requestJson('/api/health', { auth: false, ...asOpts(opts) });
}

export async function fetchModels(opts) {
  return requestJson('/api/models', asOpts(opts));
}

/**
 * Upload an image, video, or audio input to the active Wan2GP node.
 * Returns `{ upload_id, filename, path, bytes, mime_type }`; use `path` in a
 * later generation payload. The server enforces its extension and size caps.
 */
export async function uploadMedia(file, opts) {
  if (!file) throw new Error('uploadMedia: file is required');
  const form = new FormData();
  const filename = file.name || 'media.bin';
  form.append('file', file, filename);
  form.append('filename', filename);
  return requestJson('/api/uploads', { method: 'POST', body: form, ...asOpts(opts) });
}

export async function fetchModelDetail(modelType, opts) {
  return requestJson(`/api/models/${encodeURIComponent(modelType)}`, asOpts(opts));
}

export async function fetchSettings(opts) {
  return requestJson('/api/settings', asOpts(opts));
}

export async function fetchSettingsSchema(opts) {
  return requestJson('/api/settings/schema', asOpts(opts));
}

export async function validateSettings(payload, opts) {
  return requestJson('/api/settings/validate', { method: 'POST', body: payload, ...asOpts(opts) });
}

export async function fetchLoras(modelType, opts) {
  const o = asOpts(opts);
  return requestJson('/api/loras', { ...o, params: { ...(o.params || {}), model_type: modelType } });
}

export async function listJobs(limit = getJobLimit(), opts) {
  const o = asOpts(opts);
  return requestJson('/api/jobs', { ...o, params: { ...(o.params || {}), limit } });
}

export async function getJob(jobId, opts) {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, asOpts(opts));
}

export async function submitJob(payload, opts) {
  return requestJson('/api/jobs', { method: 'POST', body: payload, ...asOpts(opts) });
}

export async function cancelJob(jobId, opts) {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', ...asOpts(opts) });
}

export async function releaseVram(opts) {
  return requestJson('/api/release', { method: 'POST', body: {}, ...asOpts(opts) });
}

export async function downloadFile(path, opts) {
  const o = asOpts(opts);
  const node = resolveNode(o);
  const headers = {};
  const token = tokenForRequest(node);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl('/api/file', { path }, node.baseUrl), {
    headers,
    signal: o.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(responseMessage(res.status, res.statusText, text));
  }
  return res.blob();
}

export function fileNameFromPath(path) {
  const value = String(path || '');
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value || 'output';
}

export function normalizeJobs(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

export function normalizeModels(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.models)) return payload.models;
  return [];
}

export function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function isCancellableStatus(status) {
  return ['queued', 'running', 'cancelling'].includes(String(status || '').toLowerCase());
}

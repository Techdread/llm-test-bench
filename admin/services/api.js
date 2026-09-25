// Admin API client. Every write carries X-Admin-Request (the server's CSRF
// check); Cloudflare Access supplies the identity via its cookie.

const BASE = '../api/admin/';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(path, { method = 'GET', json, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') init.headers['X-Admin-Request'] = '1';
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    // An expired Access session answers with a redirect to the login page,
    // which fetch cannot follow across origins.
    throw new ApiError(0, 'Could not reach the admin API. Your sign-in may have expired: reload the page.');
  }
  const type = res.headers.get('Content-Type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (reload the page to sign in again)' : '';
    throw new ApiError(res.status, `${body?.error || `HTTP ${res.status}`}${hint}`);
  }
  return body ?? res;
}

export const me = () => call('me');
export const listItems = async () => (await call('items')).items;
export const updateItem = async (id, patch) => (await call(`items/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch })).item;
export const saveOrder = (ids) => call('order', { method: 'POST', json: { ids } });
export const listAudit = async (before) => (await call(`audit?limit=100${before ? `&before=${before}` : ''}`)).entries;
export const restoreRevision = async (id, keys) => (await call(`items/${encodeURIComponent(id)}/restore`, { method: 'POST', json: keys })).item;
export const backupManifest = () => call('backup');
export const objectUrl = (key) => `${BASE}object/${key}`;

export async function publish(meta, { code, prompt, poster }) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('code', new Blob([code]), 'code');
  form.append('prompt', prompt || '');
  if (poster) form.append('poster', new Blob([poster]), 'poster');
  return (await call('items', { method: 'POST', form })).item;
}

export async function replacePoster(id, poster) {
  const form = new FormData();
  form.append('poster', new Blob([poster]), 'poster');
  return (await call(`items/${encodeURIComponent(id)}/poster`, { method: 'POST', form })).item;
}

export async function fetchObject(key) {
  const res = await call(`object/${key}`);
  return new Uint8Array(await res.arrayBuffer());
}

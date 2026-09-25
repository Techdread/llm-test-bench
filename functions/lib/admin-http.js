// Shared plumbing for the admin routes: error mapping and body parsing.
import { AccessError } from './access.js';
import { AdminError } from './admin-store.js';
import { json } from './http.js';

export function adminError(error) {
  if (error instanceof AccessError || error instanceof AdminError) {
    return json({ error: error.message }, { status: error.status });
  }
  console.error('[admin]', error?.stack || error);
  return json({ error: 'admin backend error' }, { status: 500 });
}

/** Run a handler with the admin identity the middleware attached. */
export function adminRoute(handler) {
  return async (context) => {
    try {
      const { env } = context;
      if (!env.DB || !env.MEDIA) return json({ error: 'showcase backend not configured' }, { status: 503 });
      return await handler({ ...context, actor: context.data.admin.email, now: new Date().toISOString() });
    } catch (error) {
      return adminError(error);
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new AdminError(400, 'request body must be JSON');
  }
}

export async function fileBytes(value) {
  if (!value) return null;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(await value.arrayBuffer());
}

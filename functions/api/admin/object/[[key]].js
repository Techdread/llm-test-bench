// GET /api/admin/object/<key> — any stored object, hidden items' included
// (backup, previews of past revisions). Sandboxed like the public media route.
import { mediaHeaders } from '../../../lib/showcase-store.js';
import { adminRoute } from '../../../lib/admin-http.js';
import { json } from '../../../lib/http.js';

const KEY = /^(code|prompt|posters)\/[0-9a-f]{64}\.[a-z]+$/;

export const onRequestGet = adminRoute(async ({ env, params }) => {
  const key = Array.isArray(params.key) ? params.key.join('/') : String(params.key || '');
  if (!KEY.test(key)) return json({ error: 'not found' }, { status: 404 });
  const object = await env.MEDIA.get(key);
  if (!object) return json({ error: 'not found' }, { status: 404 });
  const headers = mediaHeaders(key, object);
  headers.set('Cache-Control', 'private, no-store');
  if (key.endsWith('.md')) headers.set('Content-Type', 'text/markdown; charset=utf-8');
  if (/\.(html|js)$/.test(key)) headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(object.body, { headers });
});

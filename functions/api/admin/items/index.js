// GET  /api/admin/items — every item, hidden ones included.
// POST /api/admin/items — publish (multipart: meta JSON, code, prompt, poster).
import { listAll, publishItem, AdminError } from '../../../lib/admin-store.js';
import { adminRoute, fileBytes } from '../../../lib/admin-http.js';
import { json } from '../../../lib/http.js';

export const onRequestGet = adminRoute(async ({ env }) => json({ items: await listAll(env.DB) }));

export const onRequestPost = adminRoute(async ({ env, request, actor, now }) => {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new AdminError(400, 'publish expects multipart/form-data');
  }
  let meta;
  try {
    meta = JSON.parse(String(form.get('meta') || ''));
  } catch {
    throw new AdminError(400, 'meta must be JSON');
  }
  const row = await publishItem(env.DB, env.MEDIA, meta, {
    code: await fileBytes(form.get('code')),
    prompt: String(form.get('prompt') || ''),
    poster: await fileBytes(form.get('poster')),
  }, { actor, now });
  return json({ item: row }, { status: 201 });
});

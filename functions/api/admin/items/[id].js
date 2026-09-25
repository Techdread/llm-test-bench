// PATCH /api/admin/items/<id> — { title?, note?, rating?, status?, hero? }
import { updateItem } from '../../../lib/admin-store.js';
import { adminRoute, readJson } from '../../../lib/admin-http.js';
import { json } from '../../../lib/http.js';

export const onRequestPatch = adminRoute(async ({ env, params, request, actor, now }) =>
  json({ item: await updateItem(env.DB, String(params.id), await readJson(request), { actor, now }) }));

// POST /api/admin/order — { ids: [...] } naming every item once, in display order.
import { reorderItems } from '../../lib/admin-store.js';
import { adminRoute, readJson } from '../../lib/admin-http.js';
import { json } from '../../lib/http.js';

export const onRequestPost = adminRoute(async ({ env, request, actor, now }) =>
  json({ ids: await reorderItems(env.DB, (await readJson(request)).ids, { actor, now }) }));

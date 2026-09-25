// POST /api/admin/items/<id>/restore — { code_key?, poster_key? } from the audit log.
import { restoreRevision } from '../../../../lib/admin-store.js';
import { adminRoute, readJson } from '../../../../lib/admin-http.js';
import { json } from '../../../../lib/http.js';

export const onRequestPost = adminRoute(async ({ env, params, request, actor, now }) =>
  json({ item: await restoreRevision(env.DB, env.MEDIA, String(params.id), await readJson(request), { actor, now }) }));

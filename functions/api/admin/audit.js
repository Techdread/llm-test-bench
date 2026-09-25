// GET /api/admin/audit?before=<seq>&limit=<n> — newest first.
import { listAudit } from '../../lib/admin-store.js';
import { adminRoute } from '../../lib/admin-http.js';
import { json } from '../../lib/http.js';

export const onRequestGet = adminRoute(async ({ env, request }) => {
  const url = new URL(request.url);
  return json({ entries: await listAudit(env.DB, { before: url.searchParams.get('before'), limit: url.searchParams.get('limit') }) });
});

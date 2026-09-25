// GET /api/admin/backup — every row and every object key ever referenced. The
// console then fetches each object from /api/admin/object/<key> (one request
// per object keeps each invocation inside the free plan's limits).
import { backupManifest } from '../../lib/admin-store.js';
import { adminRoute } from '../../lib/admin-http.js';
import { json } from '../../lib/http.js';

export const onRequestGet = adminRoute(async ({ env }) => json(await backupManifest(env.DB)));

// GET /api/showcase — published items in display order (spec 342).
import { listPublished, mediaBase } from '../../lib/showcase-store.js';
import { json, notConfigured, serverError } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return notConfigured();
  try {
    const showcase = await listPublished(env.DB, mediaBase(env.MEDIA_BASE_URL));
    // Short edge/browser cache: publishing (phase 2) should show within a minute.
    return json({ showcase }, { cache: 'public, max-age=60' });
  } catch (error) {
    return serverError(error);
  }
}

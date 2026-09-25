// GET /api/showcase/<id> — the payload a bench's #/showcase/<id> route loads.
import { getPayload, isValidId } from '../../lib/showcase-store.js';
import { json, notConfigured, notFound, serverError } from '../../lib/http.js';

export async function onRequestGet({ env, params }) {
  if (!env.DB || !env.MEDIA) return notConfigured();
  const id = String(params.id || '').replace(/\.json$/, '');
  if (!isValidId(id)) return notFound();
  try {
    const payload = await getPayload(env.DB, env.MEDIA, id);
    return payload ? json(payload, { cache: 'public, max-age=60' }) : notFound();
  } catch (error) {
    return serverError(error);
  }
}

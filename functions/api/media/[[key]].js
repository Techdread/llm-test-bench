// GET /api/media/<key> — posters and SVG artwork of published items, from R2.
import { isServableMedia, mediaHeaders } from '../../lib/showcase-store.js';
import { notConfigured, notFound, serverError } from '../../lib/http.js';

export async function onRequestGet({ env, params, request }) {
  if (!env.DB || !env.MEDIA) return notConfigured();
  const key = Array.isArray(params.key) ? params.key.join('/') : String(params.key || '');
  try {
    if (!(await isServableMedia(env.DB, key))) return notFound();
    const object = await env.MEDIA.get(key);
    if (!object) return notFound();
    const headers = mediaHeaders(key, object);
    if (object.httpEtag && request.headers.get('If-None-Match') === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return serverError(error);
  }
}

// Showcase read path (spec 342, phase 1).
//
// Pure functions over a D1-shaped `db` and an R2-shaped `bucket`, so the same
// code runs in Cloudflare Pages Functions and under node:test (see
// public-mvp/tests/lib/). Nothing here touches globals.
//
// R2 keys are content-addressed and never overwritten:
//   code/<sha256>.<html|js|svg>   the generation
//   prompt/<sha256>.md            its prompt
//   posters/<sha256>.<jpg|png>    tile image (none for SVG: the file is the art)

export const MEDIA_ROUTE = 'api/media/';

/**
 * Where tile images are fetched from. Production serves the R2 bucket straight
 * from its own subdomain (MEDIA_BASE_URL, e.g. https://media.neuroviz.uk/):
 * static to the browser, so no Functions request per image (the free plan
 * shares 100k/day), and a separate origin, so a model-written SVG can never
 * reach this site's storage. Without it, images go through the MEDIA_ROUTE Function.
 */
export function mediaBase(value) {
  const base = String(value || '').trim();
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(base)) return MEDIA_ROUTE;
  return base.endsWith('/') ? base : `${base}/`;
}

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

// Anything served from the showcase stores is model-written or model-derived.
// Opened directly it must not reach this origin's storage (visitors' API keys);
// as an <img> it renders normally. Mirrors the /_showcase/* rule in _headers.
export const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function parseJsonList(text) {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const extOf = (key) => String(key || '').split('.').pop().toLowerCase();

/** Public list entry: what showcase.js needs to draw a tile. */
export function toTile(row, base = MEDIA_ROUTE) {
  const svg = row.kind === 'svg';
  return {
    id: row.id,
    bench: row.bench,
    title: row.title,
    note: row.note || '',
    rating: row.rating || '',
    kind: row.kind,
    ext: `.${row.kind}`,
    hero: Boolean(row.hero),
    posterUrl: row.poster_key ? `${base}${row.poster_key}` : '',
    artUrl: svg ? `${base}${row.code_key}` : '',
    cdnHosts: parseJsonList(row.cdn_hosts),
  };
}

export async function listPublished(db, base = MEDIA_ROUTE) {
  const { results } = await db
    .prepare(`SELECT id, bench, title, note, rating, kind, code_key, poster_key, hero, cdn_hosts
              FROM items WHERE status = 'published' ORDER BY position, id`)
    .all();
  return (results || []).map(row => toTile(row, base));
}

/**
 * The payload the benches' #/showcase/<id> route loads
 * (shared/services/showcase.js). Null when unknown or hidden.
 */
export async function getPayload(db, bucket, id) {
  if (!isValidId(id)) return null;
  const row = await db
    .prepare(`SELECT id, bench, title, note, rating, kind, code_key, prompt_key
              FROM items WHERE id = ? AND status = 'published'`)
    .bind(id)
    .first();
  if (!row) return null;
  const codeObject = await bucket.get(row.code_key);
  if (!codeObject) return null;             // row without its file: treat as absent
  const promptObject = row.prompt_key ? await bucket.get(row.prompt_key) : null;
  return {
    id: row.id,
    bench: row.bench,
    title: row.title,
    note: row.note || '',
    rating: row.rating || '',
    kind: row.kind,
    prompt: promptObject ? (await promptObject.text()).trim() : '',
    code: await codeObject.text(),
  };
}

/**
 * Only posters and SVG artwork of *published* items are servable. Generated
 * HTML/JS is never served raw; the benches get it inside the JSON payload and
 * render it in their sandboxed preview.
 */
export async function isServableMedia(db, key) {
  if (typeof key !== 'string' || key.includes('..') || !MEDIA_TYPES[extOf(key)]) return false;
  if (key.startsWith('posters/')) {
    const row = await db
      .prepare(`SELECT 1 AS ok FROM items WHERE status = 'published' AND poster_key = ? LIMIT 1`)
      .bind(key).first();
    return Boolean(row);
  }
  if (key.startsWith('code/') && extOf(key) === 'svg') {
    const row = await db
      .prepare(`SELECT 1 AS ok FROM items WHERE status = 'published' AND kind = 'svg' AND code_key = ? LIMIT 1`)
      .bind(key).first();
    return Boolean(row);
  }
  return false;
}

export function mediaHeaders(key, object) {
  const headers = new Headers({
    'Content-Type': MEDIA_TYPES[extOf(key)] || 'application/octet-stream',
    'Content-Security-Policy': SANDBOX_CSP,
    'X-Content-Type-Options': 'nosniff',
    // Content-addressed: the bytes behind a key never change.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (object?.httpEtag) headers.set('ETag', object.httpEtag);
  return headers;
}

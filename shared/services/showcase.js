// Showcase deep-links — the landing page's curated tiles.
//
// A tile on the public site links to `<app>/#/showcase/<id>`. The app calls
// consumeShowcaseRoute() once on mount; if the hash names a showcase item it
// fetches `_showcase/<id>.json` (written by tools/build-public-mvp.mjs) and
// hands back the prompt and code so the app can drop straight into its editor.
//
// Deliberately not built on hub-pipes: a tile is a plain <a href>, so the link
// has to survive being shared, bookmarked and reloaded. localStorage handoffs
// do not. The trade-off is that the payload must exist as a static file, which
// is exactly what the builder emits.
//
// No-ops cleanly on the private hub, where `_showcase/` does not exist.

const ROUTE = /^#\/showcase\/([A-Za-z0-9._-]+)$/;

/** The showcase id in the current hash, or '' if this is not a showcase route. */
export function showcaseIdFromHash(hash = globalThis.location?.hash || '') {
  const m = ROUTE.exec(hash);
  return m ? m[1] : '';
}

/**
 * Fetch one showcase payload. Returns null when the id is unknown or the
 * build carries no showcase, so callers can fall through to normal startup.
 *
 * @param {string} id
 * @param {{ base?: string, fetchImpl?: typeof fetch }} [opts]
 */
export async function loadShowcaseItem(id, opts = {}) {
  if (!id) return null;
  const base = opts.base ?? '../_showcase';
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  try {
    const res = await doFetch(`${base}/${encodeURIComponent(id)}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.code === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * One-shot helper for app mount: if the hash is a showcase route, resolve the
 * payload and rewrite the hash to `#/create` so a reload does not re-apply it
 * over the user's subsequent edits. Returns the payload, or null.
 */
export async function consumeShowcaseRoute(opts = {}) {
  const id = showcaseIdFromHash();
  if (!id) return null;
  const item = await loadShowcaseItem(id, opts);
  // Clear the route either way: a bad id should not strand the app on a hash
  // no view knows how to render.
  if (globalThis.location) globalThis.location.hash = '#/create';
  return item;
}

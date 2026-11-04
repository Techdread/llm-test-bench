// Showcase deep-links — the landing page's curated tiles.
//
// A tile on the public site links to `<app>/#/showcase/<id>`. The app calls
// resolveShowcaseRoute() whenever its route is `showcase`; if the hash names a
// showcase item it fetches the payload, and the app shows the piece running
// full-size (shared/components/ShowcaseLanding.js) with a button that loads the
// prompt and code into its editor. On the public build the showcase backend
// (`api/showcase/<id>`, spec 342) is asked first; `_showcase/<id>.json`, which
// tools/build-public-mvp.mjs bakes into every build, is the fallback.
//
// Deliberately not built on hub-pipes: a tile is a plain <a href>, so the link
// has to survive being shared, bookmarked and reloaded. localStorage handoffs
// do not. The trade-off is that the payload must exist as a static file, which
// is exactly what the builder emits.
//
// No-ops cleanly on the private hub, where `_showcase/` does not exist.

import { isPublicDistribution } from './distribution.js';

const ROUTE = /^#\/showcase\/([A-Za-z0-9._-]+)$/;

/** The showcase id in the current hash, or '' if this is not a showcase route. */
export function showcaseIdFromHash(hash = globalThis.location?.hash || '') {
  const m = ROUTE.exec(hash);
  return m ? m[1] : '';
}

async function fetchPayload(doFetch, url) {
  try {
    const res = await doFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.code === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one showcase payload. Returns null when the id is unknown or the
 * build carries no showcase, so callers can fall through to normal startup.
 *
 * @param {string} id
 * @param {{ base?: string, apiBase?: string, useApi?: boolean, fetchImpl?: typeof fetch }} [opts]
 *   `useApi` defaults to true on the public build only: the private hub has no
 *   backend, so asking it would just add a 404 to every showcase link.
 */
export async function loadShowcaseItem(id, opts = {}) {
  if (!id) return null;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  const name = encodeURIComponent(id);
  const useApi = opts.useApi ?? isPublicDistribution();
  if (useApi) {
    const live = await fetchPayload(doFetch, `${opts.apiBase ?? '../api/showcase'}/${name}`);
    if (live) return live;
  }
  return fetchPayload(doFetch, `${opts.base ?? '../_showcase'}/${name}.json`);
}

/**
 * Resolve the showcase item named by the current hash. The hash is left as it
 * is, so the landing view stays a shareable permalink and survives a reload.
 * A bad id (or a build with no showcase, such as the private hub) moves the app
 * to `#/create`: it should not be stranded on a route no view can render.
 *
 * @returns {Promise<{ id: string, item: object } | null>}
 */
export async function resolveShowcaseRoute(opts = {}) {
  const id = showcaseIdFromHash();
  if (!id) return null;
  const item = await loadShowcaseItem(id, opts);
  if (item) return { id, item };
  if (globalThis.location && showcaseIdFromHash() === id) globalThis.location.hash = '#/create';
  return null;
}

/** Where the landing view's back link goes: the item's tile on the site's showcase page. */
export function showcaseBackHref(id) {
  return `../showcase.html${id ? `#${encodeURIComponent(id)}` : ''}`;
}

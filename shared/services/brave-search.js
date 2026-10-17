// Brave Search API client — centralised service shared across all apps.
// Free tier: 2,000 queries/month at https://brave.com/search/api/.
//
// Persistence: API key + proxy URL live at <root>/_suite/api-keys.json
// alongside other cross-app credentials. The synchronous getters below read
// from the in-memory suite-prefs snapshot, which is seeded from localStorage
// at first use (FOUC-free) and overwritten by the disk read on hydrate.

import {
  suite,
  hydrateSuite,
  setSuite,
  getSuiteField,
} from './suite-prefs.js';

const AREA = 'api-keys';
const FIELD_KEY = 'braveKey';
const FIELD_PROXY = 'braveProxy';

const LEGACY = {
  [FIELD_KEY]: 'devtools-hub-brave-search-key',
  [FIELD_PROXY]: 'devtools-hub-brave-search-proxy',
};

const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1/web/search';

// serve.py's local CORS proxy (`/__cors/?<url-encoded url>`). Root-relative, so
// it resolves the same from any app depth. Same wrapping contract corsproxy.io
// used, so callers that build `proxy + encodeURIComponent(url)` are unchanged.
const DEFAULT_PROXY = '/__cors/?';

// corsproxy.io dropped anonymous legacy URLs in 2026 — every keyless request
// now 403s `keyless_legacy_url`. Anyone who saved the old default (or had it
// migrated out of localStorage) is holding a dead proxy, so those exact values
// are read back as "unset" and fall through to DEFAULT_PROXY. A key-bearing
// corsproxy.io URL the user configured themselves is left alone.
const DEAD_PROXIES = new Set([
  'https://corsproxy.io/?',
  'https://corsproxy.io/',
  'https://corsproxy.io?',
  'https://corsproxy.io',
]);

const DEFAULTS = { [FIELD_KEY]: '', [FIELD_PROXY]: DEFAULT_PROXY };

// Seed the suite snapshot from localStorage scratch on import so the sync
// getters return the user's existing values immediately. Then kick off a
// background hydrate that migrates the legacy LS keys onto disk.
suite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY });
hydrateSuite(AREA, { defaults: DEFAULTS, legacyKeys: LEGACY });

// ── API key ──

export function getBraveKey() {
  return getSuiteField(AREA, FIELD_KEY, '') || '';
}

export function saveBraveKey(key) {
  setSuite(AREA, FIELD_KEY, key ? key.trim() : '');
}

export function hasBraveKey() {
  return !!getBraveKey();
}

// ── CORS proxy ──
// Brave Search rejects browser preflight requests (custom header).
// Requests are routed through a CORS proxy. Default: serve.py's own /__cors/,
// which means the hub MUST be served by `python3 serve.py 8084` — a plain
// http.server 404s /__cors/* and every search fails.

export function getBraveProxy() {
  const stored = getSuiteField(AREA, FIELD_PROXY, undefined);
  if (stored === undefined) return DEFAULT_PROXY;
  if (DEAD_PROXIES.has(String(stored).trim())) return DEFAULT_PROXY;
  return stored;
}

/** The built-in default, for settings UI that wants to show or restore it. */
export function getDefaultBraveProxy() {
  return DEFAULT_PROXY;
}

export function saveBraveProxy(proxy) {
  if (proxy === null || proxy === undefined) {
    setSuite(AREA, FIELD_PROXY, '');
  } else {
    setSuite(AREA, FIELD_PROXY, String(proxy).trim());
  }
}

// ── Search ──

/**
 * Search the web via Brave Search API.
 * @param {string} query - Search query
 * @param {number} [count=5] - Number of results (max 20)
 * @returns {Promise<Array<{title: string, url: string, description: string}>>}
 */
export async function search(query, count = 5) {
  const key = getBraveKey();
  if (!key) throw new Error('Brave Search API key not set');
  if (!query || !query.trim()) throw new Error('Search query is empty');

  const params = new URLSearchParams({ q: query.trim(), count: String(count) });
  const targetUrl = `${BRAVE_API_BASE}?${params}`;
  const proxy = getBraveProxy();
  const fetchUrl = proxy ? `${proxy}${encodeURIComponent(targetUrl)}` : targetUrl;

  const resp = await fetch(fetchUrl, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': key,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 404 && proxy === DEFAULT_PROXY) {
      throw new Error(
        'Brave Search failed: the local CORS proxy is missing. Serve the hub with ' +
        '`python3 serve.py 8084` (a plain http.server has no /__cors/ endpoint).'
      );
    }
    throw new Error(`Brave Search failed (${resp.status}): ${text || resp.statusText}`);
  }

  const data = await resp.json();
  const results = (data.web && data.web.results) || [];

  return results.map(r => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
  }));
}

// ── Prompt formatting ──

/**
 * Format search results into a text block suitable for LLM context injection.
 * @param {Array<{title: string, url: string, description: string}>} results
 * @returns {string}
 */
export function formatResultsForPrompt(results) {
  if (!results || results.length === 0) return '';
  const lines = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description}`
  );
  return `Web search results:\n\n${lines.join('\n\n')}`;
}

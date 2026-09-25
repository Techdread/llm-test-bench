// Cloudflare Access verification for the admin API (spec 342, phase 2).
//
// Access sits in front of /admin/ and /api/admin/ and signs every request it
// lets through with a JWT (header Cf-Access-Jwt-Assertion, or the
// CF_Authorization cookie). The edge policy alone is not enough: it covers only
// the hostnames it is configured for, and the *.pages.dev address reaches the
// same Functions. So every admin request is verified here as well —
// signature against the team's published keys, audience, issuer, expiry, and
// the email against ADMIN_EMAILS. Fails closed when any of it is missing.
//
// Env: ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com
//      ACCESS_AUD          the Access application's audience tag
//      ADMIN_EMAILS        comma-separated allowlist

const LEEWAY_SECONDS = 60;
const KEY_TTL_MS = 60 * 60 * 1000;
const keyCache = new Map(); // teamDomain -> { at, keys: Map(kid -> CryptoKey) }

export class AccessError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

/** https://<team>.cloudflareaccess.com, or a loopback issuer for local testing. */
export function normalizeTeamDomain(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(text)) return text.toLowerCase();
  // tools/public-mvp-dev.mjs plays Access on loopback; no public host can.
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(text)) return text;
  return '';
}

export function adminEmails(value) {
  return new Set(String(value || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
}

function base64UrlBytes(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const decodeJson = (part) => JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));

async function signingKeys(teamDomain, fetchImpl, now) {
  const cached = keyCache.get(teamDomain);
  if (cached && now - cached.at < KEY_TTL_MS) return cached.keys;
  const res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AccessError(503, `could not fetch Access signing keys (HTTP ${res.status})`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache.set(teamDomain, { at: now, keys: map });
  return map;
}

/** Clears cached signing keys (tests; key rotation is handled by the TTL). */
export function resetAccessKeyCache() { keyCache.clear(); }

/**
 * Verify an Access JWT. Returns { email } or throws AccessError.
 * @param {string} token
 * @param {{ teamDomain: string, aud: string, fetchImpl?: typeof fetch, nowSeconds?: number }} opts
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetchImpl = fetch, nowSeconds = Date.now() / 1000 }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AccessError(401, 'missing or malformed Access token');
  let header, claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw new AccessError(401, 'malformed Access token');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new AccessError(401, 'unexpected token algorithm');

  let key = (await signingKeys(teamDomain, fetchImpl, nowSeconds * 1000)).get(header.kid);
  if (!key) {
    // Access rotates keys; refetch once before rejecting an unknown kid.
    keyCache.delete(teamDomain);
    key = (await signingKeys(teamDomain, fetchImpl, nowSeconds * 1000)).get(header.kid);
  }
  if (!key) throw new AccessError(401, 'token signed by an unknown key');

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(parts[2]), signed);
  if (!valid) throw new AccessError(401, 'bad token signature');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) throw new AccessError(401, 'token is for a different Access application');
  if (claims.iss !== teamDomain) throw new AccessError(401, 'token from a different issuer');
  if (typeof claims.exp !== 'number' || claims.exp < nowSeconds - LEEWAY_SECONDS) throw new AccessError(401, 'token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + LEEWAY_SECONDS) throw new AccessError(401, 'token not yet valid');
  if (typeof claims.email !== 'string' || !claims.email) throw new AccessError(401, 'token has no email');
  return { email: claims.email.toLowerCase() };
}

function tokenFrom(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Authorise one admin request. Returns { email }.
 * Writes must also carry X-Admin-Request: 1 and, when the browser sends an
 * Origin, come from this site: a cross-site form cannot set either.
 */
export async function authorizeAdmin(request, env, { fetchImpl = fetch, nowSeconds } = {}) {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const allowed = adminEmails(env.ADMIN_EMAILS);
  if (!teamDomain || !env.ACCESS_AUD || !allowed.size) throw new AccessError(503, 'admin is not configured');

  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get('X-Admin-Request') !== '1') throw new AccessError(403, 'missing X-Admin-Request header');
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw new AccessError(403, 'cross-origin admin request');
  }

  const { email } = await verifyAccessJwt(tokenFrom(request), { teamDomain, aud: env.ACCESS_AUD, fetchImpl, nowSeconds });
  if (!allowed.has(email)) throw new AccessError(403, `${email} is not an admin`);
  return { email };
}

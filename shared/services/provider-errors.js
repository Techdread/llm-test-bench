// Structured provider errors (spec 343).
//
// Adapters used to throw `new Error('HTTP 429')`, which loses the two things a
// rate-limited build needs to carry on: the status, and when the limit lifts.
// These helpers attach them to the SAME Error the adapter already throws — the
// message is unchanged, so every existing caller reads exactly what it did.
//
//   error.status    HTTP status
//   error.headers   the limit-related response headers, lower-cased
//   error.metadata  the provider's error metadata (OpenRouter puts its
//                   X-RateLimit-* headers here)

const LIMIT_HEADER = /^(?:retry-after|x-ratelimit-[a-z-]+|ratelimit-[a-z-]+|anthropic-ratelimit-[a-z-]+)$/i;

/** The limit-related headers of a fetch Response, as a plain object. */
export function limitHeaders(res) {
  const out = {};
  try {
    res?.headers?.forEach?.((value, name) => { if (LIMIT_HEADER.test(name)) out[name.toLowerCase()] = value; });
  } catch { /* opaque or absent headers */ }
  return out;
}

/** Read an error body once, returning `{ message, metadata, body }`. */
export async function readErrorBody(res) {
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const message = body?.error?.message || body?.message || null;
  return { message, metadata: body?.error?.metadata || null, body };
}

/** Attach status / limit headers / metadata to an Error and return it. */
export function withHttpDetails(error, res, { metadata = null } = {}) {
  if (!error || !res) return error;
  try {
    error.status = res.status;
    error.headers = limitHeaders(res);
    if (metadata) error.metadata = metadata;
  } catch { /* frozen error: details are best-effort */ }
  return error;
}

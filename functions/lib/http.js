// Small response helpers shared by the Pages Functions.

export function json(body, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// Bindings missing (a plain static deploy, or a preview without D1/R2): answer
// 503 so the site falls back to the showcase baked into the build.
export function notConfigured() {
  return json({ error: 'showcase backend not configured' }, { status: 503 });
}

export const notFound = () => json({ error: 'not found' }, { status: 404 });

export function serverError(error) {
  console.error('[showcase]', error?.stack || error);
  return json({ error: 'showcase backend error' }, { status: 500 });
}

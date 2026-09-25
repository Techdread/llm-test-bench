// Publish checks for showcase items (spec 342). One implementation, used by the
// admin Functions (enforced server-side), the admin console (shown before
// publishing), tools/build-public-mvp.mjs and tools/showcase-seed.mjs.

// A generation saved inside the hub can point at /shared/lib/... or ../; the
// public site does not ship those files, so the example would open broken.
const HUB_PATH = /(?:\bsrc|\bhref)=["'](\/(?!\/)[^"']*|\.\.\/[^"']*)["']|\bfrom\s+["'](\/(?!\/)[^"']*|\.\.\/[^"']*)["']/;

/** The first hub-only path the code loads, or '' when it is portable. */
export function hubOnlyPath(code) {
  const match = String(code || '').match(HUB_PATH);
  return match ? (match[1] || match[2]) : '';
}

/** Third-party hosts the code reaches at view time (disclosed to visitors). */
export function cdnHosts(code) {
  return [...new Set((String(code || '').match(/https?:\/\/([^/\s"'<>()]+)/g) || [])
    .map(url => url.replace(/^https?:\/\//, '').toLowerCase())
    .filter(host => !host.includes('w3.org')))];
}

/** Structural sanity per kind: an HTML page, an SVG document, or p5 source. */
export function shapeProblem(code, kind) {
  const text = String(code || '').trimStart();
  if (!text) return 'empty file';
  if (kind === 'html' && !/^<!doctype html|^<html/i.test(text)) return 'does not start with <!doctype html> or <html>';
  if (kind === 'svg' && !/^<(\?xml|svg)/i.test(text)) return 'does not start with <svg> or <?xml';
  if (/```/.test(text.slice(0, 4000))) return 'contains a markdown code fence (a chat reply, not a file)';
  return '';
}

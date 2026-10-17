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

/** Structural sanity per kind: an HTML page, an SVG document, p5 source, or a forge project bundle. */
export function shapeProblem(code, kind) {
  const text = String(code || '').trimStart();
  if (!text) return 'empty file';
  if (kind === 'html' && !/^<!doctype html|^<html/i.test(text)) return 'does not start with <!doctype html> or <html>';
  if (kind === 'svg' && !/^<(\?xml|svg)/i.test(text)) return 'does not start with <svg> or <?xml';
  if (kind === 'project') return parseProjectBundle(text).problem || '';
  if (/```/.test(text.slice(0, 4000))) return 'contains a markdown code fence (a chat reply, not a file)';
  return '';
}

// ── Forge projects (Game Forge, VR Forge) ──────────────────────────────────
//
// A forge run is a folder of files, so it is published as one JSON bundle:
//   { format: 'forge-project', version: 1, app, entry,
//     files: [{ path, type, text } | { path, type, base64 } | { path, type, sha256, vendored: true, bytes }] }
// `vendored` files are pinned project libraries (three.js, Phaser, ...) that
// the public site already ships under shared/lib/, matched by SHA-256 and
// fetched from there at play time instead of being stored again per item.

export const PROJECT_FORMAT = 'forge-project';

const TEXT_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'svg', 'txt', 'csv', 'xml', 'gltf']);
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'wav', 'mp3', 'ogg', 'm4a',
  'woff', 'woff2', 'ttf', 'otf', 'wasm', 'glb', 'bin']);
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', '__tests__']);
const SKIP_FILES = new Set(['package.json', 'package-lock.json']);

const extOf = (p) => (String(p).split('/').pop().split('.').length > 1 ? String(p).split('.').pop().toLowerCase() : '');

export const isTextPath = (p) => TEXT_EXT.has(extOf(p));

/**
 * '' when a project file belongs in a published bundle, otherwise the reason it
 * is left out. Agents leave scratch behind in their project folders (browser
 * profiles, screenshots of their own checks, node test scripts, even dot-folders
 * named after cloud CLIs), so only web runtime files are published.
 */
export function projectFileRule(path) {
  const parts = String(path || '').split('/');
  if (!path || parts.some(p => !p || p === '.' || p === '..')) return 'not a plain relative path';
  if (parts.some(p => p.startsWith('.'))) return 'hidden file or folder';
  if (parts.slice(0, -1).some(p => SKIP_DIRS.has(p))) return 'test or dependency folder';
  const name = parts[parts.length - 1];
  if (SKIP_FILES.has(name)) return 'package metadata';
  if (/\.(test|spec)\.m?js$/i.test(name)) return 'test file';
  const ext = extOf(name);
  if (!TEXT_EXT.has(ext) && !ASSET_EXT.has(ext)) return ext ? `.${ext} is not a web runtime file` : 'no file extension';
  return '';
}

const resolveIn = (fromPath, ref) => {
  const stack = String(fromPath).split('/').slice(0, -1);
  for (const part of ref.split(/[?#]/)[0].split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!stack.length) return null; stack.pop(); } else stack.push(part);
  }
  return stack.join('/');
};

const PROJECT_REF = /(?:\b(?:src|href)=["']([^"']+)["']|\b(?:from|import)\s*\(?\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\))/g;

/** First reference that leaves the project (absolute path or ../ above its root). */
export function projectHubPath(bundle) {
  for (const file of bundle.files || []) {
    if (typeof file.text !== 'string' || !/\.(html?|m?js|css)$/i.test(file.path)) continue;
    for (const m of file.text.matchAll(PROJECT_REF)) {
      const ref = m[1] || m[2] || m[3];
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\$\{)/i.test(ref)) continue;
      if (ref.startsWith('/') || resolveIn(file.path, ref) === null) return `${ref} (in ${file.path})`;
    }
  }
  return '';
}

// Paths and addresses that identify the machine a run was built on.
const PRIVATE_TRACE = /\/home\/[a-z_][\w.-]*\/|\/media\/[a-z_][\w.-]*\/|\/Users\/[\w.-]+\/|[A-Z]:\\Users\\|\b192\.168\.\d{1,3}\.\d{1,3}\b/;

/** First file that carries a home path or LAN address, as "path: match". */
export function projectPrivateTrace(bundle) {
  for (const file of bundle.files || []) {
    const m = typeof file.text === 'string' && file.text.match(PRIVATE_TRACE);
    if (m) return `${file.path}: ${m[0]}`;
  }
  return '';
}

export function projectCdnHosts(bundle) {
  return [...new Set((bundle.files || []).flatMap(f => (typeof f.text === 'string' ? cdnHosts(f.text) : [])))];
}

/** Parse and structurally check a bundle. Returns { bundle } or { problem }. */
export function parseProjectBundle(text) {
  let bundle;
  try { bundle = JSON.parse(String(text || '')); } catch { return { problem: 'not valid JSON' }; }
  if (!bundle || bundle.format !== PROJECT_FORMAT || bundle.version !== 1) return { problem: `not a ${PROJECT_FORMAT} v1 bundle` };
  if (!Array.isArray(bundle.files) || !bundle.files.length) return { problem: 'has no files' };
  const seen = new Set();
  for (const file of bundle.files) {
    const why = projectFileRule(file?.path);
    if (why) return { problem: `${file?.path || '(unnamed)'}: ${why}` };
    if (seen.has(file.path)) return { problem: `${file.path} appears twice` };
    seen.add(file.path);
    const forms = ['text', 'base64', 'vendored'].filter(k => file[k] !== undefined);
    if (forms.length !== 1) return { problem: `${file.path} must have exactly one of text, base64 or vendored` };
    if (file.vendored !== undefined && !/^[0-9a-f]{64}$/.test(String(file.sha256 || ''))) return { problem: `${file.path} names no library hash` };
    if (file.base64 !== undefined && !/^[A-Za-z0-9+/]*={0,2}$/.test(String(file.base64))) return { problem: `${file.path} is not base64` };
  }
  if (!/\.html?$/i.test(String(bundle.entry || '')) || !seen.has(bundle.entry)) return { problem: 'its entry page is missing' };
  return { bundle };
}

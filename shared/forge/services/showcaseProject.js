// Showcase forge projects (spec 342 extension): a published Game Forge / VR
// Forge run, replayed on the public site.
//
// A run is a folder of files. The admin console publishes it as one JSON
// bundle (format in public-mvp/functions/lib/showcase-checks.js); pinned
// project libraries are left out of the bundle and fetched from this site's
// own shared/lib copy, matched by SHA-256.
//
// Playing it safely: the game is model-written, so it must not run at this
// site's origin, where visitors keep their API keys. It runs in a
// `sandbox="allow-scripts"` srcdoc frame (an opaque origin). Blob URLs made by
// the parent cannot be loaded from an opaque origin, so the frame builds the
// preview itself: it receives the files, imports the shared previewer, and
// document.write()s the rewritten entry page. Blob URLs it creates are its
// own, so every module, script and asset resolves.

import { PROJECT_LIBRARIES, sha256HexFromBytes } from './projectLibraries.js';

export const PROJECT_FORMAT = 'forge-project';

const LIBRARY_MODULE = new URL('./projectLibraries.js', import.meta.url);
const PREVIEWER_MODULE = new URL('./previewer.js', import.meta.url);

/** sha256 -> absolute URL of the pinned library file on this site. */
export function vendoredLibraryIndex(base = LIBRARY_MODULE) {
  const index = new Map();
  for (const library of Object.values(PROJECT_LIBRARIES)) {
    for (const file of library.files) {
      if (file.sha256) index.set(file.sha256, { url: new URL(file.sourceUrl, base).href, library: library.id, bytes: file.bytes });
    }
  }
  return index;
}

const MIME = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml',
  gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  m4a: 'audio/mp4', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', glb: 'model/gltf-binary', bin: 'application/octet-stream',
};
export const mimeFor = (path) => MIME[String(path).split('.').pop().toLowerCase()] || 'application/octet-stream';

/** The page a project opens on: forge-project.json's entry, else index.html, else the shallowest page. */
export function projectEntry(paths, manifestText = '') {
  let declared = '';
  try { declared = String(JSON.parse(manifestText || '{}')?.entry || ''); } catch { /* no manifest */ }
  if (declared && paths.includes(declared)) return declared;
  if (paths.includes('index.html')) return 'index.html';
  return paths.filter(p => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || '';
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Bundle a project's files for publishing.
 * @param {{ path: string, bytes: Uint8Array }[]} files   already filtered by projectFileRule
 * @param {{ app: string, isText: (path) => boolean, canVendor?: (sha256) => Promise<boolean> }} options
 *   `canVendor` says whether this site serves the pinned library with that hash.
 */
export async function bundleProject(files, { app, isText, canVendor = async () => false }) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const out = [];
  let vendoredCount = 0;
  for (const { path, bytes } of files) {
    const type = mimeFor(path);
    const sha256 = await sha256HexFromBytes(bytes);
    if (await canVendor(sha256)) {
      out.push({ path, type, vendored: true, sha256, bytes: bytes.length });
      vendoredCount++;
      continue;
    }
    let text = null;
    if (isText(path)) { try { text = decoder.decode(bytes); } catch { /* not UTF-8: keep the bytes */ } }
    out.push(text === null ? { path, type, base64: toBase64(bytes) } : { path, type, text });
  }
  const paths = out.map(f => f.path);
  const manifest = out.find(f => f.path === 'forge-project.json')?.text || '';
  const bundle = { format: PROJECT_FORMAT, version: 1, app, entry: projectEntry(paths, manifest), files: out };
  return { bundle, text: JSON.stringify(bundle), vendoredCount };
}

export function parseBundle(text) {
  const bundle = JSON.parse(String(text || ''));
  if (bundle?.format !== PROJECT_FORMAT || !Array.isArray(bundle.files)) throw new Error('Not a forge project bundle.');
  return bundle;
}

/**
 * Turn a bundle into transferable file records for the runner frame, fetching
 * vendored libraries from this site and checking their hashes.
 */
export async function resolveBundleFiles(bundle, { fetchImpl = globalThis.fetch, index = vendoredLibraryIndex() } = {}) {
  const fetched = new Map();
  const files = [];
  for (const file of bundle.files) {
    let data;
    if (typeof file.text === 'string') data = file.text;
    else if (typeof file.base64 === 'string') data = fromBase64(file.base64).buffer;
    else if (file.vendored) {
      const source = index.get(file.sha256);
      if (!source) throw new Error(`${file.path} needs a library this site does not ship.`);
      if (!fetched.has(file.sha256)) {
        fetched.set(file.sha256, (async () => {
          const res = await fetchImpl(source.url);
          if (!res.ok) throw new Error(`Could not load ${source.library} (${res.status}).`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (await sha256HexFromBytes(bytes) !== file.sha256) throw new Error(`${source.library} did not match its pinned hash.`);
          return bytes;
        })());
      }
      data = (await fetched.get(file.sha256)).slice().buffer;
    } else {
      throw new Error(`${file.path} has no content.`);
    }
    files.push({ path: file.path, type: file.type || mimeFor(file.path), data });
  }
  return files;
}

let previewerSource = null;
/** The previewer's source, handed to the runner frame (it cannot import from this origin). */
export function loadPreviewerSource(fetchImpl = globalThis.fetch) {
  previewerSource ||= fetchImpl(PREVIEWER_MODULE.href).then(res => {
    if (!res.ok) throw new Error(`Could not load the previewer (${res.status}).`);
    return res.text();
  }).catch(error => { previewerSource = null; throw error; });
  return previewerSource;
}

/**
 * The runner frame's document. It announces itself, waits for one `run`
 * message from its parent, builds the preview and replaces itself with it.
 */
export function runnerSrcdoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#05070c;color:#9aa4b8;font:14px system-ui,sans-serif}body{display:grid;place-items:center}</style></head><body><p>Loading…</p><script>
(() => {
  const say = (m) => parent.postMessage(m, '*');
  addEventListener('message', async (e) => {
    if (e.source !== parent || !e.data || e.data.type !== 'forge-showcase-run') return;
    try {
      const { files, entry, previewer, bootstrap, token } = e.data;
      const map = new Map(files.map(f => [f.path, new File([f.data], f.path.split('/').pop(), { type: f.type, lastModified: 0 })]));
      const mod = await import(URL.createObjectURL(new Blob([previewer], { type: 'text/javascript' })));
      const built = await mod.buildPreview(null, { files: map, entry, bootstrap, diagnosticsToken: token });
      if (!built.ok) throw new Error(built.reason || 'no page to open');
      const page = await (await fetch(built.url)).text();
      say({ type: 'forge-showcase-started', entry: built.entry });
      document.open(); document.write(page); document.close();
    } catch (error) {
      document.body.textContent = 'Could not start this project: ' + (error && error.message || error);
      say({ type: 'forge-showcase-error', message: String(error && error.message || error) });
    }
  });
  say({ type: 'forge-showcase-ready' });
})();
<\/script></body></html>`;
}

/**
 * Drive one runner frame: wait for it to announce itself, then send the
 * project. Resolves when the game page has been written into the frame.
 * `onDiagnostic` receives the previewer's diagnostics (errors, failed loads).
 */
export function startRunner(iframe, { files, entry, previewer, bootstrap = [], onDiagnostic = () => {} }) {
  const token = `showcase-${Math.random().toString(36).slice(2)}`;
  let stop;
  const started = new Promise((resolve, reject) => {
    const onMessage = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data || {};
      if (data.__gameForgeDiagnostic === token) { onDiagnostic(data); return; }
      if (data.type === 'forge-showcase-ready') {
        // Copied, not transferred: Restart sends the same files again.
        iframe.contentWindow.postMessage({ type: 'forge-showcase-run', files, entry, previewer, bootstrap, token }, '*');
      } else if (data.type === 'forge-showcase-started') resolve(data);
      else if (data.type === 'forge-showcase-error') reject(new Error(data.message));
    };
    addEventListener('message', onMessage);
    stop = () => removeEventListener('message', onMessage);
  });
  return { started, stop };
}

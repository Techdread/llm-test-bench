// Multi-file web previewer — the shared Forge preview engine. Reads a built
// project directory and boots it in an iframe without a server, by turning
// every file into a blob URL and rewriting the entry HTML's relative
// references (and CSS url()s) to point at those blobs.
//
// Static ES-module imports are rewritten recursively when the module graph is
// acyclic. Runtime fetch(), workers, import.meta asset URLs and cyclic module
// graphs still require serving the exported project from a local web server.

const MIME = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain', wasm: 'application/wasm',
};

const ext = (p) => (p.split('.').pop() || '').toLowerCase();
const isExternal = (ref) => /^(https?:|data:|blob:|#|mailto:|javascript:)/i.test(ref || '');

function resolvePath(baseDir, ref) {
  const clean = ref.split(/[?#]/)[0];
  const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/** Pure static-module rewriter used by the blob preview and unit tests. */
export function rewriteModuleSpecifiers(source, path, resolveUrl) {
  const baseDir = dirOf(path);
  const rewrite = (match, prefix, quote, ref, suffix = '') => {
    if (isExternal(ref) || !ref.startsWith('.')) return match;
    const target = resolvePath(baseDir, ref);
    const url = resolveUrl(target, ref);
    return url ? `${prefix}${quote}${url}${quote}${suffix}` : match;
  };
  return String(source || '')
    // The clause before `from` is a BOUNDED negated class, not `(?:[^'"]|\n)*?`:
    // that alternation matches every newline two ways, so an `export function`
    // whose body contains no quote at all backtracks exponentially and hangs
    // the thread for minutes. `[^'"]` already matches newlines.
    .replace(/(\b(?:import|export)\s+(?:[^'"]{0,400}?\sfrom\s*)?)(['"])([^'"]+)\2()/g, rewrite)
    .replace(/(\bimport\s*\(\s*)(['"])([^'"]+)\2(\s*\))/g, rewrite);
}

/**
 * Rewrite an import map's targets to preview URLs.
 *
 * Exact mappings are resolved one by one. A *prefix* mapping ("three/addons/":
 * "./lib/three/examples/jsm/") has no single file to point at, so it is
 * EXPANDED against the project's own file list into one exact entry per file —
 * otherwise the idiomatic three.js add-on import resolves to nothing inside a
 * blob document, and a project that works in the headset appears broken here.
 *
 * @param {string} source            the import map's JSON text
 * @param {Function} resolveTarget   (ref) => url | null
 * @param {Function} [listUnder]     (projectPrefix) => string[] of project paths
 */
export function rewriteImportMap(source, resolveTarget, listUnder = () => []) {
  let map;
  try { map = JSON.parse(source || '{}'); } catch { return source; }

  const rewriteScope = (imports) => {
    if (!imports || typeof imports !== 'object') return {};
    const out = {};
    for (const [specifier, ref] of Object.entries(imports)) {
      if (typeof ref !== 'string') continue;
      if (specifier.endsWith('/') && ref.endsWith('/')) {
        const prefix = ref.replace(/^\.\//, '').replace(/^\/+/, '');
        for (const path of listUnder(prefix)) {
          const url = resolveTarget(`./${path}`);
          if (url) out[specifier + path.slice(prefix.length)] = url;
        }
        continue;
      }
      const url = resolveTarget(ref);
      if (url) out[specifier] = url;
    }
    return out;
  };

  const next = { imports: rewriteScope(map.imports) };
  if (map.scopes && typeof map.scopes === 'object') {
    const scopes = {};
    for (const [scope, imports] of Object.entries(map.scopes)) {
      const rewritten = rewriteScope(imports);
      if (Object.keys(rewritten).length) scopes[scope] = rewritten;
    }
    if (Object.keys(scopes).length) next.scopes = scopes;
  }
  return JSON.stringify(next, null, 2);
}

/** Walk a project directory handle into a Map<path, File>. */
export async function readProjectTree(dirHandle, { ignore = ['forge.json'] } = {}) {
  const files = new Map();
  const ignoreSet = new Set(ignore);
  async function walk(dir, prefix) {
    for await (const [name, handle] of dir.entries()) {
      if (prefix === '' && ignoreSet.has(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle, rel);
      else { try { files.set(rel, await handle.getFile()); } catch { /* skip */ } }
    }
  }
  await walk(dirHandle, '');
  return files;
}

function pickEntry(paths, preferredEntry = null) {
  if (preferredEntry && paths.includes(preferredEntry)) return preferredEntry;
  if (paths.includes('index.html')) return 'index.html';
  const htmls = paths.filter(p => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length);
  return htmls[0] || null;
}

/**
 * Build a runnable preview from a project directory handle.
 * @returns {Promise<{ ok, url?, entry?, fileList, reason? }>}
 */
/**
 * A cheap fingerprint of a project tree: which files exist, how big they are,
 * and when they were last written.
 *
 * Rebuilding the preview costs a few milliseconds, but swapping the iframe
 * re-executes the game — during a live build that happens on every file event.
 * Comparing signatures lets a caller skip the reboot when nothing changed.
 */
export function projectSignature(files) {
  return [...files.entries()]
    .map(([path, file]) => `${path}:${file.size}:${file.lastModified}`)
    .sort()
    .join('|');
}

export async function buildPreview(dirHandle, {
  diagnosticsToken = null, entry: preferredEntry = null, files: prereadFiles = null,
  // Classic scripts injected ahead of everything the project loads. A caller
  // that must install something into the project's own window before its code
  // runs — VR Forge's emulated WebXR runtime and its probe (spec 334) — passes
  // the sources here rather than editing the project.
  bootstrap = [],
} = {}) {
  // A caller that already walked the tree (to compare signatures) passes it in
  // rather than paying for a second walk.
  const files = prereadFiles || await readProjectTree(dirHandle);
  const paths = [...files.keys()];
  const fileList = paths.slice().sort();
  const entry = pickEntry(paths, preferredEntry);
  if (!entry) return { ok: false, reason: 'no-html-entry', fileList };

  const urls = [];
  const mkUrl = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
  const blobCache = new Map();
  const moduleCache = new Map();
  const moduleStack = new Set();

  // Text contents for files we may rewrite.
  const textOf = new Map();
  for (const [p, f] of files) {
    const e = ext(p);
    if (['css', 'js', 'mjs', 'html', 'htm', 'json', 'svg', 'txt'].includes(e)) textOf.set(p, await f.text());
  }

  // Blob URL for a project file, rewriting CSS url()s inside CSS files.
  function urlForFile(path) {
    if (blobCache.has(path)) return blobCache.get(path);
    if (!files.has(path)) return null;
    const e = ext(path);
    const type = MIME[e] || 'application/octet-stream';
    let url;
    if (e === 'css') {
      url = mkUrl(new Blob([rewriteCss(textOf.get(path) || '', dirOf(path))], { type }));
    } else if (textOf.has(path) && e !== 'js' && e !== 'mjs' && e !== 'html' && e !== 'htm') {
      url = mkUrl(new Blob([textOf.get(path)], { type }));
    } else {
      url = mkUrl(new Blob([files.get(path)], { type }));
    }
    blobCache.set(path, url);
    return url;
  }

  function rewriteCss(cssText, baseDir) {
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
      if (isExternal(ref)) return m;
      const target = resolvePath(baseDir, ref);
      const u = urlForFile(target);
      return u ? `url(${u})` : m;
    });
  }

  function rewriteModuleSource(source, path) {
    return rewriteModuleSpecifiers(source, path, (target) => {
      if (!files.has(target)) return null;
      return urlForModule(target);
    });
  }

  function urlForModule(path) {
    if (moduleCache.has(path)) return moduleCache.get(path);
    if (moduleStack.has(path)) {
      throw new Error(`Cyclic ES-module preview graph at ${path}; serve the exported project locally.`);
    }
    if (!files.has(path) || !textOf.has(path)) return urlForFile(path);
    moduleStack.add(path);
    try {
      const source = rewriteModuleSource(textOf.get(path), path);
      const url = mkUrl(new Blob([source], { type: 'text/javascript' }));
      moduleCache.set(path, url);
      return url;
    } finally {
      moduleStack.delete(path);
    }
  }

  // Rewrite the entry HTML.
  const baseDir = dirOf(entry);
  const doc = new DOMParser().parseFromString(textOf.get(entry) || '', 'text/html');

  // Diagnostics are injected before generated scripts, so startup exceptions,
  // rejected promises, failed resource loads, and console errors are evidence
  // in the validation report rather than invisible iframe failures.
  if (diagnosticsToken) {
    const diagnosticScript = doc.createElement('script');
    diagnosticScript.textContent = diagnosticBootstrap(diagnosticsToken);
    (doc.head || doc.documentElement).prepend(diagnosticScript);
  }

  // Bootstrap scripts run before the diagnostics listener and before every
  // project script, in the order given. Blob URLs rather than inline text, so a
  // large runtime does not have to survive HTML serialization.
  for (const source of [...bootstrap].reverse()) {
    if (!source) continue;
    const el = doc.createElement('script');
    el.src = mkUrl(new Blob([source], { type: 'text/javascript' }));
    (doc.head || doc.documentElement).prepend(el);
  }

  // Import maps: a bare specifier is resolved against the map, so unless the
  // map's targets become blob URLs too, every project that uses one (the
  // idiomatic way to load three.js add-ons) loads in a headset and fails here.
  doc.querySelectorAll('script[type="importmap"]').forEach((el) => {
    el.textContent = rewriteImportMap(el.textContent || '', (ref) => {
      if (isExternal(ref)) return null;
      const target = resolvePath(baseDir, ref);
      if (!files.has(target)) return null;
      return /\.(?:m?js)$/i.test(target) ? urlForModule(target) : urlForFile(target);
    }, prefix => [...files.keys()].filter(path => path.startsWith(prefix)));
  });

  const attrTargets = [
    ['script[src]', 'src'], ['link[href]', 'href'], ['img[src]', 'src'],
    ['audio[src]', 'src'], ['source[src]', 'src'], ['[data-src]', 'data-src'],
  ];
  for (const [sel, attr] of attrTargets) {
    doc.querySelectorAll(sel).forEach((el) => {
      const ref = el.getAttribute(attr);
      if (!ref || isExternal(ref)) return;
      const target = resolvePath(baseDir, ref);
      const u = el.matches('script[type="module"]')
        ? urlForModule(target)
        : urlForFile(target);
      if (u) el.setAttribute(attr, u);
    });
  }
  doc.querySelectorAll('script[type="module"]:not([src])').forEach((el) => {
    el.textContent = rewriteModuleSource(el.textContent || '', entry);
  });
  // Inline <style> url()s.
  doc.querySelectorAll('style').forEach((el) => { el.textContent = rewriteCss(el.textContent || '', baseDir); });

  const htmlOut = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  const url = mkUrl(new Blob([htmlOut], { type: 'text/html' }));
  return { ok: true, url, entry, fileList, revoke: () => urls.forEach(u => URL.revokeObjectURL(u)) };
}

function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }

function diagnosticBootstrap(token) {
  const safeToken = JSON.stringify(String(token));
  return `(() => {
    const token = ${safeToken};
    const send = (kind, value = {}) => {
      try { parent.postMessage({ __gameForgeDiagnostic: token, kind, ...value }, '*'); } catch {}
    };
    const describe = (value) => {
      if (value instanceof Error) return value.stack || value.message || String(value);
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    };
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      send('console-error', { message: args.map(describe).join(' ') });
      originalError(...args);
    };
    addEventListener('error', (event) => {
      const target = event.target;
      if (target && target !== window) {
        send('resource-error', {
          message: 'Failed to load ' + (target.src || target.href || target.currentSrc || target.tagName || 'resource'),
          resource: target.src || target.href || target.currentSrc || null,
        });
      } else {
        send('error', {
          message: event.message || describe(event.error),
          filename: event.filename || null,
          line: event.lineno || null,
          column: event.colno || null,
        });
      }
    }, true);
    addEventListener('unhandledrejection', (event) => {
      send('unhandledrejection', { message: describe(event.reason) });
    });
    addEventListener('load', () => {
      requestAnimationFrame(() => setTimeout(() => {
        const root = document.documentElement;
        const body = document.body;
        send('dimensions', { value: {
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0),
          documentHeight: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0),
          canvasCount: document.querySelectorAll('canvas').length,
          elementCount: document.querySelectorAll('*').length,
        }});
      }, 250));
    }, { once: true });
  })();`;
}

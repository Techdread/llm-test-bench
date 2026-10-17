// Structure and desktop-lane checks shared by VR Forge's validator.
// The XR lane and the assembled report live in services/vrValidator.js.
import { readProjectTree } from './previewer.js';
import { buildProjectPreview } from './previewAdapters.js';
import { isVendoredLibraryPath } from './projectLibraries.js';

const TEXT_EXT = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md']);
const REF_ATTR_RE = /\b(?:src|href|data-src|poster)\s*=\s*(["'])(.*?)\1/gi;
const CSS_URL_RE = /url\(\s*(["']?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(["'])(.*?)\1\s*\)?/gi;
const JS_IMPORT_RE = /\b(?:import\s*(?:[^'"]*?\sfrom\s*)?|import\s*\(|export\s+(?:[^'"]*?\sfrom\s*))\s*(["'])(.*?)\1/gi;
const WORKER_RE = /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(["'])(.*?)\1/gi;
const FETCH_RE = /\bfetch\s*\(\s*(["'])(.*?)\1/gi;
const EXTERNAL_RE = /^(?:https?:)?\/\//i;
const IGNORE_RE = /^(?:data:|blob:|#|mailto:|tel:|javascript:|about:)/i;
const CLEAR_RECT_RE = /\bclearRect\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/gi;

const extension = (path) => (String(path).split('.').pop() || '').toLowerCase();
const directory = (path) => {
  const i = String(path).lastIndexOf('/');
  return i < 0 ? '' : String(path).slice(0, i);
};

export function resolveProjectPath(baseDir, ref) {
  const clean = String(ref || '').split(/[?#]/)[0].replace(/^\/+/, '');
  const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function addRefs(text, regex, kind, out) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text))) out.push({ ref: match[2], kind });
}

function referencesFor(path, text) {
  const refs = [];
  const ext = extension(path);
  if (ext === 'html' || ext === 'htm') addRefs(text, REF_ATTR_RE, 'html', refs);
  if (ext === 'css' || ext === 'html' || ext === 'htm' || ext === 'svg') {
    addRefs(text, CSS_URL_RE, 'css-url', refs);
    addRefs(text, CSS_IMPORT_RE, 'css-import', refs);
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'html' || ext === 'htm') {
    addRefs(text, JS_IMPORT_RE, 'module-import', refs);
    addRefs(text, WORKER_RE, 'worker', refs);
    addRefs(text, FETCH_RE, 'runtime-fetch', refs);
  }
  return refs;
}

function issue(severity, code, message, detail = {}) {
  return { severity, code, message, ...detail };
}

function canvasIssues(path, text) {
  const issues = [];
  CLEAR_RECT_RE.lastIndex = 0;
  let match;
  while ((match = CLEAR_RECT_RE.exec(text))) {
    const width = match[3].trim();
    const height = match[4].trim();
    if (width === '0' || height === '0') {
      issues.push(issue(
        'warning',
        'canvas_clear_zero_dimension',
        `${path} calls clearRect with a zero ${width === '0' ? 'width' : 'height'}; animated sprites may leave trails.`,
        { path },
      ));
    }
  }
  return issues;
}

/**
 * Pure structural validation. `files` is Map<path,{text?,size?,type?}>.
 */
// The hub's own service endpoints, which a VR project may call at runtime when
// its brief and manifest declare them (spec 334). They are same-origin absolute
// paths, so without this they would look like references to missing files.
const HUB_ENDPOINT_RE = /^\/__(?:ask|agent|wan2gp|quest)(?:\/|$)/;

export function isHubServiceRef(value) {
  return HUB_ENDPOINT_RE.test(String(value || '').trim());
}

export function validateWebStructure(files, { offline = true, hubServices = [] } = {}) {
  const paths = [...files.keys()].sort();
  const issues = [];
  const entry = paths.includes('index.html')
    ? 'index.html'
    : paths.filter(p => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length)[0] || null;

  if (!entry) {
    issues.push(issue('error', 'missing_entry', 'No HTML entry file exists.'));
  } else if (entry !== 'index.html') {
    issues.push(issue('warning', 'nonstandard_entry', `Using ${entry}; web projects should provide root index.html.`, { path: entry }));
  }

  let checkedReferences = 0;
  let externalReferences = 0;
  const hubReferences = [];
  for (const [path, record] of files) {
    if (typeof record?.text !== 'string') continue;
    if (['html', 'htm', 'js', 'mjs'].includes(extension(path))) {
      issues.push(...canvasIssues(path, record.text));
    }
    for (const { ref, kind } of referencesFor(path, record.text)) {
      const value = String(ref || '').trim();
      if (!value || IGNORE_RE.test(value)) continue;
      checkedReferences++;
      if (EXTERNAL_RE.test(value)) {
        externalReferences++;
        if (offline) issues.push(issue('warning', 'external_dependency', `Offline project references ${value}`, { path, ref: value, kind }));
        continue;
      }
      if (isHubServiceRef(value)) {
        // Calling the hub is legitimate, but only deliberately: a project that
        // reaches for a service its brief never asked for is a surprise
        // dependency, and one that does not run outside this hub at all.
        hubReferences.push({ path, ref: value, kind });
        if (!hubServices.length) {
          issues.push(issue('error', 'hub_service_undeclared',
            `${path} calls the hub service ${value}, but this brief did not ask for hub services.`,
            { path, ref: value, kind }));
        }
        continue;
      }
      const target = resolveProjectPath(directory(path), value);
      if (!files.has(target)) {
        issues.push(issue('error', 'missing_reference', `${path} references missing local file ${target}`, { path, ref: value, target, kind }));
      } else if (kind === 'worker' || kind === 'runtime-fetch' || kind === 'css-import') {
        issues.push(issue('warning', 'preview_runtime_limit', `${path} uses ${kind} for ${value}; the blob preview may not rewrite it.`, { path, ref: value, target, kind }));
      }
    }
  }

  if (entry && !String(files.get(entry)?.text || '').trim()) {
    issues.push(issue('error', 'empty_entry', `${entry} is empty.`, { path: entry }));
  }

  return {
    entry,
    fileCount: paths.length,
    totalBytes: paths.reduce((sum, path) => sum + (Number(files.get(path)?.size) || 0), 0),
    checkedReferences,
    externalReferences,
    hubReferences,
    issues,
  };
}

export async function fileRecords(projectHandle) {
  const tree = await readProjectTree(projectHandle);
  const records = new Map();
  for (const [path, file] of tree) {
    const vendored = isVendoredLibraryPath(path);
    records.set(path, {
      size: file.size,
      type: file.type,
      vendored,
      text: TEXT_EXT.has(extension(path)) && !vendored ? await file.text() : null,
    });
  }
  return records;
}

export function statusFromIssues(issues = []) {
  if (issues.some(x => x.severity === 'error')) return 'failed';
  if (issues.some(x => x.severity === 'warning')) return 'warned';
  return 'passed';
}

/**
 * Load a diagnostic preview in an off-screen, controlled iframe. The preview
 * injects an error/console/resource listener before generated scripts execute.
 */
/**
 * @param {object} options
 * @param {boolean} [options.screenshot]  capture a DOM screenshot with html2canvas.
 *   Off by default here: a VR project's page is one full-viewport WebGL canvas,
 *   which html2canvas cannot photograph meaningfully, and rasterising a document
 *   whose animation loop is resizing that canvas every frame blocks the main
 *   thread for minutes under software WebGL. The evidence image for a VR run is
 *   the eye capture from the XR lane.
 */
export async function runWebDiagnostics(projectHandle, { settleMs = 1400, screenshot: wantScreenshot = false } = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { errors: [], warnings: ['Runtime diagnostics require a browser.'], dimensions: null, screenshot: null };
  }
  const token = `gfdiag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const preview = await buildProjectPreview(projectHandle, { diagnosticsToken: token, stack: 'web' });
  if (!preview.ok) return { errors: ['Preview could not be assembled.'], warnings: [], dimensions: null, screenshot: null };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;opacity:0;pointer-events:none;';
  const errors = [];
  const warnings = [];
  let dimensions = null;
  const onMessage = (event) => {
    const data = event.data;
    if (!data || data.__gameForgeDiagnostic !== token) return;
    if (data.kind === 'error' || data.kind === 'unhandledrejection' || data.kind === 'resource-error' || data.kind === 'console-error') {
      errors.push(data);
    } else if (data.kind === 'dimensions') {
      dimensions = data.value;
    }
  };

  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);
  frame.src = preview.url;
  await new Promise(resolve => {
    let done = false;
    let fallbackTimer = null;
    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(fallbackTimer);
        resolve();
      }
    };
    frame.addEventListener('load', () => setTimeout(finish, settleMs), { once: true });
    fallbackTimer = setTimeout(() => {
      warnings.push('Diagnostic frame timed out before a stable load event.');
      finish();
    }, settleMs + 2500);
  });

  let screenshot = null;
  try {
    if (!wantScreenshot) throw new Error('DOM screenshot not requested');
    const { default: html2canvas } = await import('../../shared/lib/html2canvas/1.4.1/index.mjs');
    const doc = frame.contentDocument;
    if (!doc?.documentElement) throw new Error('diagnostic frame document is unavailable');
    const canvas = await html2canvas(doc.documentElement, {
      width: 800, height: 600, windowWidth: 800, windowHeight: 600,
      backgroundColor: '#000000', logging: false, useCORS: false,
    });
    screenshot = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!screenshot) throw new Error('canvas returned no PNG');
  } catch (error) {
    if (wantScreenshot) warnings.push(`Screenshot capture failed: ${error.message}`);
  }

  window.removeEventListener('message', onMessage);
  frame.remove();
  preview.revoke?.();
  return { errors, warnings, dimensions, screenshot };
}

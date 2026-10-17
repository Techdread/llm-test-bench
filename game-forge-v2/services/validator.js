import { readProjectTree } from './previewer.js';
import { buildProjectPreview, readProjectManifest, validateProjectManifest } from './previewAdapters.js';
import {
  isVendoredLibraryPath, projectLibraryValidationIssues,
} from './projectLibraries.js';

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
export function validateWebStructure(files, { offline = true } = {}) {
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
    issues,
  };
}

async function fileRecords(projectHandle) {
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
export async function runWebDiagnostics(projectHandle, { settleMs = 1400 } = {}) {
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
    warnings.push(`Screenshot capture failed: ${error.message}`);
  }

  window.removeEventListener('message', onMessage);
  frame.remove();
  preview.revoke?.();
  return { errors, warnings, dimensions, screenshot };
}

export async function validateWebProject(projectHandle, options = {}) {
  const records = await fileRecords(projectHandle);
  const structure = validateWebStructure(records, options);
  const manifestInfo = await readProjectManifest(projectHandle, { stack: 'web' });
  let runtime = { errors: [], warnings: [], dimensions: null, screenshot: null };
  if (structure.entry) {
    try {
      runtime = await runWebDiagnostics(projectHandle, options);
    } catch (error) {
      runtime.warnings.push(`Runtime diagnostics failed to start: ${error.message}`);
    }
  }

  const issues = [
    ...structure.issues,
    ...validateProjectManifest(manifestInfo, [...records.keys()]),
  ];
  for (const error of runtime.errors) {
    const message = typeof error === 'string' ? error : error.message || error.value || error.kind;
    issues.push(issue('error', 'runtime_error', String(message), { runtime: error }));
  }
  for (const warning of runtime.warnings) issues.push(issue('warning', 'runtime_warning', warning));
  if (!runtime.dimensions) issues.push(issue('warning', 'missing_render_dimensions', 'The diagnostic frame did not report render dimensions.'));
  if (!runtime.screenshot) issues.push(issue('warning', 'missing_screenshot', 'No diagnostic screenshot was captured.'));

  return {
    schemaVersion: 1,
    kind: 'web',
    checkedAt: new Date().toISOString(),
    status: statusFromIssues(issues),
    structure: { ...structure, issues: undefined },
    runtime: { errors: runtime.errors, warnings: runtime.warnings, dimensions: runtime.dimensions },
    projectManifest: manifestInfo.manifest,
    previewAdapter: manifestInfo.manifest.runtime,
    issues,
    screenshot: runtime.screenshot,
  };
}

export async function validateNativeProject(projectDir, stack, { maxNativeSeconds = 60 } = {}) {
  try {
    const response = await fetch('/__agent/validate-native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, stack, timeoutSeconds: maxNativeSeconds }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `bridge returned ${response.status}`);
    const issues = result.exitCode === 0
      ? []
      : [issue('error', 'native_build_failed', `Native validation command exited ${result.exitCode}.`)];
    return {
      schemaVersion: 1, kind: 'native', checkedAt: new Date().toISOString(),
      status: statusFromIssues(issues), command: result.command,
      exitCode: result.exitCode, stdout: result.stdout || '', stderr: result.stderr || '',
      elapsedMs: result.elapsedMs, timedOut: !!result.timedOut, issues, screenshot: null,
    };
  } catch (error) {
    const issues = [issue('warning', 'native_validation_unavailable', `Native build was not verified: ${error.message}`)];
    return {
      schemaVersion: 1, kind: 'native', checkedAt: new Date().toISOString(),
      status: 'warned', command: null, exitCode: null, stdout: '', stderr: '',
      elapsedMs: null, timedOut: false, issues, screenshot: null,
    };
  }
}

export async function validateProject({
  projectHandle, projectDir, stack = 'web', budgets, stopReason, libraries = [],
}) {
  const isWeb = !stack || String(stack).toLowerCase() === 'web';
  const report = isWeb
    ? await validateWebProject(projectHandle, { offline: true })
    : await validateNativeProject(projectDir, stack, budgets);
  if (!isWeb) {
    const info = await readProjectManifest(projectHandle, { stack });
    report.projectManifest = info.manifest;
    report.previewAdapter = info.manifest.runtime;
    report.issues.push(...validateProjectManifest(info, info.fileList));
    report.status = statusFromIssues(report.issues);
  }
  if (isWeb && libraries.length) {
    const integrity = await projectLibraryValidationIssues(projectHandle, libraries);
    report.libraryIntegrity = integrity.records;
    report.issues.push(...integrity.issues);
    report.status = statusFromIssues(report.issues);
  }
  if (stopReason && stopReason !== 'done') {
    report.issues.push(issue('warning', 'generation_stopped_early', `Generation stopped with reason "${stopReason}" before validation.`));
    report.status = statusFromIssues(report.issues);
  }
  return report;
}

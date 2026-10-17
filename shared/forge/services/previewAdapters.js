import { buildPreview, readProjectTree } from './previewer.js';

/** Kept here rather than imported so this module stays free of the guest VM. */
const NATIVE_RUNTIME_LABELS = Object.freeze({
  'cpp-guest': 'C++ (Debian guest)',
  'python-guest': 'Python (Debian guest)',
  'python-pyodide': 'Python (Pyodide)',
});

/** Runtimes whose evidence comes back from a process, not from a page. */
export const SANDBOX_RUNTIMES = Object.freeze(Object.keys(NATIVE_RUNTIME_LABELS));

export const PREVIEW_ADAPTERS = Object.freeze({
  'static-web': {
    id: 'static-web',
    label: 'Static web',
    runnable: true,
    build: (projectHandle, options) => buildPreview(projectHandle, options),
  },
  'module-web': {
    id: 'module-web',
    label: 'Module web',
    runnable: true,
    build: async (projectHandle, options) => ({
      ...(await buildPreview(projectHandle, options)),
      adapterWarning: 'Static relative module imports are previewed. Workers, runtime fetches, import.meta assets, and cyclic module graphs require a local server.',
    }),
  },
  // A WebXR project previews exactly like a module-web one — the app's XR panes
  // (spec 334) install an emulated device into the same frame when a session is
  // wanted. Declaring it separately keeps the manifest honest and lets a viewer
  // say why the flat preview is only half the story.
  webxr: {
    id: 'webxr',
    label: 'WebXR project',
    runnable: true,
    build: async (projectHandle, options) => ({
      ...(await buildPreview(projectHandle, options)),
      adapterWarning: 'This is the project\'s non-XR path. An immersive session needs a headset, or the emulated device the XR pane installs.',
    }),
  },
  'web-worker': {
    id: 'web-worker',
    label: 'Web Worker project',
    runnable: true,
    build: async (projectHandle, options) => ({
      ...(await buildPreview(projectHandle, options)),
      adapterWarning: 'Worker entry URLs are not rewritten by the blob preview.',
    }),
  },
  wasm: {
    id: 'wasm',
    label: 'WebAssembly project',
    runnable: true,
    build: async (projectHandle, options) => ({
      ...(await buildPreview(projectHandle, options)),
      adapterWarning: 'WebAssembly MIME and runtime loading are checked during validation.',
    }),
  },
  native: {
    id: 'native',
    label: 'Native/archive',
    runnable: false,
    build: async projectHandle => {
      const files = await readProjectTree(projectHandle);
      return { ok: false, reason: 'native-archive', fileList: [...files.keys()].sort(), adapter: 'native' };
    },
  },
  // Spec 329's runtimes: not runnable in an iframe, but runnable in the
  // sandbox lane. `reason: 'native-run'` is what tells a panel to show the
  // NativeRunPane — a run bar, a compile log and decoded evidence — instead of
  // reporting "no index.html entry" about a project that never had one.
  ...Object.fromEntries(['cpp-guest', 'python-guest', 'python-pyodide'].map(id => [id, {
    id,
    label: NATIVE_RUNTIME_LABELS[id],
    runnable: false,
    sandboxRunnable: true,
    build: async projectHandle => {
      const files = await readProjectTree(projectHandle);
      return { ok: false, reason: 'native-run', runtime: id, fileList: [...files.keys()].sort(), adapter: id };
    },
  }])),
  document: {
    id: 'document',
    label: 'Document/data',
    runnable: false,
    build: async projectHandle => {
      const files = await readProjectTree(projectHandle);
      return { ok: false, reason: 'document', fileList: [...files.keys()].sort(), adapter: 'document' };
    },
  },
});

/**
 * @param {object} value          the parsed forge-project.json
 * @param {object} [fallback]     inferred runtime/kind/entry
 * @param {Function} [extend]     a domain's extra manifest fields, as
 *                                `(value) => object`, merged over the base.
 *                                Forges with their own manifest contract
 *                                (routes, era pack, core artifact…) add them
 *                                here rather than forking this module.
 */
export function normalizeProjectManifest(value, fallback = {}, extend = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const runtime = String(value.runtime || fallback.runtime || 'static-web').toLowerCase();
  const adapter = PREVIEW_ADAPTERS[runtime] ? runtime : fallback.runtime || 'static-web';
  return {
    ...(typeof extend === 'function' ? extend(value) : {}),
    schemaVersion: Number(value.schemaVersion) || 1,
    kind: String(value.kind || fallback.kind || 'game'),
    entry: value.entry == null ? fallback.entry || null : String(value.entry),
    runtime: adapter,
    build: value.build ?? null,
    run: value.run ?? null,
    assets: Array.isArray(value.assets)
      ? value.assets.map(asset => manifestAssetPath(asset)).filter(Boolean)
      : [],
    declaredControls: Array.isArray(value.declaredControls)
      ? value.declaredControls.map(control => manifestControlLabel(control)).filter(Boolean)
      : [],
  };
}

// Local models commonly emit the richer `{ path: "..." }` asset shape even
// though the compact Forge contract uses strings. Accept the unambiguous forms
// instead of turning objects into the invalid literal "[object Object]".
function manifestAssetPath(asset) {
  if (typeof asset === 'string') return asset;
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return '';
  return String(asset.path ?? asset.src ?? asset.file ?? asset.href ?? '').trim();
}

function manifestControlLabel(control) {
  if (typeof control === 'string') return control;
  if (!control || typeof control !== 'object' || Array.isArray(control)) return '';
  if (control.label || control.name) return String(control.label || control.name);
  const type = String(control.type || 'control');
  const values = control.keys || control.buttons || control.inputs;
  return Array.isArray(values) && values.length ? `${type}: ${values.join(', ')}` : type;
}

export function inferPreviewRuntime(paths = [], stack = 'web') {
  const normalized = String(stack || 'web').toLowerCase();
  if (normalized !== 'web') return 'native';
  if (paths.some(path => /\.wasm$/i.test(path))) return 'wasm';
  return 'static-web';
}

export async function readProjectManifest(projectHandle, {
  stack = 'web', defaultKind = 'game', manifestExtend = null,
} = {}) {
  const files = await readProjectTree(projectHandle);
  const paths = [...files.keys()];
  let raw = null;
  let parseError = null;
  const file = files.get('forge-project.json');
  if (file) {
    try { raw = JSON.parse(await file.text()); } catch (error) { parseError = error.message; }
  }
  const inferredRuntime = inferPreviewRuntime(paths, stack);
  const manifest = normalizeProjectManifest(raw, {
    runtime: inferredRuntime,
    kind: defaultKind,
    entry: paths.includes('index.html') ? 'index.html' : null,
  }, manifestExtend) || {
    ...(typeof manifestExtend === 'function' ? manifestExtend({}) : {}),
    schemaVersion: 1, kind: defaultKind, entry: paths.includes('index.html') ? 'index.html' : null,
    runtime: inferredRuntime, build: null, run: null, assets: [], declaredControls: [],
  };
  return {
    // `raw` is the untouched parse, so a validator can check for fields the
    // normalizer would otherwise silently supply a default for.
    manifest, raw, exists: !!file, parseError, inferred: !raw,
    declaredRuntime: raw?.runtime == null ? null : String(raw.runtime).toLowerCase(),
    fileList: paths.sort(),
  };
}

export async function buildProjectPreview(projectHandle, options = {}) {
  const info = await readProjectManifest(projectHandle, options);
  const adapter = PREVIEW_ADAPTERS[info.manifest.runtime] || PREVIEW_ADAPTERS['static-web'];
  const result = await adapter.build(projectHandle, { ...options, entry: info.manifest.entry });
  return { ...result, adapter: adapter.id, adapterLabel: adapter.label, manifest: info.manifest, manifestInfo: info };
}

export function validateProjectManifest(info, paths = []) {
  const issues = [];
  if (!info.exists) {
    issues.push({
      severity: 'warning', code: 'missing_project_manifest',
      message: 'forge-project.json is missing; the preview adapter was inferred.',
    });
  }
  if (info.parseError) {
    issues.push({
      severity: 'error', code: 'invalid_project_manifest',
      message: `forge-project.json is not valid JSON: ${info.parseError}`,
    });
  }
  if (info.declaredRuntime && !PREVIEW_ADAPTERS[info.declaredRuntime]) {
    issues.push({
      severity: 'error', code: 'unsupported_preview_adapter',
      message: `forge-project.json declares unsupported runtime adapter ${info.declaredRuntime}.`,
    });
  }
  const manifest = info.manifest;
  if (manifest.entry && !paths.includes(manifest.entry)) {
    issues.push({
      severity: 'error', code: 'manifest_entry_missing',
      message: `forge-project.json declares missing entry ${manifest.entry}.`,
      path: manifest.entry,
    });
  }
  for (const asset of manifest.assets || []) {
    if (!paths.includes(asset)) {
      issues.push({
        severity: 'error', code: 'manifest_asset_missing',
        message: `forge-project.json declares missing asset ${asset}.`,
        path: asset,
      });
    }
  }
  return issues;
}

// Agent file tools shared by the Forge family — the model builds a multi-file
// project by calling these against a scoped project directory (File System
// Access API). Adapted from tool-calling-lab's toolRegistry, trimmed to the
// file toolset plus a `report_done` signal so the model can end the build
// explicitly, and three opt-in tools: `generate_image` (real art assets via
// Wan2GP), `preview_app` (boot the project and read its own console) and
// `web_search`.
//
// The three opt-in tools are offered only when the caller's capability list
// names them, so a Forge that never grants them sees exactly the classic file
// toolset. `ctx.appId` attributes media generation to the calling app.

import { textToImage } from '../../services/media.js';
import { utf8Bytes } from './budgets.js';

export const APP_ID = 'forge';

export const TOOL_CAPABILITIES = Object.freeze({
  write_file: 'project.file.write',
  edit_file: 'project.file.edit',
  read_file: 'project.file.read',
  list_files: 'project.file.list',
  generate_image: 'media.image.generate',
  preview_app: 'browser.preview.run',
  run_project: 'project.run',
  web_search: 'web.search',
  report_done: 'workflow.complete',
});

export const DEFAULT_CAPABILITY_POLICIES = Object.freeze({
  'project.file.write': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.edit': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.read': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'project.file.list': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'media.image.generate': { permission: 'media-generation', timeoutMs: 180_000, audited: true },
  'browser.preview.run': { permission: 'sandbox-preview', timeoutMs: 60_000, audited: true },
  'project.run': { permission: 'sandbox-run', timeoutMs: 600_000, audited: true },
  'web.search': { permission: 'web-search', timeoutMs: 30_000, audited: true },
  'workflow.complete': { permission: 'run-control', timeoutMs: 5_000, audited: true },
});

// ── Path helpers ──

function splitPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.some(p => p === '..')) throw new Error('Path traversal not allowed');
  return parts;
}

async function resolveFileHandle(dir, path) {
  const parts = splitPath(path);
  let current = dir;
  for (let i = 0; i < parts.length - 1; i++) current = await current.getDirectoryHandle(parts[i]);
  return current.getFileHandle(parts[parts.length - 1]);
}

async function resolveDirectoryHandle(dir, path) {
  if (!path || path === '.' || path === '/') return dir;
  const parts = splitPath(path);
  let current = dir;
  for (const part of parts) current = await current.getDirectoryHandle(part);
  return current;
}

async function resolveOrCreateFileHandle(dir, path) {
  const parts = splitPath(path);
  let current = dir;
  for (let i = 0; i < parts.length - 1; i++) current = await current.getDirectoryHandle(parts[i], { create: true });
  return current.getFileHandle(parts[parts.length - 1], { create: true });
}

async function readFileText(dir, path) {
  const fh = await resolveFileHandle(dir, path);
  const file = await fh.getFile();
  return file.text();
}

// ── Tool definitions ──

export const TOOLS = [
  {
    name: 'write_file',
    description: 'Create a NEW file with the given content. Creates parent directories as needed. A path may be authored only once during a build; if it already exists, use edit_file for a targeted change.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root, e.g. "index.html" or "src/game.js"' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
    execute: async (args, dir, ctx = {}) => {
      if (ctx.rejectWriteOverwrite) {
        try {
          const existing = await resolveFileHandle(dir, args.path);
          const text = await (await existing.getFile()).text();
          const limit = Math.max(500, Number(ctx.existingFileExcerptChars) || 6_000);
          const excerpt = text.length > limit
            ? `${text.slice(0, limit)}\n…[truncated; ${text.length - limit} more chars]`
            : text;
          throw new Error(`${args.path} already exists and was preserved. Use edit_file for a targeted change. Current content:\n<existing_file path="${args.path}">\n${excerpt}\n</existing_file>`);
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
        }
      }
      const budget = ctx.budget?.beforeFileWrite(args.path, utf8Bytes(args.content));
      if (budget && !budget.ok) throw new Error(`Budget stopped write: ${budget.reason}`);
      const fh = await resolveOrCreateFileHandle(dir, args.path);
      const w = await fh.createWritable();
      await w.write(args.content);
      await w.close();
      return `Wrote ${args.content.length} chars to ${args.path}`;
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a unique substring in an existing file. Fails if old_string is absent or matches more than once. Prefer this over rewriting a whole file for small changes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root' },
        old_string: { type: 'string', description: 'Exact substring to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    execute: async (args, dir, ctx = {}) => {
      const content = await readFileText(dir, args.path);
      const count = content.split(args.old_string).length - 1;
      if (count === 0) throw new Error(`old_string not found in ${args.path}`);
      if (count > 1) throw new Error(`old_string matches ${count} locations in ${args.path} — must be unique`);
      const nextContent = content.replace(args.old_string, args.new_string);
      const budget = ctx.budget?.beforeFileWrite(args.path, utf8Bytes(nextContent));
      if (budget && !budget.ok) throw new Error(`Budget stopped edit: ${budget.reason}`);
      const fh = await resolveFileHandle(dir, args.path);
      const w = await fh.createWritable();
      await w.write(nextContent);
      await w.close();
      return `Edited ${args.path}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read a file you previously wrote so you can inspect or extend it.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the project root' } },
      required: ['path'],
    },
    execute: async (args, dir) => readFileText(dir, args.path),
  },
  {
    name: 'list_files',
    description: 'List files and directories at a path in the project. Use "." for the project root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path relative to the project root; use "." for root' } },
      required: ['path'],
    },
    execute: async (args, dir) => {
      const d = await resolveDirectoryHandle(dir, args.path);
      const entries = [];
      for await (const [name, handle] of d.entries()) {
        entries.push({ name, type: handle.kind === 'directory' ? 'dir' : 'file' });
      }
      entries.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
      return entries.length ? entries.map(e => `${e.type === 'dir' ? '[dir]' : '[file]'} ${e.name}`).join('\n') : '(empty)';
    },
  },
  {
    name: 'preview_app',
    optional: true, // only offered when the run grants browser.preview.run
    description: 'Boot the current project in a sandboxed browser viewport and read back what actually rendered: console/runtime errors, document dimensions, overflow evidence, focusable-element count and stable-selector count. Use it after the entry file is wired, and again after a focused fix — it is how you see your own mistakes.',
    parameters: {
      type: 'object',
      properties: {
        viewport: { type: 'string', description: 'Named viewport to inspect. Defaults to the run\'s primary viewport.' },
      },
    },
    execute: async (args, dir, ctx = {}) => {
      if (typeof ctx.previewInspector !== 'function') {
        throw new Error('Preview inspection is not wired up for this run.');
      }
      return ctx.previewInspector(dir, { viewport: args.viewport || null });
    },
  },
  {
    name: 'run_project',
    optional: true, // only offered when the run grants project.run
    description: 'Build and run the current project in the sandbox, exactly as the manifest declares it, and read back what the process produced: compiler diagnostics, the exit code, stdout/stderr and the declared evidence files decoded. This is how you read your own compiler errors and look at your own output — use it after the first build is wired and again after each focused fix. You do not choose the command line; the manifest does.',
    parameters: {
      type: 'object',
      properties: {
        seed: { type: 'number', description: 'Seed to run with. Defaults to the brief\'s seed.' },
      },
    },
    execute: async (args, dir, ctx = {}) => {
      if (typeof ctx.projectRunner !== 'function') {
        throw new Error('Sandbox runs are not wired up for this run.');
      }
      return ctx.projectRunner(dir, { seed: Number.isFinite(args.seed) ? args.seed : null });
    },
  },
  {
    name: 'web_search',
    optional: true, // only offered when the run grants web.search
    description: 'Search the public web through the user-configured Brave Search service. Use only when current external information materially helps this project; never turn a result into a runtime dependency or a fetched URL.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Focused search query.' },
        count: { type: 'number', description: 'Number of results, 1-10. Default 5.' },
      },
      required: ['query'],
    },
    execute: async args => {
      const { search, formatResultsForPrompt } = await import('../../services/brave-search.js');
      const results = await search(String(args.query || ''), Math.max(1, Math.min(10, Number(args.count) || 5)));
      return { results, formatted: formatResultsForPrompt(results) };
    },
  },
  {
    name: 'generate_image',
    optional: true, // only offered when the user enables AI image assets
    description: 'Generate a real image asset (a sprite, background, tile, or title graphic) with an AI image model and save it into the project as a PNG/JPG the game loads by relative path. Generation takes several seconds, so use it sparingly for a few key assets — draw incidental art procedurally. For a sprite/object, set transparent:true — it is rendered on a flat magenta (#ff00ff) field so the game can colour-key that colour to transparent when drawing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Where to save the asset, relative to the project root, e.g. "assets/player.png" or "assets/bg.jpg"' },
        prompt: { type: 'string', description: 'What to draw. Be specific about style (e.g. "16-bit pixel-art", "flat vector"), subject, and view (side/top-down).' },
        kind: { type: 'string', enum: ['sprite', 'background', 'tile', 'ui'], description: 'What the asset is for. Picks a sensible size and prompt hints. Default sprite.' },
        transparent: { type: 'boolean', description: 'For a sprite/object that must sit on top of the game: renders on a flat magenta (#ff00ff) field to colour-key. Default true for sprite/tile/ui, false for background.' },
        size: { type: 'string', description: 'Override size: a preset (square|portrait|landscape|wide|tall) or exact WxH like "512x512". Optional.' },
        seed: { type: 'number', description: 'Optional seed for reproducibility; omit or -1 for random.' },
      },
      required: ['path', 'prompt'],
    },
    execute: async (args, dir, ctx = {}) => {
      const kind = ['sprite', 'background', 'tile', 'ui'].includes(args.kind) ? args.kind : 'sprite';
      const transparent = args.transparent ?? (kind !== 'background');
      const size = args.size || (kind === 'background' ? 'landscape' : kind === 'ui' ? 'landscape' : 'square');
      let prompt = String(args.prompt || '').trim();
      if (transparent) prompt += ', the subject fully visible and centered on a flat solid magenta #ff00ff background, no shadow, no gradient';
      ctx.onProgress?.({ percent: 0, status: 'submitting' });
      const result = await textToImage({
        prompt, size, appId: ctx.appId || APP_ID, seed: Number.isFinite(args.seed) ? args.seed : -1,
        signal: ctx.signal,
        onProgress: (p) => ctx.onProgress?.(p),
      });
      const file = result.files?.[0];
      if (!file) throw new Error('image model returned no file');
      let blob = await file.blob();
      let dimensions = await imageDimensions(blob);
      // For a sprite, punch true alpha by keying out the magenta field, so the game
      // gets a clean transparent PNG instead of relying on a runtime colour-key.
      let keyed = false;
      if (transparent) {
        const png = await keyOutMagenta(blob).catch(() => null);
        if (png) { blob = png; keyed = true; dimensions = await imageDimensions(blob); }
      }
      const pixels = dimensions ? dimensions.width * dimensions.height : 0;
      const budget = ctx.budget?.beforeFileWrite(args.path, blob.size, { image: true, pixels });
      if (budget && !budget.ok) throw new Error(`Budget stopped image: ${budget.reason}`);
      const fh = await resolveOrCreateFileHandle(dir, args.path);
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      const kb = (blob.size / 1024).toFixed(0);
      const note = keyed ? '; transparent background applied' : transparent ? '; magenta #ff00ff background to colour-key (treat r>140 && b>120 && g<0.6*min(r,b) as transparent)' : '';
      return `Generated ${args.path} (${kb} KB${note}). Reference it by the relative path "${args.path}".`;
    },
  },
  {
    name: 'report_done',
    description: 'Call this once the game is complete and the entry index.html plus all its files are written. Provide a short summary of what you built and how to play.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Short summary + controls' } },
      required: ['summary'],
    },
    execute: async (args) => `DONE: ${args.summary || ''}`,
  },
];

// Key out the magenta field from a generated sprite → a transparent PNG blob.
// Browser-only (needs createImageBitmap + OffscreenCanvas); returns null elsewhere
// so the caller falls back to writing the raw image.
async function keyOutMagenta(blob) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (r > 140 && b > 120 && gg < 0.6 * Math.min(r, b)) d[i + 3] = 0; // magenta-ish → transparent
  }
  g.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function imageDimensions(blob) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dimensions;
  } catch {
    return null;
  }
}

const BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));

/**
 * The tool array sent on the wire.
 *
 * An optional tool needs an explicit grant: its capability must appear in
 * `opts.capabilities` (generate_image also honours the legacy `imageGen`
 * flag). A caller that passes no capability list gets the historical complete
 * file toolset and no optional tools — so promoting preview_app and web_search
 * into this module cannot silently widen an existing Forge's toolset.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.imageGen] Include the optional generate_image tool.
 * @param {string[]} [opts.capabilities] Capabilities granted for this run.
 */
export function getOpenAIToolsArray(opts = {}) {
  const allowed = opts.capabilities ? new Set(opts.capabilities) : null;
  return TOOLS
    .filter(t => {
      const capability = TOOL_CAPABILITIES[t.name];
      if (allowed && !allowed.has(capability)) return false;
      if (!t.optional) return true;
      if (t.name === 'generate_image' && opts.imageGen) return true;
      return !!allowed?.has(capability);
    })
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function validateArgs(args, schema) {
  const errors = [];
  if (Array.isArray(schema?.required)) {
    for (const k of schema.required) if (args[k] === undefined || args[k] === null) errors.push(`Missing required parameter: ${k}`);
  }
  return errors;
}

export async function runTool(name, args, dir, ctx = {}) {
  const tool = BY_NAME[name];
  args = normalizeToolArgs(name, args);
  const capability = TOOL_CAPABILITIES[name] || null;
  const startedAt = Date.now();
  const policy = {
    ...(DEFAULT_CAPABILITY_POLICIES[capability] || { permission: 'unknown', timeoutMs: 10_000, audited: true }),
    ...(ctx.capabilityPolicies?.[capability] || {}),
  };
  const finishAudit = (outcome, error = null) => {
    if (!policy.audited) return;
    ctx.onAudit?.({
      schemaVersion: 1,
      timestamp: new Date(startedAt).toISOString(),
      tool: name,
      capability,
      permission: policy.permission,
      timeoutMs: policy.timeoutMs,
      durationMs: Date.now() - startedAt,
      outcome,
      error,
      arguments: auditArguments(args),
    });
  };
  if (!tool) {
    const error = `Unknown tool: "${name}"`;
    finishAudit('denied', error);
    return { valid: false, result: null, error, capability };
  }
  if (ctx.allowedCapabilities && !new Set(ctx.allowedCapabilities).has(capability)) {
    const error = `Capability denied: ${capability}`;
    finishAudit('denied', error);
    return { valid: false, result: null, error, capability };
  }
  const errs = validateArgs(args || {}, tool.parameters);
  if (errs.length) {
    const error = `Validation failed: ${errs.join('; ')}`;
    finishAudit('invalid', error);
    return { valid: false, result: null, error, capability };
  }
  let timer = null;
  try {
    const result = await Promise.race([
      tool.execute(args || {}, dir, ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Capability ${capability} timed out after ${policy.timeoutMs}ms`)), policy.timeoutMs);
      }),
    ]);
    finishAudit('allowed');
    return { valid: true, result, error: null, capability };
  } catch (e) {
    const error = `Execution error: ${e.message}`;
    finishAudit(/timed out/.test(e.message) ? 'timeout' : 'error', error);
    return { valid: true, result: null, error, capability };
  } finally {
    clearTimeout(timer);
  }
}

// Small OpenAI-compatible models often understand the requested operation but
// use a familiar parameter spelling from another tool API. Canonicalise the
// harmless, unambiguous variants before schema validation instead of failing a
// whole turn over `file_path` versus `path`.
export function normalizeToolArgs(name, value) {
  const args = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  if (args.path == null) args.path = args.file_path ?? args.filePath ?? args.filename;
  if (name === 'write_file' && args.content == null) args.content = args.text ?? args.code ?? args.data;
  if (name === 'edit_file') {
    if (args.old_string == null) args.old_string = args.oldText ?? args.old_text ?? args.search;
    if (args.new_string == null) args.new_string = args.newText ?? args.new_text ?? args.replace;
  }
  if (name === 'list_files' && !args.path) args.path = '.';
  if (name === 'report_done' && args.summary == null) args.summary = args.message ?? args.result;
  return args;
}

function auditArguments(args = {}) {
  const summary = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (key === 'content' || key === 'old_string' || key === 'new_string') {
      summary[`${key}Bytes`] = utf8Bytes(value);
    } else if (key === 'prompt') {
      summary.promptChars = String(value || '').length;
    } else if (typeof value === 'string') {
      summary[key] = value.slice(0, 240);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
      summary[key] = value;
    }
  }
  return summary;
}

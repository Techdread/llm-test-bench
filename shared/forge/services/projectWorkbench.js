// Project file operations shared by the Forge family — copy, manifest, diff,
// ZIP export, code-editor handoff, the human evaluation rubric, and the
// iteration (fork / improve / repair / continue / merge) contract.
import { readProjectTree } from './previewer.js';

const TEXT_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'css', 'csv', 'h', 'hpp', 'htm', 'html', 'ini', 'java',
  'js', 'json', 'jsx', 'md', 'mjs', 'py', 'rs', 'sh', 'svg', 'toml', 'ts',
  'tsx', 'txt', 'xml', 'yaml', 'yml', 'zig',
]);
const DEFAULT_SOURCE_LIMIT = 32 * 1024;

const extension = path => (String(path).split('.').pop() || '').toLowerCase();
export const isTextPath = path => TEXT_EXTENSIONS.has(extension(path));

async function ensureDirectory(root, parts) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

/** Copy an existing project into a new, empty run directory. */
export async function copyProject(sourceHandle, destinationHandle) {
  let files = 0;
  let bytes = 0;
  async function copyDirectory(source, destination) {
    for await (const [name, handle] of source.entries()) {
      if (handle.kind === 'directory') {
        const child = await destination.getDirectoryHandle(name, { create: true });
        await copyDirectory(handle, child);
        continue;
      }
      const file = await handle.getFile();
      const target = await destination.getFileHandle(name, { create: true });
      const writer = await target.createWritable();
      await writer.write(file);
      await writer.close();
      files++;
      bytes += file.size || 0;
    }
  }
  await copyDirectory(sourceHandle, destinationHandle);
  return { files, bytes };
}

/** Write one portable project-relative file, creating parent folders. */
export async function writeProjectFile(projectHandle, path, value) {
  const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error('Invalid project path');
  const name = parts.pop();
  const directory = await ensureDirectory(projectHandle, parts);
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(value);
  await writer.close();
}

/** Compact serializable manifest used by the browser, diffs, and AI coach. */
export async function projectManifest(projectHandle, { includeText = false, sourceLimit = DEFAULT_SOURCE_LIMIT } = {}) {
  const tree = await readProjectTree(projectHandle);
  const files = [];
  let totalBytes = 0;
  for (const [path, file] of [...tree.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const record = { path, size: file.size || 0, type: file.type || '', text: null };
    totalBytes += record.size;
    if (includeText && isTextPath(path) && record.size <= sourceLimit) {
      record.text = await file.text();
    }
    files.push(record);
  }
  return { fileCount: files.length, totalBytes, files };
}

export async function readProjectText(projectHandle, path, maxBytes = 512 * 1024) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error('Invalid project path');
  const name = parts.pop();
  let directory = projectHandle;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  const file = await (await directory.getFileHandle(name)).getFile();
  if (!isTextPath(path)) return { text: null, size: file.size, type: file.type, binary: true };
  if (file.size > maxBytes) {
    return { text: null, size: file.size, type: file.type, binary: false, tooLarge: true };
  }
  return { text: await file.text(), size: file.size, type: file.type, binary: false };
}

// Fast stable content fingerprint. This is comparison evidence, not security.
export function textFingerprint(text) {
  let hash = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** File-level diff suitable for a two-run project comparison. */
export async function diffProjects(leftHandle, rightHandle) {
  const [left, right] = await Promise.all([
    projectManifest(leftHandle, { includeText: true }),
    projectManifest(rightHandle, { includeText: true }),
  ]);
  const leftFiles = new Map(left.files.map(file => [file.path, file]));
  const rightFiles = new Map(right.files.map(file => [file.path, file]));
  const paths = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort();
  const files = paths.map(path => {
    const a = leftFiles.get(path);
    const b = rightFiles.get(path);
    let status = 'unchanged';
    if (!a) status = 'added';
    else if (!b) status = 'removed';
    else if (a.size !== b.size || a.text === null || b.text === null
      || textFingerprint(a.text) !== textFingerprint(b.text)) status = 'modified';
    return {
      path, status,
      left: a ? { size: a.size, text: a.text, type: a.type } : null,
      right: b ? { size: b.size, text: b.text, type: b.type } : null,
    };
  });
  const counts = Object.fromEntries(['added', 'removed', 'modified', 'unchanged']
    .map(status => [status, files.filter(file => file.status === status).length]));
  return { files, counts, left, right };
}

/** Convert the whole project to the byte dictionary accepted by fflate. */
export async function projectZipEntries(projectHandle) {
  const tree = await readProjectTree(projectHandle);
  const entries = {};
  for (const [path, file] of tree) entries[path] = new Uint8Array(await file.arrayBuffer());
  return entries;
}

/**
 * Zip the project, optionally with generated files added alongside it.
 *
 * `scaffold` is a function given the project's own entries and returning a
 * `{ path: string|Uint8Array }` map of files to add — editor configuration, a
 * build recipe, a BUILDING.md. It is a hook rather than a fixed set because
 * what makes an exported project openable is domain knowledge: a web Forge
 * wants nothing, a native one wants a toolchain. A scaffold file NEVER
 * overwrites a file the project already ships; the model's own Makefile wins
 * over a generated one, every time.
 */
export async function createProjectZip(projectHandle, { scaffold = null } = {}) {
  const { zipSync } = await import('../../lib/fflate/0.8.2/index.mjs');
  const entries = await projectZipEntries(projectHandle);
  if (scaffold) {
    const encoder = new TextEncoder();
    const extra = (await scaffold(entries)) || {};
    for (const [path, value] of Object.entries(extra)) {
      if (value == null || path in entries) continue;
      entries[path] = typeof value === 'string' ? encoder.encode(value) : value;
    }
  }
  return zipSync(entries, { level: 6 });
}

export async function downloadProjectZip(projectHandle, filename = 'forge-project.zip', options = {}) {
  const bytes = await createProjectZip(projectHandle, options);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, bytes: bytes.length };
}

/** Hand a portable text snapshot to the suite's multi-file local code editor. */
export async function openProjectInCodeMorphLab(projectHandle, {
  title = 'Forge project', prompt = 'Inspect and improve this project.',
  source = 'Forge',
} = {}) {
  const manifest = await projectManifest(projectHandle, {
    includeText: true, sourceLimit: 512 * 1024,
  });
  const files = manifest.files
    .filter(file => file.text != null)
    .map(file => ({ name: file.path, content: file.text }));
  const payload = {
    v: 1,
    source,
    kind: 'code',
    title,
    prompt,
    language: files.some(file => file.name.endsWith('.py')) ? 'python' : 'html',
    files,
    meta: {
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      importedAt: new Date().toISOString(),
    },
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > 1_800_000) {
    throw new Error('Project text is too large for editor handoff; download the ZIP instead.');
  }
  localStorage.setItem('cml:handoff', serialized);
  window.open('../code-morph-lab-v3/', '_blank');
  return { files: files.length, bytes: serialized.length };
}

// The default rubric. A Forge with its own weights passes its adapter's
// evaluationRubric into normalizeEvaluation rather than replacing this list.
export const EVALUATION_CRITERIA = [
  { id: 'completeness', label: 'Brief completeness' },
  { id: 'playability', label: 'Playability and feel' },
  { id: 'visualQuality', label: 'Visual quality' },
  { id: 'structure', label: 'Code/project structure' },
  { id: 'performance', label: 'Performance' },
  { id: 'originality', label: 'Originality' },
  { id: 'reliability', label: 'Bugs and reliability' },
];

export function normalizeEvaluation(value = {}, criteria = EVALUATION_CRITERIA) {
  const scores = {};
  for (const criterion of criteria) {
    const score = Number(value.scores?.[criterion.id]);
    scores[criterion.id] = Number.isFinite(score) ? Math.max(0, Math.min(5, Math.round(score))) : 0;
  }
  return {
    schemaVersion: 1,
    scores,
    notes: String(value.notes || '').slice(0, 12000),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

export function evaluationAverage(evaluation) {
  const scores = Object.values(evaluation?.scores || {})
    .map(Number).filter(score => Number.isFinite(score) && score > 0);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

export function iterationMetadata({
  kind, parentRunId, sourceRunIds, requestedChange, promptVersion = 1,
} = {}) {
  const ids = [...new Set((sourceRunIds || [parentRunId]).filter(Boolean))];
  return {
    iterationKind: kind || 'fork',
    parentRunId: parentRunId || ids[0] || null,
    sourceRunIds: ids,
    sourcePromptVersion: promptVersion,
    requestedChange: String(requestedChange || '').trim(),
  };
}

export function iterationTask({ kind, requestedChange, validation, sourceRunIds = [] }) {
  const instruction = String(requestedChange || '').trim();
  const issues = (validation?.issues || []).map(item => `- ${item.code}: ${item.message}`).join('\n');
  const mode = {
    improve: 'Improve the existing project in place.',
    repair: 'Repair the existing project so its preview and validation pass.',
    continue: 'Continue the unfinished existing project from its current files.',
    merge: 'Use the referenced runs as design input and merge their strongest ideas into this project.',
    agent: 'Review and improve the existing project as an external coding agent.',
  }[kind] || 'Revise the existing project.';
  return [
    mode,
    'The current project directory is a COPY of the saved parent run. Preserve working features, inspect files before editing, and make focused changes rather than rebuilding blindly.',
    sourceRunIds.length ? `Source runs: ${sourceRunIds.join(', ')}` : '',
    instruction ? `Requested change:\n${instruction}` : '',
    issues ? `Captured validation/preview failures:\n${issues}` : '',
    'Finish with a complete, portable project and update forge-project.json if the runtime, entrypoint, assets, or controls changed.',
  ].filter(Boolean).join('\n\n');
}

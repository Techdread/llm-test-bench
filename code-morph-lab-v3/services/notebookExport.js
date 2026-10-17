import { ensureAppNamespace } from '../../shared/services/data-root-manager.js';
import { saveFile } from '../../shared/services/fs.js';

const NOTEBOOK_APP_ID = 'notebook-lab';
const NOTEBOOK_FOLDER = 'notebooks';
const LAST_NB_KEY = 'notebook-lab-last-notebook-id';
const AUTOSAVE_KEY = 'notebook-lab-autosave';

function nowIso() {
  return new Date().toISOString();
}

function cellId() {
  return 'c-' + Math.random().toString(36).slice(2, 10);
}

function notebookId(session) {
  const slug = String(session?.id || session?.goal || 'code-morph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44) || 'code-morph';
  return `nb-cml-${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

function titleFromSession(session) {
  const sourceTitle = session?.importedFrom?.title || '';
  if (sourceTitle.trim()) return `Code Morph: ${sourceTitle.trim()}`;
  const firstLine = String(session?.goal || '').trim().split('\n').find(Boolean);
  return `Code Morph: ${firstLine ? firstLine.slice(0, 72) : session?.id || 'Untitled'}`;
}

function promptSource(session) {
  const goal = String(session?.goal || '').trim();
  return `# Prompt\n\n${goal || '(No prompt recorded.)'}`;
}

function fileArrayToMap(files) {
  const map = new Map();
  for (const file of files || []) {
    if (file?.name && typeof file.content === 'string') {
      map.set(file.name, file.content);
    }
  }
  return map;
}

function isExternalRef(ref) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(ref || '').trim());
}

function cleanLocalRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw || isExternalRef(raw)) return '';
  const withoutQuery = raw.split(/[?#]/)[0];
  try {
    return decodeURIComponent(withoutQuery).replace(/^\.?\//, '').replace(/^\/+/, '');
  } catch {
    return withoutQuery.replace(/^\.?\//, '').replace(/^\/+/, '');
  }
}

function resolveWorkspaceRef(ref, filesByName) {
  const cleaned = cleanLocalRef(ref);
  if (!cleaned) return '';
  if (filesByName.has(cleaned)) return cleaned;
  const basename = cleaned.split('/').filter(Boolean).pop();
  return basename && filesByName.has(basename) ? basename : '';
}

function copyAttributes(from, to, skip = new Set()) {
  for (const attr of Array.from(from.attributes || [])) {
    if (!skip.has(attr.name)) to.setAttribute(attr.name, attr.value);
  }
}

export function buildSelfContainedHtml(entryContent, files) {
  if (typeof DOMParser === 'undefined') return entryContent || '';

  const filesByName = fileArrayToMap(files);
  const doc = new DOMParser().parseFromString(entryContent || '', 'text/html');

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const name = resolveWorkspaceRef(link.getAttribute('href'), filesByName);
    if (!name) continue;
    const style = doc.createElement('style');
    style.textContent = filesByName.get(name).replace(/<\/style/gi, '<\\/style');
    copyAttributes(link, style, new Set(['href', 'rel', 'as', 'crossorigin', 'integrity']));
    link.replaceWith(style);
  }

  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const name = resolveWorkspaceRef(script.getAttribute('src'), filesByName);
    if (!name) continue;
    const inline = doc.createElement('script');
    copyAttributes(script, inline, new Set(['src', 'crossorigin', 'integrity']));
    inline.textContent = filesByName.get(name).replace(/<\/script/gi, '<\\/script');
    script.replaceWith(inline);
  }

  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const name = resolveWorkspaceRef(img.getAttribute('src'), filesByName);
    if (!name || !name.endsWith('.svg')) continue;
    img.setAttribute('src', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(filesByName.get(name))}`);
  }

  const hasDoctype = /^\s*<!doctype/i.test(entryContent || '');
  return `${hasDoctype ? '<!DOCTYPE html>\n' : ''}${doc.documentElement.outerHTML}`;
}

function outputsFromRunResult(runResult) {
  if (!runResult) return null;
  const outputs = [];
  if (runResult.stdout) outputs.push({ type: 'text', value: runResult.stdout });
  if (runResult.stderr) outputs.push({ type: 'text', role: 'stderr', value: runResult.stderr });
  return outputs.length ? outputs : null;
}

function lastOutputTextFromRunResult(runResult) {
  if (!runResult) return '';
  return [runResult.stdout, runResult.stderr].filter(Boolean).join('\n');
}

function outputCellKind(language, entryFile) {
  if (language === 'html') return 'html';
  if (language === 'python' || entryFile?.endsWith('.py')) return 'py';
  return 'md';
}

function outputCellSource({ session, files, entryFile }) {
  const entry = files.find(file => file.name === entryFile);
  if (!entry) return '';
  if (session?.language === 'html' && entryFile.endsWith('.html')) {
    return buildSelfContainedHtml(entry.content, files);
  }
  return entry.content;
}

export function buildMorphNotebook({ session, files, entryFile, runResult }) {
  const ts = nowIso();
  const kind = outputCellKind(session?.language, entryFile);
  const source = outputCellSource({ session, files, entryFile });
  const ok = !runResult || runResult.exitCode === 0;
  const metadata = {
    codeMorph: {
      exportedAt: ts,
      sessionId: session?.id || null,
      language: session?.language || null,
      model: session?.model || null,
      status: session?.status || null,
      entryFile: entryFile || null,
      files: (files || []).map(file => ({ name: file.name, size: file.content.length })),
      run: runResult ? {
        exitCode: runResult.exitCode,
        duration: runResult.duration,
        timedOut: !!runResult.timedOut,
      } : null,
    },
  };

  return {
    id: notebookId(session),
    title: titleFromSession(session),
    state: {},
    cells: [
      {
        id: cellId(),
        kind: 'md',
        source: promptSource(session),
        outputs: null,
        error: null,
        lastOutputText: '',
        metadata,
      },
      {
        id: cellId(),
        kind,
        source,
        outputs: kind === 'py' ? outputsFromRunResult(runResult) : null,
        error: kind === 'py' && !ok ? (runResult?.stderr || 'Execution failed') : null,
        lastOutputText: kind === 'py' ? lastOutputTextFromRunResult(runResult) : '',
        metadata,
      },
    ],
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function saveMorphNotebook(payload) {
  const notebook = buildMorphNotebook(payload);
  const appHandle = await ensureAppNamespace(NOTEBOOK_APP_ID);
  await saveFile(appHandle, NOTEBOOK_FOLDER, `${notebook.id}.json`, JSON.stringify(notebook, null, 2));
  localStorage.setItem(LAST_NB_KEY, notebook.id);
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(notebook));
  } catch {
    // Large notebooks can exceed localStorage limits; the disk save above is authoritative.
  }
  return notebook;
}

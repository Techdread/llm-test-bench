// notebookStore — persists notebooks as JSON under <root>/notebook-lab/notebooks/<id>.json

import { saveFile, readFile, listFiles, deleteFile } from '../../shared/services/fs.js';
import { ensureAppNamespace, getRoot, connectRoot, setRoot } from '../../shared/services/data-root-manager.js';
import { isWebEdition } from './edition.js';

const APP_ID = 'notebook-lab';
const FOLDER = 'notebooks';

let rootHandle = null;

export async function initHandle() {
  try {
    if (await getRoot()) {
      rootHandle = await ensureAppNamespace(APP_ID);
      return true;
    }
  } catch (e) { /* no root */ }
  return false;
}

export async function pickDirectory() {
  // The web edition has no hub Settings page to choose a data root in, so ask
  // for a folder here (as the public Prompt Gallery does).
  const root = isWebEdition() ? await setRoot() : await connectRoot();
  if (!root) throw new Error('No data root configured — go to Settings → Data Root.');
  rootHandle = await ensureAppNamespace(APP_ID);
  return true;
}

export function hasDirectory() {
  return !!rootHandle;
}

export function getAppHandle() {
  return rootHandle;
}

export async function listNotebooks() {
  if (!rootHandle) return [];
  try {
    const names = await listFiles(rootHandle, FOLDER, '.json');
    const ids = names.map(n => n.replace(/\.json$/, ''));
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const text = await readFile(rootHandle, FOLDER, `${id}.json`);
        const nb = JSON.parse(text);
        return { id, title: nb.title || id, updatedAt: nb.updatedAt || null };
      } catch {
        return { id, title: id, updatedAt: null };
      }
    }));
    entries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return entries;
  } catch {
    return [];
  }
}

export async function saveNotebook(notebook) {
  if (!rootHandle) throw new Error('No data root selected');
  const id = notebook.id;
  if (!id) throw new Error('Notebook id required');
  const body = { ...notebook, updatedAt: new Date().toISOString() };
  await saveFile(rootHandle, FOLDER, `${id}.json`, JSON.stringify(body, null, 2));
  return body;
}

export async function loadNotebook(id) {
  if (!rootHandle) throw new Error('No data root selected');
  const text = await readFile(rootHandle, FOLDER, `${id}.json`);
  return JSON.parse(text);
}

export async function deleteNotebook(id) {
  if (!rootHandle) throw new Error('No data root selected');
  await deleteFile(rootHandle, FOLDER, `${id}.json`);
}

const TUTORIALS_DIR = './tutorial-notebooks';

export async function listTutorials() {
  try {
    const res = await fetch(`${TUTORIALS_DIR}/index.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    const entries = await res.json();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export async function loadTutorial(file) {
  const res = await fetch(`${TUTORIALS_DIR}/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Tutorial not found: ${file}`);
  const nb = await res.json();
  return { ...nb, id: newNotebookId(), tutorialSource: file };
}

const EXAMPLES_DIR = './example-notebooks';

export async function listExamples() {
  try {
    const res = await fetch(`${EXAMPLES_DIR}/index.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    const entries = await res.json();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export async function listExampleCategories() {
  try {
    const res = await fetch(`${EXAMPLES_DIR}/categories.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    const entries = await res.json();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export async function loadExample(file) {
  const res = await fetch(`${EXAMPLES_DIR}/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Example not found: ${file}`);
  const nb = await res.json();
  return { ...nb, id: newNotebookId(), exampleSource: file };
}

export function newNotebookId() {
  return `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankNotebook(title = 'Untitled Notebook') {
  return {
    id: newNotebookId(),
    title,
    state: {},
    cells: [
      { id: cellId(), kind: 'md', source: '# ' + title + '\n\nStart writing, or add a code cell below.' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function cellId() {
  return 'c-' + Math.random().toString(36).slice(2, 10);
}

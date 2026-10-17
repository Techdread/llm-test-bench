// Project persistence under the connected data root.
//
// One directory per project: `understory-studio/projects/<id>/`, holding
// `project.json` (references, versions, attribution) and `exchanges.json` (every
// prompt, image and response). They are split because the exchange log is the
// larger of the two by an order of magnitude and is only read when the Runs tab
// is open — loading the project list should not pull megabytes of base64.
//
// A draft is written BEFORE generation starts, so an attempt that fails or is
// stopped is still in the list afterwards with its failure recorded. A project
// with zero completed versions must stay loadable; that is the whole point.

import { ensureAppNamespace, getRoot } from '../../shared/services/data-root-manager.js';

const APP_ID = 'understory-studio';
const MAX_VERSIONS = 30;

async function projectsDir({ create = false } = {}) {
  const root = await getRoot();
  if (!root) return null;
  const app = create
    ? await ensureAppNamespace(APP_ID)
    : await root.getDirectoryHandle(APP_ID, { create: false }).catch(() => null);
  if (!app) return null;
  return app.getDirectoryHandle('projects', { create }).catch(() => null);
}

async function readJson(dir, name) {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    return JSON.parse(await (await handle.getFile()).text());
  } catch {
    return null;
  }
}

async function writeJson(dir, name, value) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

export const MAX_NAME = 80;

/** A project name the file system and the picker can both live with: one line,
 *  collapsed whitespace, capped. An empty result means "keep what you had" —
 *  renaming to nothing is a mis-click, not an instruction. */
export function normalizeProjectName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export function newProject({ name = 'Untitled asset', kind = 'object', brief = '', references = [] } = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    brief,
    rigging: 'none',
    references,
    versions: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

/** Project summaries for the picker, newest first. Never loads exchanges. */
export async function listProjects() {
  const dir = await projectsDir();
  if (!dir) return [];
  const projects = [];
  for await (const [id, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    const project = await readJson(handle, 'project.json');
    if (!project?.id) continue;
    const latest = project.versions?.at(-1);
    projects.push({
      id,
      name: project.name || 'Untitled asset',
      kind: project.kind || 'object',
      updated: project.updated || project.created || '',
      versions: project.versions?.length || 0,
      rigging: latest?.rigging || project.rigging || 'none',
      approved: Boolean(latest?.review?.approved),
      model: latest?.model || project.metadata?.model || '',
      providerId: latest?.providerId || project.metadata?.providerId || '',
    });
  }
  return projects.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

export async function loadProject(id) {
  const dir = await projectsDir();
  const handle = await dir?.getDirectoryHandle(id, { create: false }).catch(() => null);
  if (!handle) throw new Error('That project is no longer in the data root.');
  const project = await readJson(handle, 'project.json');
  if (!project) throw new Error('That project could not be read.');
  return project;
}

export async function saveProject(project) {
  const dir = await projectsDir({ create: true });
  if (!dir) throw new Error('Connect a data root before saving.');
  const handle = await dir.getDirectoryHandle(project.id, { create: true });
  // Retention trims the oldest, never the selected one's ancestors silently:
  // the UI shows how many versions a project holds, so the trim is visible.
  const trimmed = {
    ...project,
    versions: (project.versions || []).slice(-MAX_VERSIONS),
    updated: new Date().toISOString(),
  };
  await writeJson(handle, 'project.json', trimmed);
  return trimmed;
}

/**
 * Rename in place. The directory is the project id, never the name, so this
 * rewrites one field and moves nothing — a rename cannot orphan a run log or
 * break a link. A project that has not been saved yet is not an error: the new
 * name simply rides along on its first save.
 *
 * `updated` is deliberately left alone. The picker sorts on it and the card
 * shows it, and both read as "when this asset was last worked on" — relabelling
 * a project is not work on it, and should not shuffle the list.
 *
 * @returns {Promise<string>} the name actually stored, or '' if it was refused.
 */
export async function renameProject(id, name) {
  const next = normalizeProjectName(name);
  if (!next) return '';
  const dir = await projectsDir();
  const handle = await dir?.getDirectoryHandle(id, { create: false }).catch(() => null);
  if (!handle) return next;
  const project = await readJson(handle, 'project.json');
  if (!project) return next;
  await writeJson(handle, 'project.json', { ...project, name: next });
  return next;
}

export async function deleteProject(id) {
  const dir = await projectsDir();
  if (!dir) return;
  // Soft delete: the directory is renamed out of the listing rather than
  // removed, so a mis-click cannot destroy an afternoon of generations.
  const source = await dir.getDirectoryHandle(id, { create: false }).catch(() => null);
  if (!source) return;
  const project = await readJson(source, 'project.json');
  const target = await dir.getDirectoryHandle(`deleted-${id}`, { create: true });
  await writeJson(target, 'project.json', { ...project, deletedAt: new Date().toISOString(), id: `deleted-${id}` });
  const exchanges = await readJson(source, 'exchanges.json');
  if (exchanges) await writeJson(target, 'exchanges.json', exchanges);
  await dir.removeEntry(id, { recursive: true });
}

export async function readExchanges(id) {
  const dir = await projectsDir();
  const handle = await dir?.getDirectoryHandle(id, { create: false }).catch(() => null);
  if (!handle) return [];
  return (await readJson(handle, 'exchanges.json')) || [];
}

export async function appendExchange(id, entry) {
  const dir = await projectsDir({ create: true });
  if (!dir) return [];
  const handle = await dir.getDirectoryHandle(id, { create: true });
  const existing = (await readJson(handle, 'exchanges.json')) || [];
  const next = [...existing, { ...entry, id: crypto.randomUUID() }];
  await writeJson(handle, 'exchanges.json', next);
  return next;
}

export function versionLabel(version, index) {
  const prefix = version.rigging === 'animated' ? 'Animated · '
    : version.rigging === 'mixamo' ? 'T-pose · '
    : '';
  const state = version.review?.approved ? 'Reviewed' : 'Needs refinement';
  // Two models means two attributions: which one built it, and which one looked.
  const eyes = version.eyesModel ? ` (eyes: ${version.eyesModel})` : '';
  return `${index + 1} · ${prefix}${state}${version.model ? ` — ${version.model}${eyes}` : ''}`;
}

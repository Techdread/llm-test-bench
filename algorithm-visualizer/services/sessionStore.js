// Session persistence — saves under <data-root>/algorithm-visualizer/projects/algo-vis/sessions/<id>.json.
// Matches the data-root contract of the other apps in the hub.

import {
  isRootReady,
  listFiles,
  readJson,
  writeJsonAtomic,
  resolveFile,
} from '../../shared/services/storage-adapter.js';
import { connectRoot } from '../../shared/services/data-root-manager.js';

const APP_ID = 'algorithm-visualizer';
const AREA = 'projects';
const SUBFOLDER_A = 'algo-vis';
const SUBFOLDER_B = 'sessions';

export async function hasRoot() { return await isRootReady(); }

export async function pickRoot() {
  const root = await connectRoot();
  if (!root) throw new Error('No data root configured — go to Settings → Data Root.');
  return true;
}

export async function listSessions() {
  if (!(await isRootReady())) return [];
  try {
    const files = await listFiles(APP_ID, AREA, { extension: '.json' }, SUBFOLDER_A, SUBFOLDER_B);
    const out = [];
    for (const name of files) {
      try {
        const data = await readJson(APP_ID, AREA, SUBFOLDER_A, SUBFOLDER_B, name);
        if (data && data.id) out.push(data);
      } catch { /* skip */ }
    }
    out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return out;
  } catch {
    return [];
  }
}

export async function saveSession(session) {
  if (!(await isRootReady())) throw new Error('No data root is set.');
  const id = session.id || makeId(session.name);
  const now = new Date().toISOString();
  const payload = {
    ...session,
    id,
    name: session.name || 'Untitled session',
    createdAt: session.createdAt || now,
    updatedAt: now,
  };
  await writeJsonAtomic(APP_ID, AREA, [SUBFOLDER_A, SUBFOLDER_B, `${id}.json`], payload);
  return payload;
}

export async function loadSession(id) {
  if (!(await isRootReady())) throw new Error('No data root is set.');
  return await readJson(APP_ID, AREA, SUBFOLDER_A, SUBFOLDER_B, `${id}.json`);
}

export async function deleteSession(id) {
  if (!(await isRootReady())) throw new Error('No data root is set.');
  const { dir, fileName } = await resolveFile(APP_ID, AREA, SUBFOLDER_A, SUBFOLDER_B, `${id}.json`);
  try { await dir.removeEntry(fileName); } catch { /* best-effort */ }
}

function makeId(name) {
  const slug = (name || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';
  const suffix = String(Date.now()).slice(-6);
  return `${slug}-${suffix}`;
}

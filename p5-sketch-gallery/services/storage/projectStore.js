// Project (sketch) persistence layer for p5 Sketch Gallery.
// Layout under the app handle:
//   <appHandle>/projects/<sketchId>/
//      sketch.js         — the user p5 sketch source
//      prompt.md         — the prompt used to generate (may be empty)
//      params.json       — current default params
//      metadata.json     — { id, title, model, modelId, provider*, tags, seed, parentId, createdAt, savedAt, generatedAt, notes }
//      thumb.png         — still preview captured at save time

const PROJECTS_DIR = 'projects';

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function sanitize(name) {
  const s = String(name || 'sketch')
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return s || 'sketch';
}

async function getProjectsDir(rootHandle, create = true) {
  return rootHandle.getDirectoryHandle(PROJECTS_DIR, { create });
}

export function makeSketchId(title) {
  return `${sanitize(title)}-${shortId()}`;
}

export async function makeUniqueSketchId(rootHandle, title) {
  const projects = await getProjectsDir(rootHandle, true);
  for (let i = 0; i < 20; i++) {
    const id = makeSketchId(title);
    try {
      await projects.getDirectoryHandle(id);
    } catch (e) {
      return id;
    }
  }
  return `${sanitize(title)}-${Date.now().toString(36)}-${shortId()}`;
}

export function createMetadata({
  title,
  model,
  modelId = '',
  modelName = '',
  modelDisplayLabel = '',
  providerId = '',
  providerName = '',
  providerType = '',
  source = 'manual',
  tags = [],
  seed,
  parentId = null,
  notes = '',
  generatedAt = null,
  generationParams = null,
  generationStats = null,
  batch = null,
} = {}) {
  const now = new Date().toISOString();
  const displayModel = modelDisplayLabel || model || modelName || modelId || 'manual';
  return {
    schemaVersion: 3,
    title: title || 'Untitled',
    model: displayModel,
    modelId: modelId || '',
    modelName: modelName || '',
    modelDisplayLabel: modelDisplayLabel || displayModel,
    providerId: providerId || '',
    providerName: providerName || '',
    providerType: providerType || '',
    source,
    tags,
    seed: Number.isFinite(seed) ? seed : 1,
    parentId: parentId || null,
    createdAt: now,
    savedAt: now,
    generatedAt,
    notes,
    generationParams,
    generationStats,
    batch,
  };
}

async function writeFile(dir, name, content) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

async function readText(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch (e) { return null; }
}

async function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function saveProject(rootHandle, sketchId, payload) {
  const projects = await getProjectsDir(rootHandle, true);
  const dir = await projects.getDirectoryHandle(sketchId, { create: true });

  await writeFile(dir, 'sketch.js', payload.code || '');
  await writeFile(dir, 'prompt.md', payload.prompt || '');
  await writeFile(dir, 'params.json', JSON.stringify(payload.params || {}, null, 2));
  await writeFile(dir, 'metadata.json', JSON.stringify({ id: sketchId, ...payload.metadata }, null, 2));

  if (payload.thumbnailDataUrl) {
    const blob = await dataUrlToBlob(payload.thumbnailDataUrl);
    if (blob) await writeFile(dir, 'thumb.png', blob);
  }
  return sketchId;
}

export async function loadProject(rootHandle, sketchId) {
  const projects = await getProjectsDir(rootHandle, false);
  const dir = await projects.getDirectoryHandle(sketchId);

  const code = (await readText(dir, 'sketch.js')) ?? '';
  const prompt = (await readText(dir, 'prompt.md')) ?? '';
  const paramsRaw = await readText(dir, 'params.json');
  const metaRaw = await readText(dir, 'metadata.json');

  let params = {};
  try { params = paramsRaw ? JSON.parse(paramsRaw) : {}; } catch (e) {}
  let metadata = {};
  try { metadata = metaRaw ? JSON.parse(metaRaw) : {}; } catch (e) {}

  let thumbnailUrl = null;
  try {
    const tf = await dir.getFileHandle('thumb.png');
    const blob = await (await tf.getFile());
    thumbnailUrl = URL.createObjectURL(blob);
  } catch (e) {}

  return { id: sketchId, code, prompt, params, metadata, thumbnailUrl };
}

export async function listProjects(rootHandle) {
  let projects;
  try { projects = await getProjectsDir(rootHandle, false); }
  catch (e) { return []; }

  const out = [];
  for await (const [name, handle] of projects) {
    if (handle.kind !== 'directory') continue;
    const metaRaw = await readText(handle, 'metadata.json');
    let metadata = {};
    try { metadata = metaRaw ? JSON.parse(metaRaw) : {}; } catch (e) {}
    let thumbnailUrl = null;
    try {
      const tf = await handle.getFileHandle('thumb.png');
      const blob = await (await tf.getFile());
      thumbnailUrl = URL.createObjectURL(blob);
    } catch (e) {}
    out.push({
      id: name,
      title: metadata.title || name,
      model: metadata.model || '',
      modelId: metadata.modelId || '',
      modelName: metadata.modelName || '',
      modelDisplayLabel: metadata.modelDisplayLabel || metadata.model || '',
      providerId: metadata.providerId || '',
      providerName: metadata.providerName || '',
      providerType: metadata.providerType || '',
      source: metadata.source || '',
      tags: metadata.tags || [],
      seed: metadata.seed,
      parentId: metadata.parentId || null,
      createdAt: metadata.createdAt || '',
      savedAt: metadata.savedAt || '',
      generatedAt: metadata.generatedAt || '',
      notes: metadata.notes || '',
      generationParams: metadata.generationParams || null,
      generationStats: metadata.generationStats || null,
      batch: metadata.batch || null,
      thumbnailUrl,
    });
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

// Lightweight catalogue scan used by the prompt library. Unlike listProjects
// and loadProject this deliberately never creates thumbnail object URLs.
export async function listProjectPromptRecords(rootHandle) {
  let projects;
  try { projects = await getProjectsDir(rootHandle, false); }
  catch (e) { return []; }

  const out = [];
  for await (const [name, handle] of projects) {
    if (handle.kind !== 'directory') continue;
    const [prompt, metaRaw] = await Promise.all([
      readText(handle, 'prompt.md'),
      readText(handle, 'metadata.json'),
    ]);
    if (!String(prompt || '').trim()) continue;
    let metadata = {};
    try { metadata = metaRaw ? JSON.parse(metaRaw) : {}; } catch (e) {}
    out.push({ id: name, prompt, metadata });
  }
  return out;
}

export async function listBatchRuns(rootHandle) {
  const records = await listProjectPromptRecords(rootHandle);
  const groups = new Map();
  for (const record of records) {
    const batch = record.metadata?.batch;
    if (!batch?.id) continue;
    if (!groups.has(batch.id)) {
      groups.set(batch.id, {
        id: batch.id,
        model: record.metadata.modelDisplayLabel || record.metadata.model || record.metadata.modelId || 'unknown',
        modelId: record.metadata.modelId || '',
        providerId: record.metadata.providerId || '',
        startedAt: batch.startedAt || record.metadata.generatedAt || record.metadata.createdAt || '',
        items: [],
      });
    }
    groups.get(batch.id).items.push({
      projectId: record.id,
      title: record.metadata.title || batch.promptTitle || record.id,
      prompt: record.prompt,
      promptId: batch.promptId || '',
      jobKey: batch.jobKey || '',
      index: batch.index ?? 0,
      generationParams: record.metadata.generationParams || null,
      generationStats: record.metadata.generationStats || null,
    });
  }
  const runs = [...groups.values()].map(run => ({
    ...run,
    items: run.items.sort((a, b) => a.index - b.index),
    count: run.items.length,
  }));
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return runs;
}

export async function loadBatchRunProjects(rootHandle, items) {
  return Promise.all((items || []).map(async item => {
    try {
      const project = await loadProject(rootHandle, item.projectId);
      return { ...item, ...project };
    } catch (error) {
      return { ...item, error: error.message };
    }
  }));
}

export async function deleteProject(rootHandle, sketchId) {
  const projects = await getProjectsDir(rootHandle, false);
  await projects.removeEntry(sketchId, { recursive: true });
}

export async function updateMetadata(rootHandle, sketchId, patch) {
  const projects = await getProjectsDir(rootHandle, false);
  const dir = await projects.getDirectoryHandle(sketchId);
  const raw = (await readText(dir, 'metadata.json')) ?? '{}';
  const meta = { ...(JSON.parse(raw) || {}), ...patch };
  await writeFile(dir, 'metadata.json', JSON.stringify(meta, null, 2));
  return meta;
}

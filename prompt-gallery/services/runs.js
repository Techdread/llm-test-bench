// Past batch runs, rebuilt from the generations already loaded in memory.
//
// Batch generations carry `batch: { id, kind, healAttempts, generatedAt }` in
// their metadata (written by the batch runner), so a run is just every
// generation grouped by that id. Because listGenerations() already reads each
// generation's HTML into `response`, no extra disk reads are needed — a run and
// all its previews can be assembled synchronously.

import { modelLabel, humanizeFolderName } from './gallery.js';

// The subject of a generation — what was asked for. Batch prompts come from the
// library, so the folder is slugify(prompt.title) — a clean, distinct name
// ("space-shooter", "tower-defense"). That beats the prompt's first line, which
// shares a boilerplate lead-in across prompts and reads identically once
// truncated in a list. A leading ordinal like "01-" is dropped.
function deriveSubject(g) {
  const folder = String(g.folderId || g.id || '');
  const cleaned = folder.replace(/^\d+[-_](?=.)/, '');
  const title = humanizeFolderName(cleaned || folder).trim();
  if (title) return title;
  const firstLine = String(g.prompt || '')
    .split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 80) : 'Untitled';
}

function cleanLabel(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function isMeaningfulTitle(t) {
  if (!t || t.length < 2) return false;
  return !['document', 'untitled', 'title', 'page', 'html', 'three.js', 'threejs', 'index', 'app'].includes(t.toLowerCase());
}

// What the model actually made — the name it gave its own creation. Prefer the
// document <title>, fall back to the first heading. This is the most direct
// "here's what came out" signal and typically differs from model to model.
function extractGenTitle(htmlDoc) {
  if (!htmlDoc) return '';
  let m = htmlDoc.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let t = cleanLabel(m && m[1]);
  if (!isMeaningfulTitle(t)) {
    m = htmlDoc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    t = cleanLabel((m && m[1] || '').replace(/<[^>]+>/g, ' '));
  }
  if (!isMeaningfulTitle(t)) return '';
  return t.length > 64 ? t.slice(0, 64).trim() + '…' : t;
}

// Group generations into runs. Returns runs newest-first, each with its items
// (previews included) ordered oldest-first within the run.
export function buildRuns(generations) {
  const runs = new Map();

  for (const g of (generations || [])) {
    const m = g.metadata || {};
    const runId = m.batch?.id;
    if (!runId) continue; // not a batch generation

    if (!runs.has(runId)) {
      runs.set(runId, {
        id: runId,
        model: modelLabel(g),
        modelId: m.modelId || null,
        providerId: m.providerId || null,
        items: [],
      });
    }

    const kind = m.batch?.kind || 'original';
    const healed = kind === 'healed' || (m.tags || []).includes('healed');
    runs.get(runId).items.push({
      id: g.id,
      slug: g.folderId || g.id,
      title: deriveSubject(g),
      genTitle: extractGenTitle(g.response || ''),
      prompt: g.prompt || '',
      html: g.response || '',
      kind,
      healed,
      valid: true,
      params: m.genParams || null,
      paramsLabel: m.paramsLabel || null,
      stats: m.genStats || null,
      generatedAt: m.batch?.generatedAt || m.createdAt || '',
    });
  }

  const list = [];
  for (const run of runs.values()) {
    run.items.sort((a, b) => (a.generatedAt || '').localeCompare(b.generatedAt || ''));
    list.push({
      ...run,
      count: run.items.length,
      startedAt: run.items[0]?.generatedAt || '',
    });
  }
  return list.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

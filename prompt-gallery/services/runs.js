// Past batch runs, rebuilt from the generations already loaded in memory.
//
// Batch generations carry `batch: { id, kind, healAttempts, generatedAt }` in
// their metadata (written by the batch runner), so a run is just every
// generation grouped by that id. Because listGenerations() already reads each
// generation's HTML into `response`, no extra disk reads are needed — a run and
// all its previews can be assembled synchronously.

import { modelLabel, humanizeFolderName } from './gallery.js';
import { ratingOf } from './rating.js';

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

function generationModelKey(generation) {
  const metadata = generation?.metadata || {};
  const providerId = cleanLabel(metadata.providerId).toLowerCase();
  const modelId = cleanLabel(metadata.modelId).toLowerCase();
  if (providerId && modelId) return `id:${providerId}\u0000${modelId}`;
  return `label:${cleanLabel(modelLabel(generation)).toLowerCase()}`;
}

// Same model AND same prompt set — merging a Core run into an Advanced one
// would blur exactly the comparison the sets exist for.
export function canMergeRuns(runs) {
  if (!Array.isArray(runs) || runs.length < 2) return false;
  const keys = runs.map(run => run?.modelKey || '');
  if (!keys.every(Boolean) || new Set(keys).size !== 1) return false;
  const sets = runs.map(run => run?.promptSet || 'core');
  return !sets.includes('mixed') && new Set(sets).size === 1;
}

// Build metadata-only updates for a merge. Generation HTML and prompt files are
// never touched; provenance stays recoverable under batch.mergedFrom.
export function planRunMerge(generations, runIds, { mergedRunId, mergedAt } = {}) {
  const sourceRunIds = [...new Set((runIds || []).filter(Boolean))];
  if (sourceRunIds.length < 2) throw new Error('Select at least two runs to merge');
  if (!mergedRunId) throw new Error('A merged run ID is required');

  const sourceSet = new Set(sourceRunIds);
  const sourceRuns = buildRuns(generations).filter(run => sourceSet.has(run.id));
  if (sourceRuns.length !== sourceRunIds.length) throw new Error('One or more selected runs no longer exist');
  if (!canMergeRuns(sourceRuns)) throw new Error('Only runs made with the same model and prompt set can be merged');

  const runById = new Map(sourceRuns.map(run => [run.id, run]));
  const provenance = [...new Set(sourceRunIds.flatMap(id => [
    id,
    ...(runById.get(id)?.mergedFrom || []),
  ]))];
  const timestamp = mergedAt || new Date().toISOString();
  return (generations || [])
    .filter(generation => sourceSet.has(generation.metadata?.batch?.id))
    .map(generation => ({
      id: generation.id,
      previousMetadata: generation.metadata || {},
      metadata: {
        ...(generation.metadata || {}),
        batch: {
          ...(generation.metadata?.batch || {}),
          id: mergedRunId,
          mergedAt: timestamp,
          mergedFrom: provenance,
        },
      },
    }));
}

function isMeaningfulTitle(t) {
  if (!t || t.length < 2) return false;
  return !['document', 'untitled', 'title', 'page', 'html', 'three.js', 'threejs', 'index', 'app'].includes(t.toLowerCase());
}

// What the model actually made — the name it gave its own creation. Prefer the
// document <title>, fall back to the first heading. This is the most direct
// "here's what came out" signal and typically differs from model to model.
export function extractGenTitle(htmlDoc) {
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
        modelKeys: new Set(),
        promptSets: new Set(),
        mergedAt: m.batch?.mergedAt || '',
        mergedFrom: Array.isArray(m.batch?.mergedFrom) ? m.batch.mergedFrom : [],
        items: [],
      });
    }

    runs.get(runId).modelKeys.add(generationModelKey(g));
    // Runs from before prompt sets existed were all core.
    runs.get(runId).promptSets.add(m.batch?.promptSet || 'core');

    const kind = m.batch?.kind || 'original';
    const healed = kind === 'healed' || (m.tags || []).includes('healed');
    runs.get(runId).items.push({
      id: g.id,
      slug: g.folderId || g.id,
      title: deriveSubject(g),
      // The page is fetched when a run is opened (see RunsView), so these two
      // are empty in the list view and filled in there. `hasHtml` comes from
      // the directory scan, so "HTML file missing" stays truthful either way.
      genTitle: extractGenTitle(g.response || ''),
      prompt: g.prompt || '',
      html: g.response || '',
      hasHtml: !!(g.response || g.hasResponse),
      kind,
      healed,
      valid: true,
      params: m.genParams || null,
      paramsLabel: m.paramsLabel || null,
      stats: m.genStats || null,
      generatedAt: m.batch?.generatedAt || m.createdAt || '',
      verification: m.verification || null,
      rating: ratingOf(m),
      derivedFrom: m.derivedFrom || '',
      parentId: m.derivedFrom ? `${g.folderId || g.id}/${m.derivedFrom}` : '',
    });
  }

  const list = [];
  for (const run of runs.values()) {
    run.items.sort((a, b) => (a.generatedAt || '').localeCompare(b.generatedAt || ''));
    const modelKeys = [...run.modelKeys];
    const promptSets = [...run.promptSets];
    list.push({
      promptSet: promptSets.length === 1 ? promptSets[0] : 'mixed',
      id: run.id,
      model: run.model,
      modelId: run.modelId,
      providerId: run.providerId,
      modelKey: modelKeys.length === 1 ? modelKeys[0] : '',
      mixedModels: modelKeys.length > 1,
      mergedAt: run.mergedAt,
      mergedFrom: run.mergedFrom,
      items: run.items,
      count: run.items.length,
      ratedCount: run.items.filter(item => item.rating > 0).length,
      startedAt: run.mergedAt || run.items[0]?.generatedAt || '',
    });
  }
  return list.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

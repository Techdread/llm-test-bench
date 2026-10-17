// Variant sweeps — build the (prompt × lane) grid of derived prompts (spec 327).
//
// A sweep is always explicitly requested and previewed; nothing here runs on its
// own. Cells are independent: one failed rewrite must not cost the rest of the
// grid, so a cell records its error and the sweep carries on.

import { ensureAppNamespace } from '../../shared/services/data-root-manager.js';
import {
  reconcileBrief, reconcileBriefWithAgent, reconciliationProvenance,
} from '../../shared/forge/services/briefReconciliation.js';
import { normalizeLibraryIds } from './projectLibraries.js';
import { getAllPrompts, upsertVariantPrompt, variantPromptId } from './library.js';
import { DEFAULT_LANE_MODE, LANE_MODES, normalizeLane } from './lanes.js';
import { normalizeDraftResult } from './promptDrafting.js';

const SWEEPS_DIR = 'variant-sweeps';

function sweepId() {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
  return `sweep-${new Date().toISOString().replace(/[:.]/g, '-')}-${random}`;
}

export function variantTitle(base, lane) {
  return `${base?.title || 'Untitled'} · ${lane?.label || lane?.id || 'lane'}`;
}

/**
 * The grid a sweep would write, with each cell marked against what already
 * exists. Pure — the dialog shows this before anything is spent.
 */
export function planVariantSweep({ prompts = [], lanes = [], mode = '', existing = [] } = {}) {
  const known = new Map(existing.map(prompt => [prompt.id, prompt]));
  const cells = [];
  for (const base of prompts) {
    for (const raw of lanes) {
      const lane = normalizeLane(raw, { source: raw?.source || 'seed' });
      const id = variantPromptId(base.id, lane.id);
      const previous = known.get(id);
      // A lane whose own default is honoured unless the sweep overrides it, so a
      // mixed selection (2D lanes and 3D lanes) does the right thing per lane.
      const cellMode = LANE_MODES.includes(mode) ? mode : (lane.defaultMode || DEFAULT_LANE_MODE);
      cells.push({
        variantId: id,
        baseId: base.id,
        baseTitle: base.title,
        laneId: lane.id,
        laneLabel: lane.label,
        libraries: lane.libraries,
        mode: cellMode,
        status: previous ? 'new-version' : 'new',
        existingVersion: previous?.promptVersion || null,
      });
    }
  }
  return {
    cells,
    // Held-constant cells cost nothing, so the estimate that matters is how many
    // model calls the sweep will actually make.
    modelCalls: cells.filter(cell => cell.mode !== 'held-constant').length,
  };
}

/** The variant payload for a cell whose prompt text is not rewritten. */
export function heldConstantVariant({ base, lane }) {
  const normalized = normalizeLane(lane, { source: lane?.source || 'seed' });
  return {
    baseId: base.id,
    laneId: normalized.id,
    title: variantTitle(base, normalized),
    // Byte-identical to the parent. The library's constraints still reach the
    // build: libraryBriefing injects them into the build task independently of
    // the prompt text, which is exactly what makes this the controlled cell.
    prompt: base.prompt,
    watchFor: base.watchFor || '',
    era: base.era || 'Custom',
    targetStack: base.targetStack || 'web',
    tags: base.tags || [],
    category: base.category || '',
    subcategory: base.subcategory || '',
    collections: base.collections || [],
    libraries: normalizeLibraryIds(normalized.libraries),
    authoring: {
      source: 'human',
      mode: 'library-variant',
      generatedAt: new Date().toISOString(),
    },
    derivation: {
      kind: 'library-variant',
      mode: 'held-constant',
      laneId: normalized.id,
      variantMode: 'held-constant',
      parentPromptId: base.id,
      parentPromptVersion: Number(base.promptVersion) || 1,
      addedLibraries: normalizeLibraryIds(normalized.libraries),
      removedLibraries: normalizeLibraryIds(base.libraries),
      instruction: '',
      createdAt: new Date().toISOString(),
    },
  };
}

export async function adaptedVariant({ base, lane, mode, intent, executor, signal }) {
  const normalized = normalizeLane(lane, { source: lane?.source || 'seed' });
  const options = {
    brief: base,
    domain: 'game',
    domainLabel: 'Game Forge',
    mode,
    previousLibraries: base.libraries || [],
    selectedLibraries: normalized.libraries,
    intent,
    signal,
  };
  // The reconcilers are injectable so this function's own contribution — the
  // fallback, the provenance and the derivation stamping — can be tested
  // without a model call. Production callers never pass them.
  const result = executor.backend === 'agent'
    ? await (executor.reconcileWithAgent || reconcileBriefWithAgent)({
        ...options,
        appId: 'game-forge-v2',
        agentId: executor.agentId,
        agentModel: executor.agentModel || '',
        runAgent: executor.runAgent,
      })
    : await (executor.reconcile || reconcileBrief)({
        ...options,
        providerId: executor.providerId,
        modelId: executor.modelId,
        appTitle: 'Game Forge V2 Variant Sweep',
      });
  // The parent is the fallback, so a field the rewrite left out is inherited
  // rather than blanked.
  const brief = normalizeDraftResult({ ...result.brief, libraries: normalized.libraries }, base);
  const provenance = reconciliationProvenance({
    parent: base,
    mode,
    intent,
    previousLibraries: base.libraries || [],
    selectedLibraries: normalized.libraries,
    backend: executor.backend,
    providerId: executor.providerId,
    modelId: executor.modelId,
    agentId: executor.agentId,
    agentModel: executor.agentModel,
    modelDisplayLabel: executor.modelDisplayLabel,
  });
  // normalizeDraftResult has already refused a rewrite with no title or prompt.
  return {
    baseId: base.id,
    laneId: normalized.id,
    ...brief,
    title: brief.title || variantTitle(base, normalized),
    libraries: normalizeLibraryIds(normalized.libraries),
    authoring: provenance.authoring,
    derivation: {
      ...provenance.derivation,
      kind: 'library-reconciliation',
      laneId: normalized.id,
      variantMode: mode,
    },
    summary: result.summary || '',
    conflicts: result.conflicts || [],
  };
}

async function writeSweepRecord(id, record) {
  const appRoot = await ensureAppNamespace('game-forge-v2');
  const libraryDir = await appRoot.getDirectoryHandle('library', { create: true });
  const sweepsDir = await libraryDir.getDirectoryHandle(SWEEPS_DIR, { create: true });
  const directory = await sweepsDir.getDirectoryHandle(id, { create: true });
  const file = await directory.getFileHandle('sweep.json', { create: true });
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(record, null, 2));
  await writer.close();
}

/**
 * Run a planned sweep. `executor` names who does the rewriting — either
 * `{ backend: 'model', providerId, modelId }` or
 * `{ backend: 'agent', agentId, agentModel, runAgent }`.
 *
 * Resolves with the per-cell outcomes even when some cells failed; only an
 * abort rejects.
 */
export async function runVariantSweep({
  cells = [],
  prompts = [],
  lanes = [],
  intent = '',
  executor = { backend: 'model' },
  onProgress,
  signal,
} = {}) {
  const baseById = new Map(prompts.map(prompt => [prompt.id, prompt]));
  const laneById = new Map(lanes.map(lane => [normalizeLane(lane).id, lane]));
  const id = sweepId();
  const startedAt = new Date().toISOString();
  const outcomes = [];

  for (let index = 0; index < cells.length; index++) {
    if (signal?.aborted) break;
    const cell = cells[index];
    const base = baseById.get(cell.baseId);
    const lane = laneById.get(cell.laneId);
    onProgress?.({ index, total: cells.length, cell, phase: 'start' });
    try {
      if (!base) throw new Error(`Base prompt ${cell.baseId} is no longer in the library.`);
      if (!lane) throw new Error(`Lane ${cell.laneId} is no longer in the catalogue.`);
      const payload = cell.mode === 'held-constant'
        ? heldConstantVariant({ base, lane })
        : await adaptedVariant({ base, lane, mode: cell.mode, intent, executor, signal });
      const saved = await upsertVariantPrompt(payload);
      outcomes.push({
        ...cell, ok: true, promptVersion: saved.promptVersion, created: saved.created,
      });
      onProgress?.({ index, total: cells.length, cell, phase: 'done', saved });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      outcomes.push({ ...cell, ok: false, error: error.message });
      onProgress?.({ index, total: cells.length, cell, phase: 'error', error });
    }
  }

  const record = {
    schemaVersion: 1,
    sweepId: id,
    startedAt,
    finishedAt: new Date().toISOString(),
    cancelled: !!signal?.aborted,
    intent,
    executor: {
      backend: executor.backend,
      providerId: executor.backend === 'model' ? executor.providerId || null : null,
      modelId: executor.backend === 'model' ? executor.modelId || null : null,
      agentId: executor.backend === 'agent' ? executor.agentId || null : null,
      agentModel: executor.backend === 'agent' ? executor.agentModel || null : null,
    },
    counts: {
      total: cells.length,
      succeeded: outcomes.filter(item => item.ok).length,
      failed: outcomes.filter(item => !item.ok).length,
    },
    cells: outcomes,
  };
  // Best effort: losing the audit record must not lose the variants themselves,
  // which are already saved in the prompt library by this point.
  try { await writeSweepRecord(id, record); } catch (error) {
    console.warn('variant sweep record could not be written', error);
  }
  return record;
}

/** Convenience for callers that have not already loaded the prompt library. */
export async function planVariantSweepFromLibrary({ prompts, lanes, mode }) {
  return planVariantSweep({ prompts, lanes, mode, existing: await getAllPrompts() });
}

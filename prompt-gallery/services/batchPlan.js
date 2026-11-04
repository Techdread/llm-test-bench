// Multi-model batch planning: one prompt list run by several models in a
// single launch. DOM-free so it is tested under node.
//
// Each model is a lane: its own batch run id (so Runs, Compare and the merge
// rules keep treating one run as one model) and a shared group id tying the
// lanes of one launch together. The dialog shows every lane in one flat list,
// model by model, so a lane's events are shifted by its offset in that list.

/** A model's identity for de-duplication: provider plus model id. */
export function batchModelKey(model) {
  return `${model?.providerId || ''}\u0000${model?.modelId || ''}`;
}

/** The subset of a toolbar model worth keeping in the batch list (and in localStorage). */
export function snapshotModel(model) {
  if (!model?.providerId || !model?.modelId) return null;
  const keep = ['backend', 'providerId', 'modelId', 'agentId', 'agentModelId', 'label'];
  return Object.fromEntries(keep.filter(k => model[k] != null && model[k] !== '').map(k => [k, model[k]]));
}

/** Add a model to the list unless it is already there. Returns a new list. */
export function addBatchModel(list, model) {
  const snap = snapshotModel(model);
  if (!snap) return list;
  if (list.some(m => batchModelKey(m) === batchModelKey(snap))) return list;
  return [...list, snap];
}

/**
 * Lay out a launch: one lane per model, and the flat run list the dialog shows.
 * A single model keeps the plain run id, exactly as a one-model batch always has.
 *
 * @param {{ prompts: object[], models: object[], runId: string }} cfg
 */
export function planBatchLanes({ prompts, models, runId }) {
  const multi = models.length > 1;
  const lanes = models.map((model, i) => ({
    index: i,
    offset: i * prompts.length,
    prompts,
    model: {
      ...model,
      batchRunId: multi ? `${runId}-m${i + 1}` : runId,
      batchGroupId: multi ? runId : '',
    },
  }));
  const runList = lanes.flatMap(lane => prompts.map(p => ({
    ...p,
    runKey: `${lane.index}:${p.id}`,
    laneIndex: lane.index,
    modelLabel: lane.model.label || lane.model.modelId,
  })));
  return { lanes, runList, multi };
}

/** Add up the per-lane summaries from runBatch into one. */
export function combineSummaries(summaries) {
  const out = { lanes: summaries.length, stopped: false };
  for (const s of summaries) {
    for (const [key, value] of Object.entries(s || {})) {
      if (key === 'stopped') out.stopped = out.stopped || !!value;
      else if (typeof value === 'number') out[key] = (out[key] ?? 0) + value;
      else if (value === null && !(key in out)) out[key] = null;
    }
  }
  return out;
}

/**
 * Run every lane, side by side ('parallel') or one after another
 * ('sequential'). One after another stops starting new lanes once shouldStop()
 * is true. Resolves to the lanes' results in lane order.
 */
export async function runLanes({ lanes, mode = 'parallel', runOne, shouldStop = () => false }) {
  if (mode === 'parallel') return Promise.all(lanes.map(lane => runOne(lane)));
  const results = [];
  for (const lane of lanes) {
    if (shouldStop()) break;
    results.push(await runOne(lane));
  }
  return results;
}

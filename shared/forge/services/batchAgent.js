export function batchExecutionIdentity({
  backend = 'model', providerId = null, modelId = null,
  agentId = null, agentModel = null,
} = {}) {
  return backend === 'agent'
    ? { backend: 'agent', agent: agentId || null, agentModel: agentModel || null }
    : { backend: 'model', providerId: providerId || null, modelId: modelId || null };
}

export function matchesBatchExecution(meta = {}, identity = {}) {
  if (identity.backend === 'agent') {
    return meta.backend === 'agent'
      && meta.agent === identity.agent
      && (meta.agentModel || null) === (identity.agentModel || null);
  }
  return meta.backend !== 'agent'
    && meta.providerId === identity.providerId
    && meta.modelId === identity.modelId;
}

export function assertBatchExecutor({ backend = 'model', modelId, agentId } = {}) {
  if (backend === 'agent' && !agentId) throw new Error('Pick a CLI agent before starting the batch.');
  if (backend !== 'agent' && !modelId) throw new Error('Pick an in-app model before starting the batch.');
}

export async function runCliBatchGeneration({
  agentId,
  agentModel = null,
  prompt,
  projectDir,
  projectHandle,
  budgets,
  abortSignal,
  runAgent,
  listAgentRuns,
  readProjectTree,
  onStart,
  onEvent,
}) {
  const startedAt = Date.now();
  const events = [];
  let bridgeRunId = null;
  let doneEvent = null;
  let stopReason = 'done';
  let error = null;

  try {
    const agentResult = await runAgent({
      agent: agentId,
      prompt,
      projectDir,
      options: agentModel ? { model: agentModel } : {},
      budgets,
      signal: abortSignal,
      onStart: id => {
        bridgeRunId = id;
        onStart?.(id);
      },
      onEvent: event => {
        events.push(event);
        onEvent?.(event, events.length - 1, bridgeRunId);
        if (event.type === 'error') {
          error = event.message || 'CLI agent reported an error.';
          stopReason = event.budgetCode ? 'budget' : 'agent_error';
        }
      },
    });
    bridgeRunId = agentResult.runId || bridgeRunId;
    doneEvent = agentResult.doneEvent;
    if (abortSignal?.aborted) stopReason = 'cancelled';
    else if (!doneEvent && stopReason === 'done') stopReason = 'bridge_finished_without_done';
    else if ((doneEvent?.exitCode ?? 0) !== 0 && stopReason === 'done') stopReason = 'agent_error';
  } catch (agentError) {
    stopReason = abortSignal?.aborted ? 'cancelled' : 'bridge_error';
    error = agentError.message;
  }

  let files = 0;
  let totalBytes = 0;
  let images = 0;
  let imagePixels = 0;
  try {
    const tree = await readProjectTree(projectHandle);
    files = tree.size;
    for (const file of tree.values()) totalBytes += file.size || 0;
  } catch { /* validation reports inaccessible output */ }
  try {
    const bridge = (await listAgentRuns()).runs?.find(item => item.runId === bridgeRunId);
    const usage = bridge?.projectUsage;
    if (usage) {
      files = usage.files ?? files;
      totalBytes = usage.totalBytes ?? totalBytes;
      images = usage.images || 0;
      imagePixels = usage.imagePixels || 0;
    }
    if (bridge?.budgetStop) {
      stopReason = 'budget';
      error = bridge.budgetStop.reason;
    }
  } catch { /* the event trace remains authoritative */ }

  const telemetry = {
    agent: agentId,
    model: agentModel || null,
    files,
    filesWritten: files,
    bytesWritten: totalBytes,
    elapsedMs: Date.now() - startedAt,
    costUsd: doneEvent?.costUsd ?? null,
    turns: doneEvent?.numTurns ?? null,
    promptTokens: doneEvent?.usage?.inputTokens ?? null,
    completionTokens: doneEvent?.usage?.outputTokens ?? null,
  };
  const tokens = (telemetry.promptTokens || 0) + (telemetry.completionTokens || 0);
  const budget = {
    limits: budgets,
    usage: {
      files, totalBytes, images, imagePixels, tokens,
      costUsd: telemetry.costUsd, turns: telemetry.turns,
    },
    decision: stopReason === 'budget'
      ? { allowed: false, code: 'agent_budget', reason: error || 'Agent budget exceeded' }
      : { allowed: true, reason: null },
  };

  return {
    stopReason,
    error,
    bridgeRunId,
    events,
    telemetry,
    doneSummary: doneEvent?.summary || null,
    budget,
  };
}

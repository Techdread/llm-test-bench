// Batch build — run one AI executor over many library games in a row. Mirrors
// prompt-gallery's batchRunner / tool-calling-lab's benchmarkRunner shape.
// Each game is a fresh, append-only run (createRun → runBuild → writeMeta).

import {
  createRun, writeMeta, patchMeta, writeTrace, createTraceAppender,
  writeValidation, writeRunArtifact, listRuns,
} from './runStore.js';
import { promptGameSlug } from './library.js';
import { normalizeBudgets } from './budgets.js';
import {
  provisionProjectLibraries, withProjectLibraryBudget,
} from './projectLibraries.js';
import { readProjectTree } from './previewer.js';
import { listAgentRuns, runAgent } from './agentBackend.js';
import {
  assertBatchExecutor, batchExecutionIdentity, matchesBatchExecution,
  runCliBatchGeneration,
} from '../../shared/forge/services/batchAgent.js';
import { createForgeKernel } from './forgeKernel.js';
import { getDomainAdapter } from '../adapters/registry.js';

const DEFAULT_KERNEL = createForgeKernel(getDomainAdapter('vr'));

/**
 * @param {Object} p
 * @param {Array}  p.games         library prompts to build
 * @param {string} p.providerId
 * @param {string} p.modelId
 * @param {string} p.modelName
 * @param {number} [p.maxTurns]
 * @param {boolean}[p.skipExisting] skip a game that already has a completed run for this model
 * @param {number} [p.delayMs]      pause between games (rate-limited providers)
 * @param {Function} p.onProgress   ({ phase, index, total, game, step?, result? })
 * @param {AbortSignal} p.abortSignal
 */
export async function runBatch({
  games, providerId, modelId, modelName,
  backend = 'model', agentId = null, agentModel = null,
  maxTurns = 40, skipExisting = false, delayMs = 0,
  budgets = {}, onProgress, abortSignal, forge = DEFAULT_KERNEL,
  runAgentFn = runAgent, listAgentRunsFn = listAgentRuns,
}) {
  assertBatchExecutor({ backend, modelId, agentId });
  budgets = normalizeBudgets({ ...budgets, maxTurns });
  const totals = { built: 0, failed: 0, skipped: 0, cancelled: 0 };
  const total = games.length;
  const identity = batchExecutionIdentity({ backend, providerId, modelId, agentId, agentModel });

  for (let i = 0; i < total; i++) {
    if (abortSignal?.aborted) { totals.cancelled++; break; }
    const game = games[i];
    const runBudgets = withProjectLibraryBudget(budgets, game.libraries);
    const gameSlug = promptGameSlug(game);
    onProgress?.({ phase: 'start', index: i, total, game });

    if (skipExisting) {
      try {
        const runs = await listRuns(gameSlug);
        if (runs.some(r => matchesBatchExecution(r.meta, identity)
          && ['passed', 'warned'].includes(r.meta?.status))) {
          totals.skipped++;
          onProgress?.({ phase: 'end', index: i, total, game, result: { status: 'skipped' } });
          continue;
        }
      } catch { /* treat as not-existing */ }
    }

    let run;
    try { run = await createRun(gameSlug, { backend, modelId, agentId, agentModel }); }
    catch (e) {
      totals.failed++;
      onProgress?.({ phase: 'end', index: i, total, game, result: { status: 'error', error: e.message } });
      continue;
    }

    const projectDir = `vr-forge/projects/${gameSlug}/${run.runId}/project`;
    const traceAppender = createTraceAppender(run.runDir);
    await writeMeta(run.runDir, {
      ...forge.baseRunMetadata({
        task: game, runId: run.runId, artifactSlug: gameSlug, backend,
        budgets: runBudgets, createdAt: new Date().toISOString(),
      }),
      ...identity,
      modelName: backend === 'model' ? modelName : null,
      capabilityPolicy: backend === 'agent'
        ? { allowed: ['external-agent.project-shell'], enforcedBy: 'serve.py bridge' }
        : {
          allowed: forge.capabilities(game, { imageAssets: false }),
          policies: forge.adapter.capabilityPolicies || {},
        },
      batch: true,
    });
    try {
      const provisioned = await provisionProjectLibraries(
        run.projectHandle,
        game.libraries,
        { targetStack: game.targetStack || 'web' },
      );
      if (provisioned.length) {
        await patchMeta(run.runDir, { provisionedLibraries: provisioned });
        await traceAppender.append({
          type: 'provision', libraries: provisioned, timestamp: new Date().toISOString(),
        });
      }
    } catch (provisionError) {
      const records = provisionError.records || [{
        id: 'unknown', label: 'Project library', version: null,
        files: [], bytes: 0, status: 'failed', error: provisionError.message,
      }];
      await patchMeta(run.runDir, {
        status: 'failed', stopReason: 'library_provision_error',
        error: provisionError.message, provisionedLibraries: records,
        generationStoppedAt: new Date().toISOString(),
      });
      await traceAppender.append({
        type: 'provision', libraries: records, error: provisionError.message,
        timestamp: new Date().toISOString(),
      });
      await traceAppender.flush();
      totals.failed++;
      onProgress?.({
        phase: 'end', index: i, total, game,
        result: { status: 'error', error: provisionError.message },
      });
      continue;
    }
    await patchMeta(run.runDir, { status: 'generating', generationStartedAt: new Date().toISOString() });

    let status = 'stopped', stopReason = 'done', error = null, result = null;
    const traceSteps = [];
    if (backend === 'agent') {
      const agentResult = await runCliBatchGeneration({
        agentId, agentModel,
        prompt: forge.externalAgentTask(game),
        projectDir, projectHandle: run.projectHandle,
        budgets: runBudgets, abortSignal,
        runAgent: runAgentFn, listAgentRuns: listAgentRunsFn, readProjectTree,
        onStart: id => patchMeta(run.runDir, { bridgeRunId: id }).catch(() => {}),
        onEvent: (event, eventIndex, bridgeRunId) => {
          traceAppender.append({ backend: 'agent', bridgeRunId, index: eventIndex, event, timestamp: new Date().toISOString() });
          onProgress?.({ phase: 'step', index: i, total, game, step: event });
        },
      });
      stopReason = agentResult.stopReason;
      error = agentResult.error;
      result = agentResult;
      await writeTrace(run.runDir, agentResult.events);
      await writeRunArtifact(run.runDir, 'capability-audit.json', JSON.stringify({
        schemaVersion: 1, backend: 'agent',
        agent: agentId, agentModel: agentModel || null,
        bridgeRunId: agentResult.bridgeRunId,
        allowedCapabilities: ['external-agent.project-shell'],
        enforcedBy: 'serve.py bridge', traceArtifact: 'trace.jsonl',
      }, null, 2));
    } else {
      try {
        result = await forge.runModelBuild({
          task: game, providerId, modelId,
          directoryHandle: run.projectHandle, maxTurns,
          imageAssets: false, budgets: runBudgets, abortSignal,
          onStep: (step) => {
            const at = traceSteps.findIndex(item => item.turn === step.turn);
            if (at >= 0) traceSteps[at] = step; else traceSteps.push(step);
            traceAppender.append({ backend: 'model', event: 'step', step, timestamp: new Date().toISOString() });
            onProgress?.({ phase: 'step', index: i, total, game, step });
          },
        });
        stopReason = result.stopReason;
      } catch (modelError) {
        if (abortSignal?.aborted || modelError.message === 'Run cancelled') stopReason = 'cancelled';
        else if (modelError.name === 'TimeoutError' || /timed out|no model output/i.test(modelError.message)) stopReason = 'idle_timeout';
        else stopReason = 'model_error';
        error = modelError.message;
      }
      await writeTrace(run.runDir, result?.steps || traceSteps);
      await writeRunArtifact(run.runDir, 'capability-audit.json', JSON.stringify({
        schemaVersion: 1,
        backend: 'model',
        adapterId: forge.adapter.id,
        allowedCapabilities: result?.capabilities || forge.capabilities(game, { imageAssets: false }),
        policies: result?.capabilityPolicies || {},
        records: result?.capabilityAudit || [],
      }, null, 2));
    }

    await traceAppender.flush();
    const capabilityPolicy = backend === 'agent'
      ? { allowed: ['external-agent.project-shell'], enforcedBy: 'serve.py bridge', auditedBy: 'trace.jsonl' }
      : {
        allowed: result?.capabilities || forge.capabilities(game, { imageAssets: false }),
        policies: result?.capabilityPolicies || {},
        auditCount: result?.capabilityAudit?.length || 0,
        auditArtifact: 'capability-audit.json',
      };
    await patchMeta(run.runDir, {
      status: 'stopped', stopReason, error,
      telemetry: result?.telemetry || null,
      doneSummary: result?.doneSummary || null,
      budget: result?.budget || null,
      bridgeRunId: backend === 'agent' ? result?.bridgeRunId || null : null,
      capabilityPolicy,
      generationStoppedAt: new Date().toISOString(),
    });
    await patchMeta(run.runDir, { status: 'validating', validationStartedAt: new Date().toISOString() });
    let report;
    try {
      report = await forge.validate({
        projectHandle: run.projectHandle, projectDir,
        stack: game.targetStack || 'web', budgets: runBudgets,
        libraries: game.libraries, stopReason,
      });
    } catch (validationError) {
      report = {
        schemaVersion: 1, kind: 'validator', checkedAt: new Date().toISOString(),
        status: 'failed', issues: [{ severity: 'error', code: 'validator_crash', message: validationError.message }],
        screenshot: null,
      };
    }
    await writeValidation(run.runDir, report);
    if (report.screenshot) await writeRunArtifact(run.runDir, 'preview.png', report.screenshot);
    status = report.status;
    await patchMeta(run.runDir, {
      status,
      validation: {
        status, checkedAt: report.checkedAt, issueCount: report.issues.length,
        errorCount: report.issues.filter(issue => issue.severity === 'error').length,
        warningCount: report.issues.filter(issue => issue.severity === 'warning').length,
        screenshot: !!report.screenshot,
      },
      validationFinishedAt: new Date().toISOString(),
    });

    if (status === 'passed' || status === 'warned') totals.built++;
    else if (stopReason === 'cancelled') totals.cancelled++;
    else totals.failed++;

    onProgress?.({ phase: 'end', index: i, total, game, result: {
      status, stopReason, error, runId: run.runId,
      telemetry: result?.telemetry || null, validation: report,
    } });

    if (stopReason === 'cancelled') break;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }

  onProgress?.({ phase: 'done', ...totals });
  return totals;
}

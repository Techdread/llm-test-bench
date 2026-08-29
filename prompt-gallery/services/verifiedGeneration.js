import {
  applySandboxAuthority,
  computeVerificationVerdict,
  deriveAcceptanceChecklist,
  normalizeAudit,
  unresolvedMustChecks,
} from './acceptance.js';

function nowIso() { return new Date().toISOString(); }
function stopRequested(fn) { try { return !!fn?.(); } catch (e) { return false; } }
function htmlHash(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function nullableNumber(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function resultValue(result, keys) {
  if (typeof result === 'string') return result;
  for (const key of keys) if (typeof result?.[key] === 'string') return result[key];
  return '';
}
function resultStats(result, captured) { return result?.stats || result?.usage || captured || null; }

function compactSandbox(status) {
  return {
    ok: !!status?.ok,
    timedOut: !!status?.timedOut,
    errorCount: (status?.errors || []).length,
    warningCount: (status?.warnings || []).length,
    duration: Number(status?.duration) || 0,
    errors: (status?.errors || []).slice(0, 20).map(error => String(error).slice(0, 1000)),
    evidence: status?.evidence || {},
  };
}

function telemetryTotals(calls, startedAt) {
  const prompt = calls.map(call => call.usage?.promptTokens).filter(Number.isFinite);
  const response = calls.map(call => call.usage?.responseTokens ?? call.usage?.completionTokens).filter(Number.isFinite);
  const costs = calls.map(call => call.usage?.estimatedCost).filter(Number.isFinite);
  return {
    calls,
    promptTokens: prompt.length ? prompt.reduce((sum, n) => sum + n, 0) : null,
    responseTokens: response.length ? response.reduce((sum, n) => sum + n, 0) : null,
    estimatedCost: costs.length ? costs.reduce((sum, n) => sum + n, 0) : null,
    durationMs: Date.now() - startedAt,
  };
}

export async function runVerifiedGeneration({ promptItem, model, options, deps, onEvent, shouldStop, waitIfPaused }) {
  const opts = { maxRepairRounds: 1, apiRetries: 0, ...(options || {}) };
  opts.maxRepairRounds = Math.max(0, Math.min(2, Number(opts.maxRepairRounds) || 0));
  opts.apiRetries = Math.max(0, Number(opts.apiRetries) || 0);
  const emit = event => { try { onEvent?.(event); } catch (e) { /* listener isolation */ } };
  const startedAt = Date.now();
  const calls = [];
  const checklist = deriveAcceptanceChecklist(promptItem);
  const savedIds = [];
  const candidates = [];
  let previousSaved = null;
  let previousFailedIds = null;
  let previousSandboxFailed = false;
  let stopped = false;

  const checkStop = phase => {
    if (!stopRequested(shouldStop)) return false;
    stopped = true;
    emit({ type: 'state', status: 'stopped', phase });
    return true;
  };

  async function callRole(role, operation, args) {
    let lastError;
    for (let attempt = 0; attempt <= opts.apiRetries; attempt++) {
      if (checkStop(`${role}_before`)) return { stopped: true };
      await waitIfPaused?.({ phase: `before-${role}`, role, attempt, promptItem, model });
      if (checkStop(`${role}_paused`)) return { stopped: true };
      const began = Date.now();
      let capturedStats = null;
      try {
        const value = await operation({ ...args, onStats: stats => { capturedStats = stats; } });
        const stats = resultStats(value, capturedStats) || {};
        calls.push({
          role, providerId: model?.providerId || '', modelId: model?.modelId || '',
          startedAt: new Date(began).toISOString(), finishedAt: nowIso(), durationMs: Date.now() - began,
          usage: {
            promptTokens: nullableNumber(stats.promptTokens),
            responseTokens: nullableNumber(stats.responseTokens ?? stats.completionTokens),
            estimatedCost: nullableNumber(stats.estimatedCost ?? stats.cost),
          },
          outcome: 'ok', attempt,
        });
        if (checkStop(`${role}_after`)) return { stopped: true };
        return { value };
      } catch (error) {
        lastError = error;
        calls.push({
          role, providerId: model?.providerId || '', modelId: model?.modelId || '',
          startedAt: new Date(began).toISOString(), finishedAt: nowIso(), durationMs: Date.now() - began,
          usage: { promptTokens: null, responseTokens: null, estimatedCost: null },
          outcome: 'error', attempt,
        });
        emit({ type: 'retry', role, attempt, message: error?.message || String(error) });
        if (checkStop(`${role}_error`)) return { stopped: true };
      }
    }
    throw lastError || new Error(`${role} failed`);
  }

  async function sandboxCandidate(html, phase) {
    if (checkStop(`${phase}_before`)) return null;
    emit({ type: 'state', status: 'checking', phase });
    let status;
    try { status = await deps.sandbox(html); }
    catch (error) { status = { ok: false, errors: [`Sandbox failed: ${error.message}`], warnings: [], logs: [], duration: 0, timedOut: false, evidence: {} }; }
    if (checkStop(`${phase}_after`)) return null;
    return status;
  }

  async function verifyCandidate(html, round) {
    const candidate = round === 0 ? 'original' : 'repair';
    const phaseSuffix = round === 0 ? 'original' : `repair_${round}`;
    const sandbox = await sandboxCandidate(html, `checking_${phaseSuffix}`);
    if (!sandbox) return null;
    emit({ type: 'state', status: 'auditing', phase: `auditing_${phaseSuffix}`, round });
    let audit;
    let auditError = null;
    try {
      const response = await callRole(round === 0 ? 'auditor' : 're-auditor', deps.audit, {
        promptItem, checklist, html, sandbox, model,
      });
      if (response.stopped) return null;
      audit = normalizeAudit(resultValue(response.value, ['text', 'content', 'response']) || response.value, checklist);
    } catch (error) {
      auditError = error;
      audit = normalizeAudit({ checks: [], repairTasks: [], notes: `Audit failed: ${error.message}` }, checklist);
    }
    audit = applySandboxAuthority(audit, checklist, sandbox, html);
    const verdict = computeVerificationVerdict(checklist, audit, sandbox, { auditError: !!auditError });
    return { candidate, round, html, sandbox, audit, verdict, auditError };
  }

  async function saveCandidate(candidate, stopReason) {
    if (checkStop(`saving_${candidate.candidate}_${candidate.round}_before`)) return null;
    emit({ type: 'state', status: 'saving', phase: `saving_${candidate.candidate}_${candidate.round}`, round: candidate.round });
    const telemetry = telemetryTotals(calls, startedAt);
    const statusTag = candidate.verdict.status === 'passed' ? 'verified-pass'
      : candidate.verdict.status === 'warned' ? 'verified-warn' : 'verified-fail';
    const verification = {
      schemaVersion: 1,
      mode: 'verified',
      runId: options?.runId || '',
      candidate: candidate.candidate,
      round: candidate.round,
      status: candidate.verdict.status,
      stopReason,
      checklist,
      audit: candidate.audit,
      verdict: candidate.verdict,
      sandbox: compactSandbox(candidate.sandbox),
      telemetry,
    };
    const saved = await deps.save({
      prompt: promptItem,
      promptText: promptItem.prompt,
      response: candidate.html,
      model,
      tags: ['ai-gen', 'batch', 'verified', statusTag, ...((promptItem.tags || []).filter(Boolean))],
      kind: candidate.candidate === 'original' ? 'verified-original' : 'verified-repair',
      verification,
      derivedFrom: previousSaved?.variantKey || '',
      repairRound: candidate.round,
    });
    previousSaved = saved || null;
    if (saved?.id) savedIds.push(saved.id);
    candidates.push({ ...candidate, saved });
    emit({ type: 'candidate', candidate: candidate.candidate, round: candidate.round, status: candidate.verdict.status, saved, verification });
    if (checkStop(`saving_${candidate.candidate}_${candidate.round}_after`)) return saved;
    return saved;
  }

  emit({ type: 'state', status: 'planning', phase: 'planning', checklist });
  if (checkStop('planning')) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };

  emit({ type: 'state', status: 'generating', phase: 'generating' });
  let generated;
  try {
    const response = await callRole('generator', deps.generate, {
      prompt: promptItem.prompt, promptItem, checklist, model,
      onChunk: html => emit({ type: 'chunk', html }),
    });
    if (response.stopped) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    generated = resultValue(response.value, ['html', 'text', 'content', 'response']);
  } catch (error) {
    return { status: 'generation_error', stopReason: 'generation_error', error, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
  }
  if (!generated.trim()) return { status: 'generation_error', stopReason: 'generation_error', error: new Error('Model returned an empty response'), savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };

  let current = await verifyCandidate(generated, 0);
  if (!current) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
  const originalStopReason = current.verdict.status === 'failed' && opts.maxRepairRounds === 0
    ? 'budget' : current.verdict.status;
  try { await saveCandidate(current, originalStopReason); }
  catch (error) { return { status: 'save_error', stopReason: 'save_error', error, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) }; }
  if (stopped) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };

  if (['passed', 'warned', 'audit_error'].includes(current.verdict.status)) {
    emit({ type: 'state', status: current.verdict.status, phase: 'complete' });
    return { status: current.verdict.status, stopReason: current.verdict.status, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
  }

  let previousHash = htmlHash(generated);
  previousFailedIds = unresolvedMustChecks(checklist, current.audit).map(check => check.id).sort();
  previousSandboxFailed = !!(current.sandbox?.timedOut || current.sandbox?.errors?.length);

  for (let round = 1; round <= opts.maxRepairRounds; round++) {
    emit({ type: 'state', status: 'repairing', phase: `repairing_${round}`, round });
    let repaired;
    try {
      const response = await callRole('repairer', deps.repair, {
        promptItem, checklist, html: current.html, sandbox: current.sandbox,
        failedChecks: unresolvedMustChecks(checklist, current.audit),
        repairTasks: current.audit.repairTasks || [], model,
        onChunk: html => emit({ type: 'chunk', html }),
      });
      if (response.stopped) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
      repaired = resultValue(response.value, ['html', 'text', 'content', 'response']);
    } catch (error) {
      return { status: 'repair_error', stopReason: 'repair_error', error, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    }
    if (!repaired.trim()) return { status: 'repair_error', stopReason: 'repair_error', error: new Error('Repair returned an empty response'), savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };

    const identical = htmlHash(repaired) === previousHash;
    current = await verifyCandidate(repaired, round);
    if (!current) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    const failedIds = unresolvedMustChecks(checklist, current.audit).map(check => check.id).sort();
    const sandboxFailed = !!(current.sandbox?.timedOut || current.sandbox?.errors?.length);
    const unchangedFailures = failedIds.join('|') === previousFailedIds.join('|') && !(previousSandboxFailed && !sandboxFailed);
    const noProgress = identical || unchangedFailures;
    const stopReason = noProgress ? 'no_progress'
      : current.verdict.status === 'failed' && round === opts.maxRepairRounds
        ? 'max_repairs' : current.verdict.status;
    try { await saveCandidate(current, stopReason); }
    catch (error) { return { status: 'save_error', stopReason: 'save_error', error, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) }; }
    if (stopped) return { status: 'stopped', stopReason: 'stopped', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    if (identical) {
      emit({ type: 'state', status: 'no_progress', phase: 'complete', round });
      return { status: 'no_progress', stopReason: 'no_progress', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    }
    if (['passed', 'warned', 'audit_error'].includes(current.verdict.status)) {
      emit({ type: 'state', status: current.verdict.status, phase: 'complete', round });
      return { status: current.verdict.status, stopReason: current.verdict.status, savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    }
    if (unchangedFailures) {
      emit({ type: 'state', status: 'no_progress', phase: 'complete', round });
      return { status: 'no_progress', stopReason: 'no_progress', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
    }
    previousHash = htmlHash(repaired);
    previousFailedIds = failedIds;
    previousSandboxFailed = sandboxFailed;
  }

  const status = opts.maxRepairRounds === 0 ? 'budget' : 'failed';
  emit({ type: 'state', status, phase: 'complete' });
  return { status, stopReason: opts.maxRepairRounds === 0 ? 'budget' : 'max_repairs', savedIds, candidates, checklist, telemetry: telemetryTotals(calls, startedAt) };
}

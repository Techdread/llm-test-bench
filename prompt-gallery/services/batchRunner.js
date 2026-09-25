// Batch Runner — drive one model over a list of prompts, one prompt at a time.
// Generation, sandbox-checking, healing, and saving are all injected via `deps`
// so this stays app-agnostic and unit-testable. Progress is reported through a
// single `onEvent` callback; the caller can stop the run at any point by making
// `shouldStop()` return true.
//
// Events emitted (event.type):
//   'item'    — status change for one prompt: { index, status, ... }
//               status ∈ start|generating|checking|healing|saved|skipped|error|stopped
//   'chunk'   — streaming HTML for the current prompt: { index, html }
//   'preview' — final HTML for the current prompt (drives the live preview): { index, html }
//   'log'     — a human-readable note: { index, message }
//   'done'    — the whole run finished: { summary }

import { runVerifiedGeneration } from './verifiedGeneration.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep in short slices so Stop/Pause presses are honoured mid-delay.
async function interruptibleDelay(ms, shouldStop, shouldPause) {
  const step = 200;
  let waited = 0;
  while (waited < ms) {
    if (shouldStop() || shouldPause()) return;
    await sleep(Math.min(step, ms - waited));
    waited += step;
  }
}

function hasRuntimeErrors(runStatus) {
  return !!(runStatus && (runStatus.timedOut || (runStatus.errors && runStatus.errors.length)));
}

/**
 * @param {object}   cfg
 * @param {Array}    cfg.prompts   Library prompts to run: [{ id, title, prompt, tags, category }]
 * @param {object}   cfg.model     { providerId, modelId, label }
 * @param {object}   cfg.options   { heal, healAttempts, saveBothOnHeal, skipExisting, delayMs, apiRetries }
 * @param {object}   cfg.deps      Injected async ops:
 *   generate(promptText, { model, onChunk }) -> Promise<string html>
 *   runSandbox(html)                  -> Promise<{ errors, warnings, timedOut }>
 *   heal({ model, prompt, html, errors, onChunk }) -> Promise<string html>
 *   save({ prompt, promptText, response, model, tags, kind, healed, healAttempts, runStatus }) -> Promise<{ id }>
 *   hasExistingForModel(prompt, model) -> boolean
 * @param {Function} cfg.onEvent
 * @param {Function} cfg.shouldStop  () => boolean
 * @param {Function} cfg.shouldPause () => boolean
 * @param {Function} cfg.waitIfPaused async safe-boundary gate; resolves on resume
 * @returns {Promise<object>} summary
 */
export async function runBatch({ prompts, model, options, deps, onEvent, shouldStop, shouldPause, waitIfPaused }) {
  const opts = {
    mode: null,
    heal: false,
    healAttempts: 1,
    saveBothOnHeal: true,
    skipExisting: false,
    delayMs: 0,
    apiRetries: 0,
    ...(options || {}),
  };
  const mode = opts.mode || (opts.heal ? 'runtime-heal' : 'quick');
  const emit = (event) => { try { onEvent?.(event); } catch (e) { /* never let a listener break the run */ } };
  const stop = () => { try { return !!shouldStop?.(); } catch (e) { return false; } };
  const pause = () => { try { return !!shouldPause?.(); } catch (e) { return false; } };
  const pauseGate = async context => {
    if (!pause() || stop()) return;
    await waitIfPaused?.(context);
  };

  const summary = {
    total: prompts.length,
    generated: 0,
    healed: 0,
    skipped: 0,
    failed: 0,
    saved: 0,
    stopped: false,
    verifiedPassed: 0,
    verifiedWarned: 0,
    verifiedFailed: 0,
    auditErrors: 0,
    repairRounds: 0,
    roleCalls: 0,
    promptTokens: null,
    responseTokens: null,
    estimatedCost: null,
  };

  for (let i = 0; i < prompts.length; i++) {
    await pauseGate({ phase: 'before-prompt', index: i, prompt: prompts[i] });
    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }
    const p = prompts[i];
    emit({ type: 'item', index: i, status: 'start' });

    // Skip prompts that already have a variant for this model (resume support).
    if (opts.skipExisting) {
      let exists = false;
      try { exists = !!deps.hasExistingForModel?.(p, model); } catch (e) { exists = false; }
      if (exists) {
        summary.skipped++;
        emit({ type: 'item', index: i, status: 'skipped' });
        continue;
      }
    }

    // ── Verified strategy ──
    if (mode === 'verified') {
      const verified = await runVerifiedGeneration({
        promptItem: p,
        model,
        options: {
          maxRepairRounds: opts.maxRepairRounds,
          apiRetries: opts.apiRetries,
          runId: opts.runId || deps.runId || '',
        },
        deps: {
          generate: ({ prompt, promptItem, checklist, onChunk, onStats }) => deps.generate(prompt, {
            model, promptItem, checklist, onChunk,
            onStats: stats => {
              onStats?.(stats);
              emit({ type: 'stats', index: i, stats });
            },
          }),
          sandbox: html => deps.runSandbox(html),
          audit: args => deps.audit(args),
          repair: args => deps.repair({
            ...args,
            onStats: stats => {
              args.onStats?.(stats);
              emit({ type: 'stats', index: i, stats });
            },
          }),
          save: args => deps.save(args),
        },
        shouldStop: stop,
        waitIfPaused: context => pauseGate({ ...context, index: i, prompt: p }),
        onEvent: event => {
          if (event.type === 'chunk') emit({ type: 'chunk', index: i, html: event.html });
          if (event.type !== 'state') return;
          const map = {
            planning: 'planning', generating: 'generating', checking: 'checking', auditing: 'auditing',
            repairing: 'repairing', passed: 'verified', warned: 'warned', no_progress: 'no_progress', stopped: 'stopped',
          };
          const status = map[event.status];
          if (status) emit({ type: 'item', index: i, status, repairRound: event.round || 0 });
        },
      });

      const candidateCount = verified.candidates?.length || 0;
      if (candidateCount > 0) summary.generated++;
      summary.saved += verified.savedIds?.length || 0;
      summary.repairRounds += Math.max(0, candidateCount - 1);
      summary.roleCalls += verified.telemetry?.calls?.length || 0;
      for (const key of ['promptTokens', 'responseTokens', 'estimatedCost']) {
        const value = verified.telemetry?.[key];
        if (value != null) summary[key] = (summary[key] ?? 0) + value;
      }
      if (verified.status === 'passed') summary.verifiedPassed++;
      else if (verified.status === 'warned') summary.verifiedWarned++;
      else if (verified.status !== 'stopped') {
        summary.verifiedFailed++;
        summary.failed++;
      }
      if (verified.status === 'audit_error') summary.auditErrors++;
      if (verified.status === 'stopped') summary.stopped = true;
      const last = verified.candidates?.at(-1);
      if (last?.html) emit({ type: 'preview', index: i, html: last.html });
      const finalStatus = verified.status === 'passed' ? 'verified'
        : verified.status === 'warned' ? 'warned'
          : verified.status === 'no_progress' ? 'no_progress'
            : verified.status === 'stopped' ? 'stopped' : 'error';
      emit({
        type: 'item', index: i, status: finalStatus, savedIds: verified.savedIds || [],
        verificationStatus: verified.status, repairRounds: Math.max(0, candidateCount - 1),
        message: verified.error?.message || '',
      });
      if (verified.status === 'stopped') break;
      await interruptibleDelay(opts.delayMs, stop, pause);
      continue;
    }

    // ── Generate (with API-failure retries) ──
    let genHtml = '';
    let genError = null;
    for (let attempt = 0; attempt <= opts.apiRetries; attempt++) {
      await pauseGate({ phase: 'before-generation', role: 'generator', index: i, attempt, prompt: p });
      if (stop()) break;
      try {
        emit({ type: 'item', index: i, status: 'generating', attempt });
        genHtml = await deps.generate(p.prompt, {
          model,
          onChunk: (partial) => emit({ type: 'chunk', index: i, html: partial }),
          onStats: stats => emit({ type: 'stats', index: i, stats }),
        });
        genError = null;
        if (genHtml && genHtml.trim()) break;
        genError = new Error('Model returned an empty response');
      } catch (e) {
        genError = e;
      }
      if (genError) {
        emit({ type: 'log', index: i, message: `Generation attempt ${attempt + 1} failed: ${genError.message}` });
        if (attempt < opts.apiRetries && !stop()) await interruptibleDelay(1000 * (attempt + 1), stop, pause);
      }
    }

    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }
    if (genError || !genHtml || !genHtml.trim()) {
      summary.failed++;
      emit({ type: 'item', index: i, status: 'error', message: genError?.message || 'Empty response' });
      await interruptibleDelay(opts.delayMs, stop, pause);
      continue;
    }
    summary.generated++;

    const originalHtml = genHtml;
    let finalHtml = genHtml;
    let healed = false;
    let healUsed = 0;
    let runStatus = null;

    // ── Sandbox check + self-heal ──
    if (mode === 'runtime-heal') {
      emit({ type: 'item', index: i, status: 'checking' });
      try { runStatus = await deps.runSandbox(finalHtml); } catch (e) { runStatus = null; }
      while (hasRuntimeErrors(runStatus) && healUsed < opts.healAttempts) {
        await pauseGate({ phase: 'before-heal', role: 'healer', index: i, attempt: healUsed + 1, prompt: p });
        if (stop()) break;
        healUsed++;
        emit({ type: 'item', index: i, status: 'healing', healAttempt: healUsed });
        try {
          const fixed = await deps.heal({
            model,
            prompt: p.prompt,
            html: finalHtml,
            errors: (runStatus.errors && runStatus.errors.length) ? runStatus.errors : ['Execution timed out — possible infinite loop'],
            onChunk: (partial) => emit({ type: 'chunk', index: i, html: partial }),
            onStats: stats => emit({ type: 'stats', index: i, stats }),
          });
          if (fixed && fixed.trim()) {
            finalHtml = fixed;
            healed = true;
            try { runStatus = await deps.runSandbox(finalHtml); } catch (e) { runStatus = null; }
          } else {
            emit({ type: 'log', index: i, message: `Heal attempt ${healUsed} returned nothing` });
            break;
          }
        } catch (e) {
          emit({ type: 'log', index: i, message: `Heal attempt ${healUsed} failed: ${e.message}` });
          break;
        }
      }
      if (healed) summary.healed++;
    }

    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }

    // ── Save ──
    const baseTags = ['ai-gen', 'batch', ...((p.tags || []).filter(Boolean))];
    const savedIds = [];
    try {
      if (mode === 'runtime-heal' && healed && opts.saveBothOnHeal) {
        // Preserve the raw model output as its own variant, then the healed one.
        const orig = await deps.save({
          prompt: p, promptText: p.prompt, response: originalHtml,
          model, tags: baseTags, kind: 'original', healed: false, healAttempts: 0, runStatus: null,
        });
        if (orig?.id) savedIds.push(orig.id);
        const heal = await deps.save({
          prompt: p, promptText: p.prompt, response: finalHtml,
          model, tags: [...baseTags, 'healed'], kind: 'healed', healed: true, healAttempts: healUsed, runStatus,
        });
        if (heal?.id) savedIds.push(heal.id);
        summary.saved += 2;
      } else {
        const res = await deps.save({
          prompt: p, promptText: p.prompt, response: finalHtml,
          model, tags: healed ? [...baseTags, 'healed'] : baseTags,
          kind: healed ? 'healed' : 'original', healed, healAttempts: healUsed, runStatus,
        });
        if (res?.id) savedIds.push(res.id);
        summary.saved += 1;
      }
      emit({ type: 'preview', index: i, html: finalHtml });
      emit({ type: 'item', index: i, status: 'saved', savedIds, healed, healAttempts: healUsed, runStatus });
    } catch (e) {
      summary.failed++;
      emit({ type: 'item', index: i, status: 'error', message: 'Save failed: ' + e.message });
    }

    await interruptibleDelay(opts.delayMs, stop, pause);
  }

  emit({ type: 'done', summary });
  return summary;
}

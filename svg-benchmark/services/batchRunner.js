// Batch Runner for SVG Benchmark — drive one model over a list of prompts,
// one at a time: generate SVG → validate → (optionally) heal invalid SVG →
// auto-score against the reference if one exists → save as a submission.
//
// All side effects are injected via `deps` so this stays testable and
// app-agnostic. Progress is reported through `onEvent`; the caller stops a run
// by making `shouldStop()` return true.
//
// Events (event.type):
//   'item'    — status change: { index, status, ... }
//               status ∈ start|generating|validating|healing|scoring|saved|skipped|error|stopped
//   'preview' — final SVG markup for the current prompt: { index, svg }
//   'chunk'   — streaming SVG markup: { index, svg }
//   'log'     — a note: { index, message }
//   'done'    — run finished: { summary }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function interruptibleDelay(ms, shouldStop) {
  const step = 200;
  let waited = 0;
  while (waited < ms) {
    if (shouldStop()) return;
    await sleep(Math.min(step, ms - waited));
    waited += step;
  }
}

export async function runBatch({ prompts, model, options, deps, onEvent, shouldStop }) {
  const opts = {
    heal: false,
    healAttempts: 1,
    saveBothOnHeal: true,
    skipExisting: false,
    delayMs: 0,
    apiRetries: 0,
    ...(options || {}),
  };
  const emit = (event) => { try { onEvent?.(event); } catch (e) { /* ignore listener errors */ } };
  const stop = () => { try { return !!shouldStop?.(); } catch (e) { return false; } };

  const summary = {
    total: prompts.length,
    generated: 0,
    healed: 0,
    scored: 0,
    skipped: 0,
    failed: 0,
    saved: 0,
    stopped: false,
  };

  for (let i = 0; i < prompts.length; i++) {
    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }
    const p = prompts[i];
    emit({ type: 'item', index: i, status: 'start' });

    if (opts.skipExisting) {
      let exists = false;
      try { exists = !!deps.hasExistingForModel?.(p, model); } catch (e) { exists = false; }
      if (exists) {
        summary.skipped++;
        emit({ type: 'item', index: i, status: 'skipped' });
        continue;
      }
    }

    // Make sure a benchmark folder exists for this prompt (created only if missing).
    let slug = '';
    try {
      slug = await deps.ensureBenchmark(p);
    } catch (e) {
      summary.failed++;
      emit({ type: 'item', index: i, status: 'error', message: 'Benchmark create failed: ' + e.message });
      await interruptibleDelay(opts.delayMs, stop);
      continue;
    }

    // ── Generate (with API-failure retries) ──
    // `p.params` is the sampling/reasoning parameter set for this job. An empty
    // object means "server defaults" — nothing goes on the wire.
    let svg = '';
    let genError = null;
    let genStats = null;
    for (let attempt = 0; attempt <= opts.apiRetries; attempt++) {
      if (stop()) break;
      try {
        emit({ type: 'item', index: i, status: 'generating', attempt });
        svg = await deps.generate(p.prompt, {
          params: p.params,
          onChunk: (partial) => emit({ type: 'chunk', index: i, svg: partial }),
          onStats: (s) => { genStats = s; emit({ type: 'stats', index: i, stats: s }); },
        });
        genError = null;
        if (svg && svg.trim()) break;
        // A thinking model that hits the token cap mid-thought returns nothing
        // at all — say so, because "empty response" sends you hunting the wrong bug.
        genError = new Error(genStats?.thought && genStats?.finishReason === 'length'
          ? `Model spent its entire token budget thinking (${genStats.reasoningTokens} reasoning tokens) — raise Max Tokens`
          : 'Model returned an empty response');
      } catch (e) {
        genError = e;
      }
      if (genError) {
        emit({ type: 'log', index: i, message: `Generation attempt ${attempt + 1} failed: ${genError.message}` });
        if (attempt < opts.apiRetries && !stop()) await interruptibleDelay(1000 * (attempt + 1), stop);
      }
    }

    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }
    if (genError || !svg || !svg.trim()) {
      summary.failed++;
      emit({ type: 'item', index: i, status: 'error', message: genError?.message || 'Empty response' });
      await interruptibleDelay(opts.delayMs, stop);
      continue;
    }
    summary.generated++;

    const originalSvg = svg;
    let finalSvg = svg;
    let healed = false;
    let healUsed = 0;

    // ── Validate + heal invalid SVG ──
    emit({ type: 'item', index: i, status: 'validating' });
    let validity = deps.validate(finalSvg);
    if (opts.heal) {
      while (!validity.ok && healUsed < opts.healAttempts) {
        if (stop()) break;
        healUsed++;
        emit({ type: 'item', index: i, status: 'healing', healAttempt: healUsed });
        try {
          const fixed = await deps.heal({
            prompt: p.prompt, svg: finalSvg, reason: validity.reason, params: p.params,
            onChunk: (partial) => emit({ type: 'chunk', index: i, svg: partial }),
          });
          if (fixed && fixed.trim()) {
            finalSvg = fixed;
            healed = true;
            validity = deps.validate(finalSvg);
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
    emit({ type: 'preview', index: i, svg: finalSvg });

    // ── Auto-score against the reference (if the benchmark has one) ──
    let autoScore = null;
    try {
      emit({ type: 'item', index: i, status: 'scoring' });
      autoScore = await deps.score(finalSvg, slug);
      if (autoScore != null) summary.scored++;
    } catch (e) {
      emit({ type: 'log', index: i, message: `Auto-score failed: ${e.message}` });
    }

    if (stop()) { summary.stopped = true; emit({ type: 'item', index: i, status: 'stopped' }); break; }

    // ── Save submission(s) ──
    const savedIds = [];
    try {
      if (opts.heal && healed && opts.saveBothOnHeal) {
        const orig = await deps.save({
          prompt: p, svg: originalSvg, model, slug, autoScore: null,
          kind: 'original', healed: false, healAttempts: 0, valid: false,
          params: p.params, stats: genStats,
        });
        if (orig?.id) savedIds.push(orig.id);
        const fixed = await deps.save({
          prompt: p, svg: finalSvg, model, slug, autoScore,
          kind: 'healed', healed: true, healAttempts: healUsed, valid: validity.ok,
          params: p.params, stats: genStats,
        });
        if (fixed?.id) savedIds.push(fixed.id);
        summary.saved += 2;
      } else {
        const res = await deps.save({
          prompt: p, svg: finalSvg, model, slug, autoScore,
          kind: healed ? 'healed' : 'original', healed, healAttempts: healUsed, valid: validity.ok,
          params: p.params, stats: genStats,
        });
        if (res?.id) savedIds.push(res.id);
        summary.saved += 1;
      }
      emit({ type: 'item', index: i, status: 'saved', savedIds, healed, valid: validity.ok, autoScore, stats: genStats });
    } catch (e) {
      summary.failed++;
      emit({ type: 'item', index: i, status: 'error', message: 'Save failed: ' + e.message });
    }

    await interruptibleDelay(opts.delayMs, stop);
  }

  emit({ type: 'done', summary });
  return summary;
}

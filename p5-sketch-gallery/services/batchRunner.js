// Sequential batch runner for p5 Sketch Gallery. All filesystem, model, and
// preview work is injected through deps, keeping queue behaviour deterministic
// and directly testable under node.

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function interruptibleDelay(ms, shouldStop) {
  let remaining = Math.max(0, ms || 0);
  while (remaining > 0) {
    if (shouldStop()) return;
    const step = Math.min(200, remaining);
    await sleep(step);
    remaining -= step;
  }
}

export function validateSketchCode(source) {
  const code = String(source || '').trim();
  if (!code) return { ok: false, reason: 'Model returned an empty response' };
  if (!/\bfunction\s+sketch\s*\(\s*p\s*,\s*ctx\s*\)/.test(code)) {
    return { ok: false, reason: 'Missing function sketch(p, ctx)' };
  }
  try {
    // Compile only; do not execute model-written top-level code here.
    new Function(code);
  } catch (error) {
    return { ok: false, reason: `JavaScript syntax error: ${error.message}` };
  }
  return { ok: true, reason: '' };
}

export async function runBatch({ prompts, model, options, deps, onEvent, shouldStop }) {
  const opts = {
    skipExisting: false,
    apiRetries: 1,
    delayMs: 0,
    retryDelayMs: 1000,
    captureThumbnails: true,
    ...(options || {}),
  };
  const emit = event => {
    try { onEvent?.(event); } catch (error) { /* listeners cannot break a run */ }
  };
  const stop = () => {
    try { return !!shouldStop?.(); } catch (error) { return false; }
  };
  const summary = {
    total: prompts.length,
    generated: 0,
    rendered: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    stopped: false,
  };

  for (let index = 0; index < prompts.length; index++) {
    if (stop()) {
      summary.stopped = true;
      emit({ type: 'item', index, status: 'stopped' });
      break;
    }

    const prompt = prompts[index];
    emit({ type: 'item', index, status: 'start' });
    if (opts.skipExisting && deps.hasExistingForModel?.(prompt, model)) {
      summary.skipped++;
      emit({ type: 'item', index, status: 'skipped' });
      continue;
    }

    let code = '';
    let stats = null;
    let generationError = null;
    for (let attempt = 0; attempt <= opts.apiRetries; attempt++) {
      if (stop()) break;
      try {
        emit({ type: 'item', index, status: 'generating', attempt });
        code = await deps.generate(prompt.prompt, {
          params: prompt.generationParams || {},
          onChunk: partial => emit({ type: 'chunk', index, code: partial || '' }),
          onStats: value => {
            stats = value;
            emit({ type: 'stats', index, stats: value });
          },
        });
        generationError = code?.trim() ? null : new Error(
          stats?.thought && stats?.finishReason === 'length'
            ? `Model spent its token budget thinking (${stats.reasoningTokens || 0} reasoning tokens)`
            : 'Model returned an empty response',
        );
        if (!generationError) break;
      } catch (error) {
        generationError = error;
      }
      emit({ type: 'log', index, message: `Attempt ${attempt + 1} failed: ${generationError.message}` });
      if (attempt < opts.apiRetries && !stop()) await interruptibleDelay(opts.retryDelayMs * (attempt + 1), stop);
    }

    if (stop()) {
      summary.stopped = true;
      emit({ type: 'item', index, status: 'stopped' });
      break;
    }
    if (generationError) {
      summary.failed++;
      emit({ type: 'item', index, status: 'error', message: generationError.message });
      await interruptibleDelay(opts.delayMs, stop);
      continue;
    }
    summary.generated++;

    emit({ type: 'item', index, status: 'validating' });
    const validity = deps.validate(code);
    if (!validity.ok) {
      summary.failed++;
      emit({ type: 'item', index, status: 'error', message: validity.reason || 'Invalid p5 sketch' });
      await interruptibleDelay(opts.delayMs, stop);
      continue;
    }

    const sketchParams = deps.extractParams?.(code) || {};
    const sketchSeed = deps.seedFor?.(prompt, index) ?? (index + 1);
    emit({ type: 'preview', index, code, params: sketchParams, seed: sketchSeed });

    let thumbnailDataUrl = null;
    if (opts.captureThumbnails && deps.capture) {
      emit({ type: 'item', index, status: 'rendering' });
      try {
        thumbnailDataUrl = await deps.capture({ code, params: sketchParams, seed: sketchSeed, index });
        if (thumbnailDataUrl) summary.rendered++;
      } catch (error) {
        emit({ type: 'log', index, message: `Thumbnail capture failed: ${error.message}` });
      }
    }

    if (stop()) {
      summary.stopped = true;
      emit({ type: 'item', index, status: 'stopped' });
      break;
    }

    emit({ type: 'item', index, status: 'saving' });
    try {
      const saved = await deps.save({
        prompt,
        model,
        code,
        sketchParams,
        sketchSeed,
        thumbnailDataUrl,
        stats,
        index,
        total: prompts.length,
      });
      summary.saved++;
      emit({ type: 'item', index, status: 'saved', savedId: saved?.id || '' });
    } catch (error) {
      summary.failed++;
      emit({ type: 'item', index, status: 'error', message: `Save failed: ${error.message}` });
    }

    await interruptibleDelay(opts.delayMs, stop);
  }

  emit({ type: 'done', summary });
  return summary;
}

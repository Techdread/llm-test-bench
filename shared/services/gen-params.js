// Generation parameters — canonical sampling/reasoning knobs, provider mapping,
// sweep expansion, and run telemetry.
//
// The hub historically sent no sampling parameters at all: every generation ran
// on whatever defaults the server (LM Studio's per-model config) or the model
// applied. That stays the default here — an EMPTY param object means "send
// nothing, use the server's settings", which is what keeps old results
// comparable. Only keys the caller explicitly set are put on the wire.
//
// DOM-free on purpose (see AGENTS.md testing rules): usable from node tests and
// from any app that wants to sweep parameters.

/** Canonical parameters, in display order. `providers` lists who accepts them. */
export const PARAM_SPEC = [
  { key: 'temperature',       label: 'Temperature',       type: 'float', min: 0,  max: 2,     step: 0.05, hint: 'Randomness. 0 = greedy.' },
  { key: 'top_p',             label: 'Top P',             type: 'float', min: 0,  max: 1,     step: 0.01, hint: 'Nucleus sampling cutoff.' },
  { key: 'top_k',             label: 'Top K',             type: 'int',   min: 0,  max: 200,   step: 1,    hint: '0 = disabled.' },
  { key: 'min_p',             label: 'Min P',             type: 'float', min: 0,  max: 1,     step: 0.01, hint: 'Minimum token probability.' },
  { key: 'repeat_penalty',    label: 'Repeat Penalty',    type: 'float', min: 0,  max: 2,     step: 0.01 },
  { key: 'presence_penalty',  label: 'Presence Penalty',  type: 'float', min: -2, max: 2,     step: 0.1 },
  { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'float', min: -2, max: 2,     step: 0.1 },
  { key: 'max_tokens',        label: 'Max Tokens',        type: 'int',   min: 1,  max: 200000, step: 1,
    hint: 'Careful: thinking models can spend the whole budget reasoning and return empty content.' },
  { key: 'seed',              label: 'Seed',              type: 'int',   min: 0,  max: 2 ** 31 - 1, step: 1, hint: 'Same seed + same params = repeatable.' },
  { key: 'reasoning_effort',  label: 'Reasoning Effort',  type: 'enum',  values: ['minimal', 'low', 'medium', 'high'],
    hint: 'Honoured only by models that expose it.' },
  { key: 'enable_thinking',   label: 'Thinking',          type: 'bool',
    hint: 'Chat-template switch. Many models (e.g. Gemma 4) ignore it and think regardless.' },
];

const SPEC_BY_KEY = new Map(PARAM_SPEC.map(p => [p.key, p]));

/** True for values that mean "not set" — those are never sent. */
function isUnset(v) {
  return v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

/**
 * Drop unset keys and coerce the rest to their declared type. Unknown keys are
 * passed through untouched so callers can send provider-specific extras.
 */
export function normalizeParams(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (isUnset(value)) continue;
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) { out[key] = value; continue; }
    if (spec.type === 'int') {
      const n = Math.round(Number(value));
      if (!Number.isNaN(n)) out[key] = n;
    } else if (spec.type === 'float') {
      const n = Number(value);
      if (!Number.isNaN(n)) out[key] = n;
    } else if (spec.type === 'bool') {
      out[key] = !!value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Stable, human-readable signature — used to label and group sweep results. */
export function paramsSignature(params) {
  const p = normalizeParams(params);
  const keys = Object.keys(p).sort();
  if (keys.length === 0) return 'server defaults';
  return keys.map(k => `${k}=${p[k]}`).join(', ');
}

/**
 * Map canonical params onto a provider's request body. Returns a NEW body.
 *
 * OpenRouter takes `repetition_penalty` and a `reasoning: {}` block; LM Studio
 * (OpenAI-compat) takes `repeat_penalty`, `reasoning_effort`, and passes
 * template switches through `chat_template_kwargs`.
 */
export function applyParams(body, params, providerType) {
  const p = normalizeParams(params);
  const out = { ...body };
  const isOpenRouter = providerType === 'openrouter';

  for (const [key, value] of Object.entries(p)) {
    switch (key) {
      case 'repeat_penalty':
        if (isOpenRouter) out.repetition_penalty = value;
        else out.repeat_penalty = value;
        break;
      case 'reasoning_effort':
        if (isOpenRouter) out.reasoning = { ...(out.reasoning || {}), effort: value };
        else out.reasoning_effort = value;
        break;
      case 'enable_thinking':
        if (isOpenRouter) out.reasoning = { ...(out.reasoning || {}), enabled: value };
        else out.chat_template_kwargs = { ...(out.chat_template_kwargs || {}), enable_thinking: value };
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/**
 * Ask the provider to report token usage on a streamed response.
 * OpenRouter: `usage: { include: true }`. OpenAI-compatible (LM Studio):
 * `stream_options: { include_usage: true }` — verified against LM Studio, which
 * then sends a final chunk carrying `usage.completion_tokens_details.reasoning_tokens`.
 */
export function withUsageReporting(body, providerType) {
  const out = { ...body };
  if (providerType === 'openrouter') out.usage = { ...(out.usage || {}), include: true };
  else out.stream_options = { ...(out.stream_options || {}), include_usage: true };
  return out;
}

/**
 * Expand a sweep grid into the list of param sets to run.
 * `{ temperature: [0, 0.7], top_p: [0.9, 1] }` → 4 combinations, in a stable
 * order (first key varies slowest), so a sweep is reproducible.
 * Keys mapped to a non-array (or an empty array) are treated as fixed.
 */
export function expandSweep(grid) {
  let combos = [{}];
  for (const [key, value] of Object.entries(grid || {})) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) continue;
    const next = [];
    for (const combo of combos) {
      for (const v of values) {
        if (isUnset(v)) { next.push({ ...combo }); continue; }
        next.push({ ...combo, [key]: v });
      }
    }
    combos = next;
  }
  return combos.map(normalizeParams);
}

/** Normalize an OpenAI-style usage block (LM Studio and OpenRouter both use it). */
export function extractUsage(usage) {
  if (!usage) return null;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoningTokens
    ?? null;
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    reasoningTokens: reasoning,
    cost: usage.cost ?? null, // OpenRouter only
  };
}

/**
 * Collects per-generation telemetry. Time-to-first-token and tokens/sec are
 * measured client-side because LM Studio only returns its own `stats` block on
 * NON-streamed responses, and the hub always streams.
 *
 * `now` is injectable so tests stay deterministic.
 */
export function createRunStats(now = () => Date.now()) {
  const startedAt = now();
  let firstTokenAt = null;
  let finishedAt = null;
  let usage = null;
  let finishReason = null;
  let thought = false;

  return {
    markFirstToken() { if (firstTokenAt === null) firstTokenAt = now(); },
    markReasoning() { thought = true; if (firstTokenAt === null) firstTokenAt = now(); },
    setUsage(raw) { const u = extractUsage(raw); if (u) usage = u; },
    setFinishReason(reason) { if (reason) finishReason = reason; },
    finish() { finishedAt = now(); return this.result(); },
    result() {
      const end = finishedAt ?? now();
      const durationMs = end - startedAt;
      const ttftMs = firstTokenAt === null ? null : firstTokenAt - startedAt;
      // Generation speed excludes the wait for the first token.
      const genMs = firstTokenAt === null ? null : end - firstTokenAt;
      const completion = usage?.completionTokens ?? null;
      const tokensPerSecond = (completion && genMs > 0)
        ? Number((completion / (genMs / 1000)).toFixed(2))
        : null;
      return {
        durationMs,
        ttftMs,
        tokensPerSecond,
        finishReason,
        // `thought` is observed, not assumed: it's true when the model actually
        // streamed reasoning, regardless of what the params asked for.
        thought: thought || (usage?.reasoningTokens ?? 0) > 0,
        ...(usage || {}),
      };
    },
  };
}

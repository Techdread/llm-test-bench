// Model ensemble runtime — spec 341.
//
// runEnsemble() takes a resolved definition (ensemble-definitions.js) and a
// chat request, fans it out to the members, gates the drafts, and either picks
// one (best-of-n) or merges them (synthesize). Everything that touches the
// outside world is injected through `deps`, so the whole flow is unit-tested
// with fake models:
//
//   callModel({ providerId, modelId, messages, params, onChunk, signal, role, runId })
//       → { text, finishReason, record }   (record = its telemetry record, may be null)
//   estimateCost(ref)       → median USD per call, or null (unmetered / no history)
//   graceFor(refs)          → ms to wait for stragglers once quorum is reached
//   contextLengthFor(ref)   → the model's context window in tokens, or null
//   persistRun(payload)     → saves the run folder (errors are swallowed)
//   now(), random()         → clock and shuffle source
//
// Rules that shape the code:
//   - Every draft is kept: winners, losers, gated and cancelled ones.
//   - Best-of-n returns the winning draft byte-for-byte.
//   - onChunk keeps the hub convention (accumulated text) and receives nothing
//     during fan-out — progress text there would corrupt apps that parse it.

import { DEFAULT_RUBRIC } from './ensemble-definitions.js';

export const DEFAULT_GRACE_MS = 60_000;
export const MAX_GRACE_MS = 180_000;
const JUDGE_DRAFT_CHARS = 60_000;
const SYNTH_CONTEXT_SHARE = 0.6;
const CHARS_PER_TOKEN = 4;
const STRAGGLER_SETTLE_MS = 5000;

export class EnsembleRefusedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'EnsembleRefusedError';
    Object.assign(this, details);
  }
}

// ── Gates ──────────────────────────────────────────────────────────────────

function stripFences(text) {
  const m = String(text || '').trim().match(/^```[a-z0-9]*\n([\s\S]*?)\n```$/i);
  return m ? m[1] : String(text || '').trim();
}

const GATE_CHECKS = {
  'non-empty': (d) => !!String(d.text || '').trim(),
  'not-truncated': (d) => d.finishReason !== 'length',
  json: (d) => { try { JSON.parse(stripFences(d.text)); return true; } catch { return false; } },
  html: (d) => /<!doctype html|<html[\s>]|<body[\s>]/i.test(d.text || ''),
  svg: (d) => /<svg[\s>]/i.test(d.text || '') && /<\/svg>/i.test(d.text || ''),
};

/** The first gate a draft fails, or null. `error` is a gate of its own. */
export function failedGate(draft, gates) {
  if (draft.error) return 'error';
  for (const gate of gates || []) {
    const check = GATE_CHECKS[gate];
    if (check && !check(draft)) return gate;
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function newRunId(now = Date.now(), random = Math.random) {
  return `ens_${now.toString(36)}_${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export function labelFor(index) {
  return String.fromCharCode(65 + index);
}

function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function taskText(messages) {
  return (messages || []).map((m) => {
    const c = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map(p => (p?.type === 'text' ? p.text : `[${p?.type || 'attachment'}]`)).join('\n') : '';
    return `### ${m.role || 'user'}\n${c}`;
  }).join('\n\n');
}

/** First balanced {...} block in a reply, parsed; null when there is none. */
export function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function isCli(ref) {
  return String(ref?.providerId || '').startsWith('cli-agent:');
}

function refLabel(ref) {
  return ref ? `${ref.providerId} · ${ref.modelId}` : '';
}

// ── Judge / synthesizer prompts ────────────────────────────────────────────

export function judgeMessages({ task, candidates, rubric, retryNote = '' }) {
  const drafts = candidates.map(c => {
    const text = String(c.text || '');
    const body = text.length > JUDGE_DRAFT_CHARS
      ? `${text.slice(0, JUDGE_DRAFT_CHARS)}\n[… ${text.length - JUDGE_DRAFT_CHARS} more characters not shown]`
      : text;
    return `=== Draft ${c.label} ===\n${body}\n=== End of draft ${c.label} ===`;
  }).join('\n\n');
  const labels = candidates.map(c => c.label);
  return [
    {
      role: 'system',
      content: 'You are an impartial judge comparing anonymous drafts that answer the same task. '
        + 'You do not know who wrote them and the order is random. Judge only the drafts against the rubric. '
        + 'Reply with a single JSON object and nothing else.',
    },
    {
      role: 'user',
      content: `The task the drafts answer:\n\n${task}\n\nRubric: ${rubric || DEFAULT_RUBRIC}\n\n${drafts}\n\n`
        + `Score each draft from 1 to 10 against the rubric and pick the best.\n`
        + `Reply ONLY with JSON of this exact shape: {"scores": {${labels.map(l => `"${l}": <1-10>`).join(', ')}}, "winner": "<one of ${labels.join(', ')}>", "rationale": "<two or three sentences>"}`
        + (retryNote ? `\n\n${retryNote}` : ''),
    },
  ];
}

export function synthMessages({ messages, candidates }) {
  const drafts = candidates.map(c => `=== Draft ${c.label} ===\n${c.text}\n=== End of draft ${c.label} ===`).join('\n\n');
  const original = messages.map(m => ({ ...m }));
  const lastUser = [...original].reverse().find(m => m.role === 'user');
  const instruction = '\n\n---\n\nSeveral independent drafts answering exactly this request are below. '
    + 'Write ONE final answer that satisfies the request above, keeps the strongest parts of each draft, '
    + 'and fixes any mistake a draft makes. Your answer must be in exactly the output format the request asks for. '
    + 'Do not mention the drafts, do not compare them, and do not add commentary.\n\n' + drafts;
  if (lastUser && typeof lastUser.content === 'string') lastUser.content += instruction;
  else original.push({ role: 'user', content: instruction.trim() });
  return original;
}

// ── Run ────────────────────────────────────────────────────────────────────

/**
 * Run an ensemble. Resolves { text, runId, run }; rejects with every member's
 * error when no draft passes the gates, or with EnsembleRefusedError when the
 * cost estimate exceeds the cap (nothing is called in that case).
 *
 * onProgress receives:
 *   { type: 'member', index, label, status, chars, gate, ms }   status: queued|running|done|failed|cancelled
 *   { type: 'stage', stage }                                    judging|scoring|synthesizing|done
 *   { type: 'chunk', index, text }                              a member's accumulated text (for a live bench)
 */
export async function runEnsemble({
  ensemble, messages, params = null, onChunk = null, onProgress = null, signal = null,
  scorer = null, app = null, appTitle = null, deps,
}) {
  const now = deps.now || (() => Date.now());
  const random = deps.random || Math.random;
  const started = now();
  const runId = newRunId(started, random);
  const gates = ensemble.gates || [];
  const members = ensemble.members || [];
  const emit = (event) => { try { onProgress?.(event); } catch { /* a UI bug must not break the run */ } };
  const flags = [];

  const run = {
    runId,
    at: new Date(started).toISOString(),
    month: new Date(started).toISOString().slice(0, 7),
    app, appTitle,
    ensemble: { id: ensemble.id || null, version: ensemble.version || null, name: ensemble.name, strategy: ensemble.strategy },
    strategy: ensemble.strategy,
    members: [],
    judge: null,
    synthesizer: null,
    scorer: null,
    winner: null,
    flags,
    estimateUsd: null,
    costUsd: null,
    totalMs: null,
    quorum: { ...ensemble.quorum, reachedAtMs: null, graceMs: null, cutOff: 0 },
  };

  // ── Cost estimate and cap ──
  const refs = [...members, ensemble.strategy === 'synthesize' ? ensemble.synthesizer : ensemble.judge].filter(Boolean);
  const estimates = await Promise.all(refs.map(async (ref) => {
    try { return await deps.estimateCost?.(ref); } catch { return null; }
  }));
  const metered = estimates.filter(Number.isFinite);
  run.estimateUsd = metered.length ? metered.reduce((a, b) => a + b, 0) : null;
  run.unmetered = estimates.filter(e => !Number.isFinite(e)).length;
  const cap = ensemble.caps?.maxUsdPerCall;
  if (Number.isFinite(cap) && Number.isFinite(run.estimateUsd) && run.estimateUsd > cap) {
    throw new EnsembleRefusedError(
      `Ensemble "${ensemble.name}" is estimated at $${run.estimateUsd.toFixed(4)} per call, over its cap of $${cap.toFixed(4)}. Nothing was run.`,
      { estimateUsd: run.estimateUsd, capUsd: cap },
    );
  }

  // ── Fan out ──
  const drafts = members.map((ref, index) => ({
    index, label: labelFor(index), ref, status: 'queued', text: '', partial: '',
    finishReason: null, error: null, gate: null, startedMs: null, ms: null, costUsd: null,
    controller: new AbortController(),
  }));
  const outer = signal;
  const abortAll = () => drafts.forEach(d => d.controller.abort());
  if (outer) {
    if (outer.aborted) abortAll();
    else outer.addEventListener('abort', abortAll, { once: true });
  }

  let spent = 0;
  const addCost = (usd) => {
    if (!Number.isFinite(usd)) return;
    spent += usd;
    run.costUsd = spent;
    if (Number.isFinite(cap) && spent > cap) {
      if (!flags.includes('cost-cap-reached')) flags.push('cost-cap-reached');
      drafts.filter(d => d.status === 'running' || d.status === 'queued').forEach((d) => { d.cancelReason = 'cost-cap'; d.controller.abort(); });
    }
  };

  const cliLimit = Math.max(1, ensemble.caps?.maxConcurrentCli || 2);
  let cliRunning = 0;
  const cliQueue = [];
  const acquire = (draft) => {
    if (!isCli(draft.ref)) return Promise.resolve();
    if (cliRunning < cliLimit) { cliRunning++; return Promise.resolve(); }
    return new Promise(resolve => cliQueue.push(resolve));
  };
  const release = (draft) => {
    if (!isCli(draft.ref)) return;
    const next = cliQueue.shift();
    if (next) next(); else cliRunning--;
  };

  const memberParams = params && typeof params === 'object' ? { ...params } : null;
  if (memberParams) delete memberParams.ensemble;

  let settle;
  const settled = new Promise(resolve => { settle = resolve; });
  let graceTimer = null;
  const passing = () => drafts.filter(d => d.status === 'done' && !d.gate);
  const running = () => drafts.filter(d => d.status === 'queued' || d.status === 'running');
  const checkQuorum = async () => {
    const reachedNow = run.quorum.reachedAtMs === null && passing().length >= ensemble.quorum.minDrafts;
    if (reachedNow) run.quorum.reachedAtMs = now() - started;
    // Everyone has finished: nothing left to wait for, quorum or not.
    if (!running().length) { settle(); return; }
    if (reachedNow) {
      let grace = ensemble.quorum.graceAfterQuorumMs;
      if (grace === 'auto') {
        try { grace = await deps.graceFor?.(running().map(d => d.ref)); } catch { grace = null; }
        if (!Number.isFinite(grace)) grace = DEFAULT_GRACE_MS;
        grace = Math.min(MAX_GRACE_MS, grace);
      }
      run.quorum.graceMs = grace;
      if (!running().length) { settle(); return; }
      graceTimer = setTimeout(settle, grace);
    }
  };

  const runMember = async (draft) => {
    await acquire(draft);
    if (draft.controller.signal.aborted) {
      release(draft);
      draft.status = 'cancelled';
      emit({ type: 'member', index: draft.index, label: draft.label, status: 'cancelled' });
      return;
    }
    draft.status = 'running';
    draft.startedMs = now() - started;
    emit({ type: 'member', index: draft.index, label: draft.label, status: 'running' });
    try {
      const result = await deps.callModel({
        ...draft.ref,
        messages,
        params: { ...(memberParams || {}), ...(draft.ref.params || {}) },
        signal: draft.controller.signal,
        role: 'member',
        runId,
        onChunk: (text) => {
          draft.partial = typeof text === 'string' ? text : draft.partial;
          emit({ type: 'chunk', index: draft.index, text: draft.partial });
        },
      });
      draft.text = String(result?.text || '');
      draft.finishReason = result?.finishReason || null;
      draft.costUsd = Number.isFinite(result?.record?.cost?.usd) ? result.record.cost.usd : null;
      draft.status = 'done';
    } catch (error) {
      if (draft.controller.signal.aborted) {
        draft.status = 'cancelled';
        draft.text = draft.partial;
      } else {
        draft.status = 'failed';
        draft.error = String(error?.message || error);
      }
      const cost = error?.record?.cost?.usd;
      if (Number.isFinite(cost)) draft.costUsd = cost;
    } finally {
      release(draft);
    }
    draft.ms = now() - started - draft.startedMs;
    if (draft.status !== 'cancelled') draft.gate = failedGate(draft, gates);
    addCost(draft.costUsd);
    emit({ type: 'member', index: draft.index, label: draft.label, status: draft.status, gate: draft.gate, chars: draft.text.length, ms: draft.ms });
    await checkQuorum();
  };

  const memberRuns = drafts.map(d => runMember(d));
  await settled;
  if (graceTimer) clearTimeout(graceTimer);
  // Stragglers past quorum + grace are cancelled; their partial output is kept.
  const stragglers = running();
  for (const d of stragglers) {
    d.cancelReason = d.cancelReason || 'after-quorum';
    d.controller.abort();
    run.quorum.cutOff++;
  }
  if (outer) outer.removeEventListener('abort', abortAll);
  // Let cancelled members record their partial output — but a provider that
  // ignores its abort signal must not hold the whole ensemble hostage.
  if (stragglers.length) {
    await Promise.race([
      Promise.allSettled(memberRuns),
      new Promise(resolve => setTimeout(resolve, STRAGGLER_SETTLE_MS)),
    ]);
    for (const d of stragglers) {
      if (d.status === 'running' || d.status === 'queued') { d.status = 'cancelled'; d.text = d.partial; }
    }
  }

  const recordMembers = () => {
    run.members = drafts.map(d => ({
      label: d.label, providerId: d.ref.providerId, modelId: d.ref.modelId,
      status: d.status === 'cancelled' ? `cancelled-${d.cancelReason || 'by-caller'}` : d.status,
      gate: d.gate, error: d.error, finishReason: d.finishReason,
      chars: (d.text || d.partial || '').length, startedMs: d.startedMs, ms: d.ms, costUsd: d.costUsd,
    }));
  };

  const persist = async (finalText) => {
    recordMembers();
    run.totalMs = now() - started;
    const draftTexts = {};
    for (const d of drafts) draftTexts[d.label] = d.text || d.partial || '';
    if (run.judge?.raw) draftTexts.judge = run.judge.raw;
    if (run.synthesizer?.text !== undefined) draftTexts.synthesizer = run.synthesizer.text;
    const payload = { ...run };
    if (payload.judge) payload.judge = { ...payload.judge, raw: undefined };
    if (payload.synthesizer) payload.synthesizer = { ...payload.synthesizer, text: undefined };
    try { await deps.persistRun?.({ runId, month: run.month, run: payload, drafts: draftTexts, final: finalText, task: taskText(messages) }); } catch { /* recorded best-effort */ }
  };

  if (outer?.aborted) {
    flags.push('cancelled-by-caller');
    await persist('');
    throw new DOMException('Ensemble run cancelled', 'AbortError');
  }

  const ok = passing();
  if (!ok.length) {
    flags.push('no-passing-draft');
    await persist('');
    const reasons = drafts.map(d => `${d.label} (${refLabel(d.ref)}): ${d.error || (d.gate ? `failed the ${d.gate} gate` : d.status)}`);
    throw new Error(`Ensemble "${ensemble.name}": no draft passed. ${reasons.join('; ')}`);
  }
  if (run.quorum.reachedAtMs === null) flags.push('quorum-not-reached');

  const task = taskText(messages);

  // ── Best-of-n selection (also the synthesize fallback) ──
  const pickBest = async (candidates, { reason = null } = {}) => {
    if (reason) flags.push(reason);
    let pool = candidates;
    if (typeof scorer === 'function') {
      emit({ type: 'stage', stage: 'scoring' });
      const scores = {};
      for (const c of candidates) {
        try {
          const s = await scorer(c.text);
          scores[c.label] = { score: Number(s?.score), notes: s?.notes || '' };
        } catch (e) {
          scores[c.label] = { score: -Infinity, notes: `scorer failed: ${e.message}` };
        }
      }
      run.scorer = scores;
      const top = Math.max(...candidates.map(c => (Number.isFinite(scores[c.label].score) ? scores[c.label].score : -Infinity)));
      pool = candidates.filter(c => scores[c.label].score === top);
      if (!pool.length) pool = candidates;
    }
    if (pool.length === 1) return pool[0];
    if (!ensemble.judge) {
      flags.push('no-judge-longest-wins');
      return [...pool].sort((a, b) => b.text.length - a.text.length)[0];
    }
    emit({ type: 'stage', stage: 'judging' });
    const shuffled = shuffle(pool, random);
    // Labels are what the judge sees: re-letter the shuffled pool so position
    // carries no information about member order.
    const blind = shuffled.map((c, i) => ({ label: labelFor(i), text: c.text, draft: c }));
    const judgeRun = { providerId: ensemble.judge.providerId, modelId: ensemble.judge.modelId, order: blind.map(b => b.draft.label), attempts: 0 };
    run.judge = judgeRun;
    let verdict = null;
    let raw = '';
    for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
      judgeRun.attempts = attempt + 1;
      try {
        const res = await deps.callModel({
          providerId: ensemble.judge.providerId, modelId: ensemble.judge.modelId,
          messages: judgeMessages({
            task, candidates: blind, rubric: ensemble.judge.rubric,
            retryNote: attempt ? 'Your previous reply was not valid JSON with a winner from the listed labels. Reply with the JSON object only.' : '',
          }),
          role: 'judge', runId, signal: outer || undefined,
        });
        addCost(res?.record?.cost?.usd);
        raw = String(res?.text || '');
        const parsed = extractJson(raw);
        if (parsed && blind.some(b => b.label === parsed.winner)) verdict = parsed;
      } catch (e) {
        judgeRun.error = String(e?.message || e);
        break;
      }
    }
    judgeRun.raw = raw;
    if (!verdict) {
      flags.push('judge-failed');
      return [...pool].sort((a, b) => b.text.length - a.text.length)[0];
    }
    // Map the judge's blind labels back to member labels.
    const scores = {};
    for (const b of blind) {
      const score = Number(verdict.scores?.[b.label]);
      scores[b.draft.label] = Number.isFinite(score) ? score : null;
    }
    judgeRun.scores = scores;
    judgeRun.rationale = String(verdict.rationale || '');
    return blind.find(b => b.label === verdict.winner).draft;
  };

  let finalText = '';
  if (ensemble.strategy === 'synthesize') {
    const totalTokens = ok.reduce((a, d) => a + d.text.length, 0) / CHARS_PER_TOKEN;
    let context = null;
    try { context = await deps.contextLengthFor?.(ensemble.synthesizer); } catch { context = null; }
    if (Number.isFinite(context) && totalTokens > context * SYNTH_CONTEXT_SHARE) {
      const winner = await pickBest(ok, { reason: 'synthesis-size-guard' });
      run.winner = winner.label;
      finalText = winner.text;
      onChunk?.(finalText);
    } else {
      emit({ type: 'stage', stage: 'synthesizing' });
      const synthRun = { providerId: ensemble.synthesizer.providerId, modelId: ensemble.synthesizer.modelId };
      run.synthesizer = synthRun;
      let synthText = '';
      let synthResult = null;
      try {
        synthResult = await deps.callModel({
          providerId: ensemble.synthesizer.providerId, modelId: ensemble.synthesizer.modelId,
          messages: synthMessages({ messages, candidates: ok }),
          params: memberParams,
          role: 'synthesizer', runId, signal: outer || undefined,
          onChunk: (text) => { synthText = text; onChunk?.(text); },
        });
        addCost(synthResult?.record?.cost?.usd);
        synthText = String(synthResult?.text || synthText);
      } catch (e) {
        synthRun.error = String(e?.message || e);
      }
      synthRun.text = synthText;
      const gate = synthRun.error ? 'error' : failedGate({ text: synthText, finishReason: synthResult?.finishReason }, gates);
      synthRun.gate = gate;
      if (gate) {
        const winner = await pickBest(ok, { reason: 'synthesis-fell-back' });
        run.winner = winner.label;
        finalText = winner.text;
        onChunk?.(finalText);
      } else {
        run.winner = 'synthesizer';
        finalText = synthText;
      }
    }
  } else {
    const winner = await pickBest(ok);
    run.winner = winner.label;
    finalText = winner.text;
    // One delivery: the app receives the draft exactly as the member wrote it.
    onChunk?.(finalText);
  }

  emit({ type: 'stage', stage: 'done' });
  await persist(finalText);
  return { text: finalText, runId, run };
}

// Browser client for the local coding-agent bridge exposed by serve.py.
//
// This module is intentionally app-neutral. Apps provide a data-root-relative
// project directory and their own task prompt; the bridge owns process launch,
// path jailing, budgets, cancellation, and event normalization.

import { applyModelVisibility } from './cli-agent-model-visibility.js';
import {
  startGeneration, telemetryEnabled, observeAgentEvent, observeAgentLive,
} from './generation-telemetry.js';

export const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', shell: true, effort: true },
  { id: 'codex', label: 'Codex', shell: true, models: true, effort: true },
  { id: 'antigravity', label: 'Antigravity', shell: true, models: true, effort: true },
  { id: 'grok', label: 'Grok', shell: true, models: true },
  { id: 'devin', label: 'Devin', shell: true, models: true },
  { id: 'cursor', label: 'Cursor', shell: true, models: true },
  { id: 'opencode', label: 'OpenCode', shell: true, models: true },
];

export const AGENT_EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const AGENT_EFFORT_PREF_KEY = 'devtools-hub-cli-agent-efforts';

function readAgentEfforts() {
  try {
    const value = JSON.parse(localStorage.getItem(AGENT_EFFORT_PREF_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function getAgentModelEffort(agentId, modelId, fallback = '') {
  return readAgentEfforts()[`${agentId}:${modelId || '__default__'}`] || fallback;
}

export function saveAgentModelEffort(agentId, modelId, effort) {
  if (!agentId || !AGENT_EFFORT_LEVELS.includes(effort)) return false;
  try {
    localStorage.setItem(AGENT_EFFORT_PREF_KEY, JSON.stringify({
      ...readAgentEfforts(),
      [`${agentId}:${modelId || '__default__'}`]: effort,
    }));
    return true;
  } catch {
    return false;
  }
}

let bridgeProbe = null;

// How quiet a stream must go before the watchdog cross-checks the bridge, and
// how often it looks. Generous: agents legitimately think for minutes between
// events, and the check is only a fallback for a stream that has actually died.
const STALL_MS = 20000;
const STALL_CHECK_MS = 10000;

/**
 * True only when the serve.py agent bridge is actually answering. Static hosts
 * sometimes return their HTML fallback with status 200 for unknown paths, so
 * the response must also have the bridge's JSON shape.
 * Cached per page load; pass `{ refresh: true }` to re-probe.
 */
export function isAgentBridgeReachable({ refresh = false } = {}) {
  if (!bridgeProbe || refresh) {
    bridgeProbe = fetch('/__agent/runs')
      .then(async (res) => {
        if (!res.ok) return false;
        try {
          return isAgentRunsPayload(await res.json());
        } catch {
          return false;
        }
      })
      .catch(() => false);
  }
  return bridgeProbe;
}

export function isAgentRunsPayload(payload) {
  return Boolean(payload && Array.isArray(payload.runs) && Number.isFinite(payload.activeCount));
}

// ── Bridge feature negotiation ──
//
// The bridge is a separate long-lived process, so the page is routinely newer
// than the serve.py that is actually answering. Anything the client sends that
// an older bridge would MISREAD (rather than ignore) has to be negotiated.

/** Ceilings an older bridge clamps to; the closest it can get to "no limit". */
const LEGACY_TIME_CEILINGS = { maxAgentSeconds: 7200, idleTimeoutSeconds: 1800 };

/**
 * Ceilings a bridge without `open-ended-budgets` clamps every count/size budget
 * to — and it reads an explicit null ("no limit") as "use the default".
 */
const LEGACY_COUNT_CEILINGS = {
  maxTurns: 200,
  maxFiles: 2000,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxImages: 100,
  maxImagePixels: 1024 * 1024 * 1024,
  maxTokens: 10_000_000,
};

let featureProbe = null;

/**
 * Feature strings this bridge advertises. An old bridge sends none, which is
 * exactly the signal we need. Cached per page load.
 */
export function agentBridgeFeatures({ refresh = false } = {}) {
  if (!featureProbe || refresh) {
    featureProbe = fetch('/__agent/runs')
      .then(async (res) => {
        if (!res.ok) return [];
        const payload = await res.json().catch(() => null);
        return Array.isArray(payload?.features) ? payload.features : [];
      })
      .catch(() => []);
  }
  return featureProbe;
}

/**
 * Translate budgets for the bridge that is actually running.
 *
 * A time budget of 0 means "no limit", but a bridge without
 * `unlimited-time-budgets` clamps it UP to its 10-second floor — turning "run as
 * long as you need" into the tightest limit in the system. Likewise a count
 * budget of Infinity/null means "no limit", but a bridge without
 * `open-ended-budgets` reads null as its default (40 turns, 100 files...) and
 * clamps big numbers to its old ceilings. Rather than send a number that means
 * something other than what the user asked for, fall back to the highest value
 * that bridge accepts and say so.
 *
 * @returns {{budgets: Object, downgraded: string[]}} `downgraded` names the
 * budgets that could not be honoured, for the caller to surface.
 */
export function budgetsForBridge(budgets = {}, features = []) {
  const next = { ...budgets };
  const downgraded = [];
  const openEnded = features.includes('open-ended-budgets');
  if (!features.includes('unlimited-time-budgets')) {
    for (const [key, ceiling] of Object.entries(LEGACY_TIME_CEILINGS)) {
      if (Number(next[key]) === 0 || next[key] === Infinity) {
        next[key] = ceiling;
        downgraded.push(key);
      }
    }
  }
  if (!openEnded) {
    for (const [key, ceiling] of Object.entries({ ...LEGACY_TIME_CEILINGS, ...LEGACY_COUNT_CEILINGS })) {
      if (!(key in next) || downgraded.includes(key)) continue;
      const unlimited = next[key] === null || next[key] === Infinity;
      if (unlimited || Number(next[key]) > ceiling) {
        next[key] = ceiling;
        downgraded.push(key);
      }
    }
  }
  // JSON has no Infinity; spell "no limit" as the explicit null the bridge reads.
  for (const key of Object.keys(LEGACY_COUNT_CEILINGS)) {
    if (next[key] === Infinity) next[key] = null;
  }
  return { budgets: next, downgraded };
}

export async function listAgentRuns() {
  try {
    const res = await fetch('/__agent/runs');
    if (!res.ok) return { runs: [], activeCount: 0, reachable: true };
    return { ...(await res.json()), reachable: true };
  } catch {
    return { runs: [], activeCount: 0, reachable: false };
  }
}

export async function cancelAgentRun(runId) {
  await fetch(`/__agent/cancel/${encodeURIComponent(runId)}`, { method: 'POST' });
}

/**
 * Suspend or continue a running agent's process tree (POSIX job control on the
 * bridge). The agent keeps its whole context and carries on from where it was
 * frozen; its time budgets are held while it is parked.
 *
 * @returns {Promise<{paused: boolean, pausedMs: number}>}
 * @throws if this bridge cannot pause, or the run is no longer active.
 */
export async function setAgentRunPaused(runId, paused) {
  const features = await agentBridgeFeatures();
  if (!features.includes('pause-resume')) {
    throw new Error('This agent bridge cannot pause a run — restart the hub with the current serve.py');
  }
  const route = paused ? 'pause' : 'resume';
  const res = await fetch(`/__agent/${route}/${encodeURIComponent(runId)}`, { method: 'POST' })
    .catch((error) => { throw new Error(`Bridge unreachable (${error.message})`); });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Agent bridge error (${res.status})`);
  return { paused: !!payload.paused, pausedMs: payload.pausedMs || 0 };
}

export const pauseAgentRun = runId => setAgentRunPaused(runId, true);
export const resumeAgentRun = runId => setAgentRunPaused(runId, false);

/** Whether the bridge that is actually running supports pause/resume. */
export async function agentPauseSupported() {
  return (await agentBridgeFeatures()).includes('pause-resume');
}

export async function listAgentModelOptions(agent, { refresh = false, includeHidden = false } = {}) {
  try {
    const suffix = refresh ? '?refresh=1' : '';
    const res = await fetch(`/__agent/models/${encodeURIComponent(agent)}${suffix}`);
    if (!res.ok) return [];
    const payload = await res.json();
    const rows = Array.isArray(payload.modelOptions)
      ? payload.modelOptions
        .filter(option => option?.id)
        .map(option => ({ ...option, id: option.id, label: option.label || option.id }))
      : (payload.models || []).filter(Boolean).map(id => ({ id, label: id }));
    // Curation applies here, once, so it reaches every picker: the provider
    // dropdown, the Forge agent chooser and the unified executor selector all
    // arrive through this one call. `includeHidden` exists for the dialog that
    // does the curating, which must see the rows it is offering to hide.
    return includeHidden ? rows : applyModelVisibility(agent, rows);
  } catch {
    return [];
  }
}

export async function listAgentModels(agent) {
  return (await listAgentModelOptions(agent)).map(option => option.id);
}

/**
 * Normalize model capabilities for the shared picker. Antigravity's wire-level
 * effort variants collapse into base-model rows, while Codex rows already carry
 * their supported levels and defaults from its local catalogue. Exact variant
 * ids remain attached for migration from older saved preferences.
 */
export function groupAgentModelOptions(options = []) {
  const groups = new Map();
  for (const raw of options) {
    const option = typeof raw === 'string' ? { id: raw, label: raw } : raw;
    if (!option?.id) continue;
    const match = option.id.match(/^(.*)-(low|medium|high)$/);
    const baseId = match?.[1] || option.id;
    const effort = match?.[2] || '';
    const baseLabel = effort
      ? String(option.label || option.id).replace(/\s*\((?:Low|Medium|High)\)\s*$/i, '')
      : (option.label || option.id);
    if (!groups.has(baseId)) {
      const fixedEffort = /\(thinking\)\s*$/i.test(String(option.label || '')) ? 'thinking' : '';
      groups.set(baseId, {
        ...option,
        id: baseId,
        label: baseLabel,
        efforts: [...(option.efforts || [])],
        variants: {},
        fixedEffort,
      });
    }
    const group = groups.get(baseId);
    if (effort) {
      group.variants[effort] = option.id;
      if (!group.efforts.includes(effort)) group.efforts.push(effort);
    }
  }
  return [...groups.values()].map(group => ({
    ...group,
    efforts: AGENT_EFFORT_LEVELS.filter(level => group.efforts.includes(level)),
  }));
}

/** Resolve a base model + effort, including old saved variant ids. */
export function resolveAgentModelSelection(modelId, effort, choices = []) {
  let choice = choices.find(item => item.id === modelId);
  let variantEffort = '';
  if (!choice) {
    choice = choices.find(item => {
      const hit = Object.entries(item.variants || {}).find(([, id]) => id === modelId);
      if (hit) variantEffort = hit[0];
      return Boolean(hit);
    });
  }
  const supported = choice?.efforts || [];
  let resolvedEffort = variantEffort
    || (AGENT_EFFORT_LEVELS.includes(effort) ? effort : '')
    || choice?.defaultEffort
    || 'medium';
  if (supported.length && !supported.includes(resolvedEffort)) {
    resolvedEffort = supported.includes(choice?.defaultEffort)
      ? choice.defaultEffort
      : (supported.includes('medium') ? 'medium' : supported[0]);
  }
  return { modelId: choice?.id || modelId || '', effort: resolvedEffort, supportedEfforts: supported };
}

/**
 * Start a run, then attach to its normalized SSE event stream.
 *
 * Every run is recorded by generation telemetry (spec 340). A caller that
 * already tracks the call — the cli-agent provider, inside model-providers —
 * passes its `telemetry` tracker; any other caller (a Forge build driving an
 * agent over a project) gets a tracker of its own here, sealed on completion.
 */
export async function runAgent({ telemetry, telemetryMeta, ...args }) {
  const owned = !telemetry && telemetryEnabled();
  let tracker = telemetry || null;
  if (owned) {
    try {
      tracker = startGeneration({
        entry: 'agentRun',
        provider: { id: `cli-agent:${args.agent}`, type: 'cli-agent', name: agentLabel(args.agent) },
        agentId: args.agent,
        modelId: args.options?.model || 'default',
        params: args.options?.effort ? { reasoning_effort: args.options.effort } : null,
        promptText: args.prompt,
        streamed: true,
        signal: args.signal,
        ...(telemetryMeta || {}),
      });
    } catch { tracker = null; }
  }
  let toolEvents = 0;
  const observed = tracker ? {
    ...args,
    // The bridge accepted the run and is starting the process. The chip can say
    // "Starting" now; serve.py's exact spawn time replaces this mark at `done`.
    onStart: (runId) => { tracker.mark('spawned'); tracker.setServerRun({ runId, projectDir: args.projectDir || '' }); args.onStart?.(runId); },
    onEvent: (event) => { if (observeAgentEvent(tracker, event)) toolEvents++; args.onEvent?.(event); },
    onLive: (frame) => { observeAgentLive(tracker, frame); args.onLive?.(frame); },
  } : args;
  if (!owned || !tracker) return runAgentRaw({ ...observed, telemetry: tracker });
  try {
    const result = await runAgentRaw({ ...observed, telemetry: tracker });
    const done = result?.doneEvent;
    const failed = !done || (done.exitCode != null && done.exitCode !== 0);
    tracker.finish(failed
      ? { error: new Error(result?.bridgeRun?.budgetStop?.reason
        || (done ? `agent exited with code ${done.exitCode}` : 'the agent stream ended without a completion event')) }
      : { result: { text: done.summary || '' }, toolCalls: toolEvents });
    return result;
  } catch (error) {
    tracker.finish({ error, aborted: args.signal?.aborted });
    throw error;
  }
}

function agentLabel(agentId) {
  return AGENTS.find(a => a.id === agentId)?.label || agentId || 'CLI agent';
}

async function runAgentRaw({ agent, prompt, projectDir, options, budgets, attachments, onStart, onEvent, onLive, onNotice, signal, telemetry }) {
  // Negotiate before spawning: an unlimited budget sent to an older bridge
  // becomes a 10-second one, killing the run before the agent has done anything.
  const bridgeFeatures = await agentBridgeFeatures();
  const negotiated = budgetsForBridge(budgets || {}, bridgeFeatures);
  if (negotiated.downgraded.length) {
    const message = `This agent bridge predates unlimited budgets, so "no limit" `
      + `was sent as its maximum instead (${negotiated.downgraded
        .map(key => `${key} ${negotiated.budgets[key]}`).join(', ')}). `
      + 'Restart the hub with serve.py to remove the limits entirely.';
    console.warn('[agent-bridge]', message);
    onNotice?.({ code: 'budget_downgraded', message, downgraded: negotiated.downgraded });
  }

  if (attachments?.length && !bridgeFeatures.includes('inline-image-attachments')) {
    throw new Error('This agent bridge cannot receive image attachments — restart the hub with the current serve.py');
  }

  telemetry?.mark('dispatched');
  const res = await fetch('/__agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent,
      prompt,
      projectDir,
      options: options || {},
      budgets: negotiated.budgets,
      ...(attachments?.length ? { attachments } : {}),
    }),
  }).catch((error) => {
    throw new Error(`Bridge unreachable — run the hub with serve.py (${error.message})`);
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Agent bridge error (${res.status})`);
  }
  const { runId } = await res.json();
  onStart?.(runId);
  return attachAgentRun({ runId, onEvent, onLive, signal });
}

/**
 * Attach or reattach to a bridge stream, optionally after persisted events.
 *
 * `onLive` receives `{ text, kind }` — the rolling tail of the content block the
 * agent is composing right now, for showing tokens as they arrive. It is
 * deliberately separate from `onEvent`: the tail is ephemeral and is superseded
 * by the ordinary `message`/`reasoning` event, so it belongs in a live view
 * rather than in a trace or an appended event list.
 */
export function attachAgentRun({ runId, onEvent, onLive, signal, fromIndex = 0 }) {
  return new Promise((resolve, reject) => {
    // Always request the original stream URL. Older bridge processes treat a
    // query string as part of the id, so replay skipping stays client-side.
    let resumeIndex = Math.max(0, Number(fromIndex) || 0);
    let eventIndex = 0;
    let streamErrors = 0;
    const es = new EventSource(`/__agent/stream/${encodeURIComponent(runId)}`);
    let done = false;
    let lastEventAt = Date.now();

    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(watchdog);
      es.close();
      resolve(result);
    };

    // `es.onerror` is the only other exit, so a stream that goes quiet without
    // erroring — a closed connection the browser never reports, a tab that was
    // frozen while the agent finished — would leave this promise pending and the
    // caller's run "in progress" forever. Ask the bridge directly instead.
    const watchdog = setInterval(async () => {
      if (done || Date.now() - lastEventAt < STALL_MS) return;
      const listing = await listAgentRuns();
      if (done) return;
      const known = listing.runs?.find(run => run.runId === runId);
      // Only settle once the bridge says finished AND the stream has stayed
      // quiet, so a run still delivering buffered events is never cut short.
      if (known?.done && Date.now() - lastEventAt >= STALL_MS) {
        finish({ runId, doneEvent: null, bridgeRun: known, streamStalled: true });
      }
    }, STALL_CHECK_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        fetch(`/__agent/cancel/${encodeURIComponent(runId)}`, { method: 'POST' }).catch(() => {});
      }, { once: true });
    }

    es.onopen = () => {
      eventIndex = 0;
      streamErrors = 0;
    };
    es.onmessage = (message) => {
      let event;
      try { event = JSON.parse(message.data); } catch { return; }
      const index = eventIndex++;
      if (index < resumeIndex) return;
      resumeIndex++;
      streamErrors = 0;
      lastEventAt = Date.now();
      onEvent?.(event);
      if (event.type === 'done') finish({ runId, doneEvent: event });
    };
    // Named event, so it never advances eventIndex and old bridges that never
    // send one simply leave the live view empty. Optional on the source object
    // too: callers that need no live view pass a bare onmessage-only stub.
    if (onLive && typeof es.addEventListener === 'function') {
      es.addEventListener('live', (message) => {
        if (done) return;
        let frame;
        try { frame = JSON.parse(message.data); } catch { return; }
        lastEventAt = Date.now();
        onLive({
          text: frame.text || '',
          kind: frame.kind || 'text',
          thinkingTokens: frame.thinkingTokens || 0,
        });
      });
    }
    es.onerror = async () => {
      // EventSource reconnects automatically. Settle only after the bridge
      // confirms completion or has become definitively unreachable.
      if (done) return;
      streamErrors++;
      const listing = await listAgentRuns();
      if (done) return;
      const known = listing.runs?.find(run => run.runId === runId);
      if (known?.done) {
        finish({ runId, doneEvent: null, bridgeRun: known, streamEnded: true });
      } else if (!listing.reachable && streamErrors >= 3) {
        done = true;
        clearInterval(watchdog);
        es.close();
        reject(new Error('Lost the agent event stream and the local bridge is unreachable'));
      } else if (listing.reachable && !known && streamErrors >= 3) {
        done = true;
        clearInterval(watchdog);
        es.close();
        reject(new Error(`Agent bridge no longer knows run ${runId}`));
      }
    };
  });
}

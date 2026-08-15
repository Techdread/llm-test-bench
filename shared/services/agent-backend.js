// Browser client for the local coding-agent bridge exposed by serve.py.
//
// This module is intentionally app-neutral. Apps provide a data-root-relative
// project directory and their own task prompt; the bridge owns process launch,
// path jailing, budgets, cancellation, and event normalization.

export const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', shell: true },
  { id: 'codex', label: 'Codex', shell: true, models: true, effort: true },
  { id: 'antigravity', label: 'Antigravity', shell: true, proseOnly: true, models: true, effort: true },
  { id: 'grok', label: 'Grok', shell: true, models: true },
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
 * True only when the serve.py agent bridge is actually answering. A plain
 * static server resolves the fetch with a 404, so `res.ok` is the real test.
 * Cached per page load; pass `{ refresh: true }` to re-probe.
 */
export function isAgentBridgeReachable({ refresh = false } = {}) {
  if (!bridgeProbe || refresh) {
    bridgeProbe = fetch('/__agent/runs')
      .then(res => res.ok)
      .catch(() => false);
  }
  return bridgeProbe;
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

export async function listAgentModelOptions(agent) {
  try {
    const res = await fetch(`/__agent/models/${encodeURIComponent(agent)}`);
    if (!res.ok) return [];
    const payload = await res.json();
    if (Array.isArray(payload.modelOptions)) {
      return payload.modelOptions
        .filter(option => option?.id)
        .map(option => ({ ...option, id: option.id, label: option.label || option.id }));
    }
    return (payload.models || []).filter(Boolean).map(id => ({ id, label: id }));
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

/** Start a run, then attach to its normalized SSE event stream. */
export async function runAgent({ agent, prompt, projectDir, options, budgets, onStart, onEvent, signal }) {
  const res = await fetch('/__agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, prompt, projectDir, options: options || {}, budgets: budgets || {} }),
  }).catch((error) => {
    throw new Error(`Bridge unreachable — run the hub with serve.py (${error.message})`);
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Agent bridge error (${res.status})`);
  }
  const { runId } = await res.json();
  onStart?.(runId);
  return attachAgentRun({ runId, onEvent, signal });
}

/** Attach or reattach to a bridge stream, optionally after persisted events. */
export function attachAgentRun({ runId, onEvent, signal, fromIndex = 0 }) {
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

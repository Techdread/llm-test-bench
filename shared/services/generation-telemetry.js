// Generation Telemetry — spec 340.
//
// One tracker per model call, created by model-providers.js (and by
// agent-backend.runAgent for Forge builds that drive a CLI agent directly), so
// every hub app records without being edited.
//
// A call is a timeline of PHASES, each recorded only when it is observed:
//
//   queued        the app called the provider
//   dispatched    the request left the browser
//   spawned       the CLI process is running            (serve.py only)
//   firstOutput   the CLI printed its first line        (serve.py only)
//   sessionReady  response headers / the CLI's own session event
//   firstThought  first reasoning signal (incl. redacted-thinking token counts)
//   firstToken    first visible answer text
//   firstTool     first tool call
//   done          completion
//
// Times are milliseconds from `queued`. serve.py's own marks arrive with the
// agent's `done` event relative to its run start, and are re-anchored on this
// tracker's `dispatched` mark (applyServerTiming).
//
// Records go to serve.py (`POST /__telemetry/generation`), which appends them
// to <data-root>/_telemetry/generations/<YYYY-MM>.jsonl. Without serve.py they
// fall back to an IndexedDB ring buffer. Recording never breaks a generation:
// every failure here is swallowed and counted in telemetryHealth().

export const PHASES = Object.freeze([
  'queued', 'dispatched', 'spawned', 'firstOutput', 'sessionReady',
  'firstThought', 'firstToken', 'firstTool', 'done',
]);

export const TELEMETRY_SCHEMA = 1;
export const THINKING_SERIES_MAX = 200;
const THINKING_SAMPLE_MS = 1000;
const BODY_TEXT_MAX = 200_000;
const RING_BUFFER_MAX = 2000;
const SERVER_RETRY_MS = 60_000;
const POST_TIMEOUT_MS = 2000;
const MIN_RATE_WINDOW_MS = 500;

const deps = {
  now: () => Date.now(),
  fetch: (...args) => globalThis.fetch(...args),
  // On in a page, off under node: unit tests of apps that happen to call a
  // provider must not start posting records. Tests of this module opt in.
  enabled: typeof window !== 'undefined' && typeof document !== 'undefined',
};

export function telemetryEnabled() {
  return !!deps.enabled;
}

/** Test/embedding hook: override the clock, fetch, or switch recording off. */
export function configureTelemetry(overrides = {}) {
  Object.assign(deps, overrides);
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * The durations a reader cares about. Every value is null when the phases it
 * needs were not observed — "not reported" is never rendered as zero.
 */
export function deriveDurations(phases = {}, usage = null) {
  const has = (k) => Number.isFinite(phases[k]);
  const start = has('queued') ? phases.queued : 0;
  const ready = has('sessionReady') ? phases.sessionReady
    : (has('firstOutput') ? phases.firstOutput : null);
  const startupMs = ready === null ? null : ready - start;
  const thinkMs = has('firstThought') && has('firstToken') && phases.firstToken >= phases.firstThought
    ? phases.firstToken - phases.firstThought : null;
  const waitFirstWordMs = has('firstToken') ? phases.firstToken - start : null;
  const writeMs = has('firstToken') && has('done') ? phases.done - phases.firstToken : null;
  const totalMs = has('done') ? phases.done - start : null;
  const completion = usage?.completionTokens ?? null;
  // A write window under half a second (a one-word answer, or a CLI that
  // delivers its whole reply in one event) makes tokens/second meaningless.
  const tokensPerSecond = completion && writeMs >= MIN_RATE_WINDOW_MS
    ? Number((completion / (writeMs / 1000)).toFixed(2)) : null;
  return { startupMs, thinkMs, waitFirstWordMs, writeMs, totalMs, tokensPerSecond };
}

/**
 * ok | error | cancelled | timeout | empty. `empty` is a thinking model that
 * spent its whole budget reasoning, recorded so it stops passing for success.
 */
export function classifyOutcome({ error = null, text = '', toolCalls = 0, aborted = false } = {}) {
  if (error) {
    const message = `${error?.name || ''} ${error?.message || error}`;
    if (aborted || /AbortError|\babort|cancel/i.test(message)) return 'cancelled';
    if (/timed? ?out|timeout|deadline/i.test(message)) return 'timeout';
    return 'error';
  }
  if (!String(text || '').trim() && !toolCalls) return 'empty';
  return 'ok';
}

/** Keep a [ms, tokens] series under `max` points by dropping every other one. */
export function capSeries(series, max = THINKING_SERIES_MAX) {
  let out = series;
  while (out.length > max) {
    const last = out[out.length - 1];
    out = out.filter((_, i) => i % 2 === 0);
    if (out[out.length - 1] !== last) out.push(last);
  }
  return out;
}

export function appFromLocation(loc = globalThis.location) {
  const path = String(loc?.pathname || '');
  const first = path.split('/').filter(Boolean)[0] || '';
  if (!first || /\.html?$/i.test(first)) return 'hub';
  return first;
}

export function clientKind(ua = globalThis.navigator?.userAgent || '') {
  if (/OculusBrowser|Quest/i.test(ua)) return 'quest';
  if (/Mobi|Android/i.test(ua)) return 'mobile';
  return ua ? 'desktop' : 'node';
}

/** Plain text of a messages array, for sizing and hashing only. */
export function messagesText(messages = []) {
  return (messages || []).map((m) => {
    const c = m?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map(p => (typeof p === 'string' ? p : (p?.type === 'text' ? p.text : `[${p?.type || 'part'}]`)))
        .join('\n');
    }
    return '';
  }).join('\n\n');
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** SHA-256 where the page is a secure context; FNV-1a (labelled) where not. */
export async function hashText(text) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== 'undefined') {
    try {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      return `sha256:${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
    } catch { /* fall through */ }
  }
  return `fnv1a:${fnv1a(text)}`;
}

function responseText(result) {
  if (typeof result === 'string') return { text: result, toolCalls: 0 };
  const message = result?.choices?.[0]?.message;
  if (message) {
    return { text: typeof message.content === 'string' ? message.content : '', toolCalls: message.tool_calls?.length || 0 };
  }
  if (typeof result?.text === 'string') return { text: result.text, toolCalls: 0 };
  return { text: '', toolCalls: 0 };
}

function newId(now) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `gen_${now.toString(36)}_${rand}`;
}

function paramsSummary(params) {
  if (!params || typeof params !== 'object') return null;
  const keep = {};
  for (const key of ['reasoning', 'reasoning_effort', 'temperature', 'top_p', 'max_tokens', 'maxTokens']) {
    if (params[key] !== undefined) keep[key] = params[key];
  }
  return Object.keys(keep).length ? keep : null;
}

// ── In-flight registry (drives the live status chip) ─────────────────────

const inFlight = new Map();
const listeners = new Set();

function notify() {
  const list = getInFlight();
  for (const fn of listeners) {
    try { fn(list); } catch { /* a broken listener must not affect generation */ }
  }
}

export function getInFlight() {
  return [...inFlight.values()].map(t => t.snapshot());
}

/** Subscribe to the in-flight list; returns an unsubscribe function. */
export function subscribeInFlight(fn) {
  listeners.add(fn);
  try { fn(getInFlight()); } catch { /* ignore */ }
  return () => listeners.delete(fn);
}

// ── Tracker ──────────────────────────────────────────────────────────────

export function phaseLabel(phase) {
  switch (phase) {
    case 'queued': return 'Queued';
    case 'dispatched': return 'Sending';
    case 'spawned': return 'Starting';
    case 'firstOutput': return 'Starting';
    case 'sessionReady': return 'Waiting for model';
    case 'firstThought': return 'Thinking';
    case 'firstToken': return 'Writing';
    case 'firstTool': return 'Using tools';
    case 'done': return 'Done';
    default: return phase || '';
  }
}

/**
 * Start tracking one call.
 * meta: { entry, provider: {id,type,name}, modelId, app?, appTitle?, params?,
 *         promptText?, streamed?, ensemble?, agentId? }
 */
export function startGeneration(meta = {}) {
  const queuedAt = deps.now();
  const id = newId(queuedAt);
  const phases = { queued: 0 };
  let latest = 'queued';
  let usage = null;
  let finishReason = null;
  let thinkingTokens = 0;
  let thinkingSeries = [];
  let lastSampleAt = -Infinity;
  let outputChars = 0;
  let serverRun = null;
  let note = '';
  let finished = false;
  const clientMarks = {};

  const rel = (abs) => Math.max(0, Math.round(abs - queuedAt));

  const tracker = {
    id,
    meta,
    get phases() { return { ...phases }; },

    /** First occurrence wins; `at` is an absolute epoch-ms override. */
    mark(phase, at) {
      if (finished || !PHASES.includes(phase) || Number.isFinite(phases[phase])) return;
      phases[phase] = rel(at ?? deps.now());
      clientMarks[phase] = true;
      if (PHASES.indexOf(phase) >= PHASES.indexOf(latest)) latest = phase;
      notify();
    },

    setUsage(u) { if (u) usage = { ...(usage || {}), ...u }; },
    setFinishReason(r) { if (r) finishReason = r; },
    setServerRun(info) { serverRun = { ...(serverRun || {}), ...info }; },

    /** A short live status line for the chip (e.g. an ensemble's "2/3 drafts · judging"). */
    note(text) {
      const next = String(text || '');
      if (next !== note && !finished) { note = next; notify(); }
    },

    /** Running thinking-token estimate (redacted thinking's only signal). */
    thinking(tokens) {
      const n = Number(tokens) || 0;
      if (n <= 0 || finished) return;
      thinkingTokens = n;
      tracker.mark('firstThought');
      const t = rel(deps.now());
      if (t - lastSampleAt >= THINKING_SAMPLE_MS) {
        thinkingSeries = capSeries([...thinkingSeries, [t, n]]);
        lastSampleAt = t;
      }
      notify();
    },

    /** Accumulated streamed text length (the app's onChunk convention). */
    progress(text) {
      const len = typeof text === 'string' ? text.length : 0;
      if (len > 0) tracker.mark('firstToken');
      if (len !== outputChars) { outputChars = len; notify(); }
    },

    /**
     * Merge serve.py's phase marks (ms from its run start) onto this timeline,
     * anchored on `dispatched`. Server marks win: the bridge sees the process
     * directly, the browser only sees what the SSE stream relays later.
     */
    applyServerTiming(timing) {
      if (!timing || typeof timing !== 'object') return;
      const anchor = Number.isFinite(phases.dispatched) ? phases.dispatched : 0;
      for (const phase of ['spawned', 'firstOutput', 'sessionReady', 'firstThought', 'firstToken', 'firstTool']) {
        const ms = Number(timing[phase]);
        if (Number.isFinite(ms)) phases[phase] = anchor + Math.max(0, Math.round(ms));
      }
      if (Array.isArray(timing.thinkingSeries) && timing.thinkingSeries.length) {
        thinkingSeries = capSeries(timing.thinkingSeries
          .filter(p => Array.isArray(p) && p.length === 2)
          .map(([ms, n]) => [anchor + Math.round(ms), Number(n) || 0]));
        thinkingTokens = Math.max(thinkingTokens, ...thinkingSeries.map(p => p[1]));
      }
    },

    /** Wrap an app's onChunk so the tracker sees output without changing it. */
    wrapOnChunk(onChunk) {
      if (typeof onChunk !== 'function') return onChunk;
      return (text, ...rest) => {
        tracker.progress(text);
        return onChunk(text, ...rest);
      };
    },

    snapshot() {
      const elapsedMs = rel(deps.now());
      return {
        id,
        app: meta.app || appFromLocation(),
        providerId: meta.provider?.id || '',
        providerName: meta.provider?.name || meta.provider?.id || '',
        providerType: meta.provider?.type || '',
        modelId: meta.modelId || '',
        entry: meta.entry || '',
        phase: latest,
        label: phaseLabel(latest),
        elapsedMs,
        phaseElapsedMs: elapsedMs - (phases[latest] ?? 0),
        thinkingTokens,
        outputChars,
        note,
        startedAt: queuedAt,
      };
    },

    /**
     * Seal the record. `result` is whatever the provider returned; `error` the
     * thrown error. Returns the record; posting happens in the background.
     */
    finish({ result, error = null, aborted = false, toolCalls: toolCallCount = null } = {}) {
      if (finished) return null;
      tracker.mark('done');
      finished = true;
      inFlight.delete(id);
      notify();

      const parsed = responseText(result);
      const text = parsed.text;
      // An agent run's product is often files, not prose: its tool activity
      // counts, so a build that wrote a project is not recorded as `empty`.
      const toolCalls = toolCallCount ?? parsed.toolCalls;
      // A non-streamed answer reaches the app all at once, at `done`.
      if (!error && !Number.isFinite(phases.firstToken) && text) phases.firstToken = phases.done;
      const outcome = classifyOutcome({ error, text, toolCalls, aborted });
      const promptText = String(meta.promptText || '');

      const record = {
        schema: TELEMETRY_SCHEMA,
        id,
        at: new Date(queuedAt).toISOString(),
        app: meta.app || appFromLocation(),
        appTitle: meta.appTitle || null,
        entry: meta.entry || null,
        provider: {
          id: meta.provider?.id || null,
          type: meta.provider?.type || null,
          name: meta.provider?.name || null,
        },
        modelId: meta.modelId || null,
        agentId: meta.agentId || null,
        ensemble: meta.ensemble || null,
        streamed: meta.streamed ?? null,
        phases: { ...phases },
        observed: Object.keys(phases),
        durations: deriveDurations(phases, usage),
        thinkingTokens: thinkingTokens || usage?.reasoningTokens || null,
        thinkingTokensSeries: thinkingSeries.length ? thinkingSeries : null,
        usage,
        cost: usage && Number.isFinite(usage.cost)
          ? { usd: usage.cost, source: usage.costSource || 'provider-usage' }
          : null,
        finishReason,
        params: paramsSummary(meta.params),
        outcome,
        error: error ? String(error?.message || error).slice(0, 500) : null,
        promptChars: promptText.length,
        responseChars: text.length,
        toolCalls,
        promptHash: null,
        serverRun,
        client: {
          origin: globalThis.location?.origin || null,
          kind: clientKind(),
        },
      };

      // A caller that needs the sealed record (the ensemble engine reads each
      // member's reported cost) gets it synchronously; a throwing hook is ignored.
      try { meta.onRecord?.(record); } catch { /* not the generation's problem */ }

      const body = { prompt: promptText.slice(0, BODY_TEXT_MAX), response: text.slice(0, BODY_TEXT_MAX) };
      (async () => {
        try { record.promptHash = await hashText(promptText); } catch { /* keep null */ }
        await postRecord(record, body);
      })();
      return record;
    },
  };

  inFlight.set(id, tracker);
  notify();
  return tracker;
}

/**
 * Run `fn(tracker)` under a new tracker and seal it with the outcome.
 * The provider's result or error passes through untouched.
 */
export async function withTelemetry(meta, fn) {
  if (!deps.enabled) return fn(null);
  let tracker = null;
  try { tracker = startGeneration(meta); } catch { return fn(null); }
  try {
    const result = await fn(tracker);
    try { tracker.finish({ result }); } catch { health.failures++; }
    return result;
  } catch (error) {
    try { tracker.finish({ error, aborted: meta?.signal?.aborted }); } catch { health.failures++; }
    throw error;
  }
}

// ── Persistence ──────────────────────────────────────────────────────────

const health = { posted: 0, buffered: 0, failures: 0, server: 'unknown', retryAt: 0 };

export function telemetryHealth() {
  return { ...health };
}

async function postRecord(record, body) {
  const now = deps.now();
  if (health.server === 'absent' && now < health.retryAt) {
    await bufferLocally(record);
    return;
  }
  try {
    const res = await deps.fetch('/__telemetry/generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record, body }),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(POST_TIMEOUT_MS) : undefined,
    });
    if (res?.ok) {
      health.server = 'present';
      health.posted++;
      return;
    }
    if (res?.status === 404 || res?.status === 501) {
      health.server = 'absent';
      health.retryAt = now + SERVER_RETRY_MS;
    }
    health.failures++;
    await bufferLocally(record);
  } catch {
    health.failures++;
    await bufferLocally(record);
  }
}

const DB_NAME = 'generation-telemetry';
const STORE = 'records';

function openDb() {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) { reject(new Error('no indexedDB')); return; }
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function bufferLocally(record) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(record);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const excess = countReq.result - RING_BUFFER_MAX;
        if (excess > 0) {
          let removed = 0;
          store.index('at').openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor || removed >= excess) return;
            cursor.delete();
            removed++;
            cursor.continue();
          };
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    health.buffered++;
  } catch {
    // No IndexedDB (node, locked-down browser): the record is dropped, the
    // generation is not affected.
  }
}

/** Records held in this browser's local ring buffer (no serve.py). */
export async function readLocalRecords() {
  try {
    const db = await openDb();
    const records = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records;
  } catch {
    return [];
  }
}

// ── "Usually" hints for the status chip ──────────────────────────────────

const typicalCache = new Map();
const TYPICAL_TTL_MS = 5 * 60_000;

/**
 * p25–p75 of think / wait-to-first-word for one provider+model over the last
 * 30 days, computed server-side. Resolves null without serve.py or history.
 */
export function fetchTypical(providerId, modelId) {
  const key = `${providerId}::${modelId}`;
  const hit = typicalCache.get(key);
  // The promise is cached, not the value: a second caller while the first
  // request is in flight shares its answer instead of reading a placeholder.
  if (hit && deps.now() - hit.at < TYPICAL_TTL_MS) return hit.promise;
  const qs = new URLSearchParams({ provider: providerId || '', model: modelId || '' });
  const promise = Promise.resolve()
    .then(() => deps.fetch(`/__telemetry/typical?${qs}`))
    .then(res => (res?.ok ? res.json() : null))
    .catch(() => null);
  typicalCache.set(key, { at: deps.now(), promise });
  return promise;
}

// ── CLI agent bridge events ──────────────────────────────────────────────

const TOOL_EVENT_TYPES = new Set(['tool', 'shell', 'file', 'execute_code', 'json_object']);

/** Map the bridge's `{inputTokens, outputTokens}` usage to the hub shape. */
export function agentUsage(usage, costUsd) {
  if (!usage && !Number.isFinite(costUsd)) return null;
  const out = {
    promptTokens: usage?.inputTokens ?? null,
    completionTokens: usage?.outputTokens ?? null,
    totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || null,
    reasoningTokens: usage?.reasoningTokens ?? null,
  };
  if (Number.isFinite(costUsd)) { out.cost = costUsd; out.costSource = 'agent-reported'; }
  return out;
}

/**
 * Feed one normalized bridge event (the `onmessage` stream) into a tracker.
 * Returns true when the event was tool activity, for the caller's count.
 */
export function observeAgentEvent(tracker, event) {
  if (!tracker || !event) return false;
  switch (event.type) {
    case 'session':
      // serve.py emits a synthetic session before spawning for most agents;
      // the authoritative sessionReady comes back in the done event's timing.
      return false;
    case 'reasoning':
      tracker.mark('firstThought');
      return false;
    case 'message':
      if (event.text) tracker.mark('firstToken');
      return false;
    case 'done':
      tracker.applyServerTiming(event.timing);
      tracker.setUsage(agentUsage(event.usage || event.tokenUsage, event.costUsd));
      return false;
    default:
      if (TOOL_EVENT_TYPES.has(event.type)) {
        tracker.mark('firstTool');
        return true;
      }
      return false;
  }
}

/** Feed one `live` frame ({text, kind, thinkingTokens}) into a tracker. */
export function observeAgentLive(tracker, frame) {
  if (!tracker || !frame) return;
  if (frame.thinkingTokens) tracker.thinking(frame.thinkingTokens);
  if (!frame.text) return;
  if (frame.kind === 'reasoning' || frame.kind === 'thinking') tracker.mark('firstThought');
  else if (frame.kind === 'tool') tracker.mark('firstTool');
  else tracker.mark('firstToken');
}

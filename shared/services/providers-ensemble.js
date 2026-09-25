// Model ensembles as an ordinary provider — spec 341.
//
// A synthetic provider "Ensembles" (id `ensemble`) whose models are the
// user's named ensembles, so every app's existing model dropdown can pick
// `Ensemble · HTML trio` exactly like one model — the same leverage that made
// the CLI agents appear hub-wide without app edits.
//
// Members, judges and synthesizers are called back through model-providers
// (bound at load via bindProviderApi — injected rather than imported, so the
// two modules do not import each other), which means every one of those calls
// is an ordinary spec-340 telemetry record tagged with the ensemble run.

import {
  ensemblesReady, listEnsembles, getEnsemble, ENSEMBLE_PROVIDER_ID,
} from './ensembles.js';
import { runEnsemble, EnsembleRefusedError } from './ensemble-engine.js';
import { fetchTypical } from './generation-telemetry.js';

export const PROVIDER_TYPE = 'ensemble';
export { ENSEMBLE_PROVIDER_ID, EnsembleRefusedError };

let providerApi = null;

/** model-providers hands over the entry points members are called through. */
export function bindProviderApi(api) {
  providerApi = api;
}

export function createProvider() {
  return {
    id: ENSEMBLE_PROVIDER_ID,
    type: PROVIDER_TYPE,
    name: 'Ensembles',
    enabled: true,
    // Owned by the ensemble store: never written to providers.json.
    synthetic: true,
    tags: ['ensemble'],
  };
}

export function isEnsembleProviderId(providerId) {
  return providerId === ENSEMBLE_PROVIDER_ID;
}

/** True when at least one ensemble exists (the provider is only offered then). */
export function hasEnsembles() {
  return listEnsembles().length > 0;
}

export function validateProvider() {
  return { valid: true };
}

export async function testConnection() {
  await ensemblesReady();
  return { ok: true, modelCount: listEnsembles().length };
}

export async function fetchModels(provider = createProvider()) {
  await ensemblesReady();
  return listEnsembles().map(e => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId: e.id,
    name: `Ensemble · ${e.name}`,
    displayLabel: `${provider.name} / ${e.name}`,
    supportsStreaming: true,
    contextLength: null,
    pricing: null,
    tags: ['ensemble', e.strategy],
    raw: { strategy: e.strategy, members: e.members.length, version: e.version },
  }));
}

// ── Engine dependencies ────────────────────────────────────────────────────

async function persistRun(payload) {
  try {
    const res = await fetch('/__ensembles/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 409) return;
  } catch { /* fall through to the local buffer */ }
  await bufferRunLocally(payload);
}

function engineDeps({ ensembleId, appTitle }) {
  if (!providerApi) throw new Error('Ensembles are not wired to the provider layer (model-providers.js did not bind).');
  return {
    callModel: async ({ providerId, modelId, messages, params, onChunk, signal, role, runId }) => {
      let record = null;
      try {
        const response = await providerApi.streamChatCompletion({
          providerId, modelId, messages, params, signal, appTitle,
          // Streamed so each member's first word is observed, even though the
          // caller only ever sees the final answer.
          onChunk: (text) => onChunk?.(text),
          returnResponse: true,
          telemetryMeta: { ensemble: { runId, role, ensembleId }, onRecord: (r) => { record = r; } },
        });
        const choice = response?.choices?.[0];
        return { text: typeof choice?.message?.content === 'string' ? choice.message.content : '', finishReason: choice?.finish_reason || null, record };
      } catch (error) {
        if (error && typeof error === 'object') error.record = record;
        throw error;
      }
    },
    estimateCost: async (ref) => (await fetchTypical(ref.providerId, ref.modelId))?.costUsd?.p50 ?? null,
    graceFor: async (refs) => {
      const typical = await Promise.all(refs.map(r => fetchTypical(r.providerId, r.modelId)));
      const p75s = typical.map(t => t?.total?.p75).filter(Number.isFinite);
      return p75s.length ? Math.max(...p75s) : null;
    },
    contextLengthFor: async (ref) => {
      const models = await providerApi.fetchProviderModels(ref.providerId);
      return models.find(m => m.modelId === ref.modelId)?.contextLength ?? null;
    },
    persistRun,
  };
}

/**
 * Run one stored ensemble. Used by the provider entry points below and by
 * Ensemble Studio's test bench (which also wants onProgress).
 */
export async function runEnsembleById({
  ensembleId, messages, params = null, onChunk = null, onProgress = null, signal = null,
  telemetry = null, appTitle = null,
}) {
  await ensemblesReady();
  const ensemble = getEnsemble(ensembleId);
  if (!ensemble || ensemble.hidden) {
    throw new Error(`Ensemble "${ensembleId}" was deleted or does not exist — pick another model.`);
  }
  let finished = 0;
  const total = ensemble.members.length;
  telemetry?.note(`Ensemble · 0/${total} drafts`);
  const progress = (event) => {
    if (event.type === 'member' && ['done', 'failed', 'cancelled'].includes(event.status)) {
      finished++;
      telemetry?.note(`Ensemble · ${finished}/${total} drafts`);
    } else if (event.type === 'stage' && event.stage !== 'done') {
      telemetry?.note(`Ensemble · ${finished}/${total} drafts · ${event.stage}`);
    }
    onProgress?.(event);
  };
  const scorer = typeof params?.ensemble?.scorer === 'function' ? params.ensemble.scorer : null;
  const result = await runEnsemble({
    ensemble, messages, params, onChunk, onProgress: progress, signal, scorer,
    app: typeof location !== 'undefined' ? (location.pathname.split('/').filter(Boolean)[0] || 'hub') : null,
    appTitle,
    deps: engineDeps({ ensembleId, appTitle }),
  });
  telemetry?.setServerRun({ ensembleRunId: result.runId, month: result.run.month });
  return result;
}

// ── Provider API (the shape every adapter implements) ──────────────────────

function refuseTools(tools) {
  if (tools?.length) {
    throw new Error('Ensembles: tool-calling requests are not supported — pick a single model for tool use.');
  }
}

function openAiResponse(text) {
  return { choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
}

export async function streamChat({ modelId, systemPrompt, userPrompt, onChunk, params, onStats, signal, telemetry, appTitle }) {
  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    { role: 'user', content: userPrompt },
  ];
  const started = Date.now();
  const result = await runEnsembleById({ ensembleId: modelId, messages, params, onChunk, signal, telemetry, appTitle });
  onStats?.({ durationMs: Date.now() - started, ensembleRunId: result.runId, winner: result.run.winner, flags: result.run.flags });
  return result.text;
}

export async function completeChat({ modelId, systemPrompt, userPrompt, telemetry, appTitle }) {
  return streamChat({ modelId, systemPrompt, userPrompt, onChunk: null, telemetry, appTitle });
}

export async function chatCompletion({ modelId, messages, tools, telemetry, appTitle }) {
  refuseTools(tools);
  const result = await runEnsembleById({ ensembleId: modelId, messages, telemetry, appTitle });
  return openAiResponse(result.text);
}

export async function streamChatCompletion({ modelId, messages, tools, onChunk, returnResponse = false, signal, params, telemetry, appTitle }) {
  refuseTools(tools);
  const result = await runEnsembleById({
    ensembleId: modelId, messages, params, signal, telemetry, appTitle,
    onChunk: onChunk ? (text) => onChunk(text, { content: text, toolCalls: [] }) : null,
  });
  return returnResponse ? openAiResponse(result.text) : result.text;
}

// ── Local buffer when serve.py is not the server ──────────────────────────

const DB_NAME = 'ensemble-runs';
const STORE = 'runs';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'runId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function bufferRunLocally(payload) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(payload);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* nowhere to keep it */ }
}

/** Runs kept in this browser because serve.py was not available. */
export async function listLocalEnsembleRuns() {
  try {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  } catch {
    return [];
  }
}

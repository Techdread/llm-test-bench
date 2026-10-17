// Shared AI Coach service — landed by spec 240, consumed by every lab.
//
// Three pedagogical modes (every coach panel exposes all three):
//
//   ask(question, ctx)         user asks, LLM answers grounded in ctx
//   quiz(ctx)                  LLM proposes a question scoped to ctx
//   gradeAnswer(q, a, ctx)     LLM grades user's answer with a structured rubric
//   explain(element, ctx)      "explain this element" with state context attached
//
// Per-lab requirements (AGENTS.md § AI Coach):
//   - <lab>/services/openrouter.js  re-export with app system prompt
//   - <lab>/services/coachContext.js with buildCoachContext({...})
//   - editable policy at <root>/<lab>/config/coach-policy.json
//   - transcripts persisted append-only to IndexedDB <lab>-coach DB
//
// The lab passes its system prompt, the coach context, the per-lab dbName,
// and any policy overrides on every call — this service has no per-lab state.

// Provider-neutral coach: routes through shared/services/model-providers.js
// which dispatches to OpenRouter / LM Studio / custom adapters based on the
// chosen provider's `type`. The OpenRouter providers-openrouter module is
// still imported so `hasApiKey()` can drive the missing-key setup prompt for
// OpenRouter-routed coaches; LM Studio + custom providers don't need a key.

import { streamChat as providerStreamChat, getProvider, getDefaultProvider, getDefaultModel } from './model-providers.js';
import { hasApiKey as hasOpenRouterKey } from './providers-openrouter.js';

export const DEFAULT_PROVIDER_ID = 'openrouter';
export const DEFAULT_MODEL_ID = 'google/gemma-3-12b-it:free';

// Coach policy shape — labs override fields they care about, defaults fill
// the rest. Stored on disk at <root>/<lab>/config/coach-policy.json by each
// lab's policy store (see eleven-plus-marking-coach/services/markingPolicyStore.js
// for the reference pattern).
export function defaultCoachPolicy() {
  return {
    tone: 'warm-but-precise',           // 'socratic' | 'direct' | 'warm-but-precise'
    level: 'undergraduate first-year',
    hintGenerosity: 'on-request',       // 'on-request' | 'liberal' | 'sparse'
    language: 'en',
    providerId: DEFAULT_PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    maxInputTokens: 8000,
    maxOutputTokens: 2000,
  };
}

export function mergeCoachPolicy(overrides) {
  return { ...defaultCoachPolicy(), ...(overrides || {}) };
}

// chars/4 is the standard rough estimator. Cheap, conservative — high enough
// to flag long contexts before OpenRouter rejects them; low enough that it
// doesn't false-alarm on short prompts.
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function policyBlock(policy) {
  return [
    `Coach policy:`,
    `- tone: ${policy.tone}`,
    `- level: ${policy.level}`,
    `- hint generosity: ${policy.hintGenerosity}`,
    `- language: ${policy.language}`,
  ].join('\n');
}

function buildMessages({ systemPrompt, policy, contextChunk, userTurn }) {
  const fullSystem = `${systemPrompt}\n\n${policyBlock(policy)}`;
  const userBody = contextChunk
    ? `Current lab state:\n\n\`\`\`json\n${JSON.stringify(contextChunk, null, 2)}\n\`\`\`\n\n${userTurn}`
    : userTurn;
  return { system: fullSystem, user: userBody };
}

function assertBudget(policy, system, user) {
  const inTokens = estimateTokens(system) + estimateTokens(user);
  if (inTokens > policy.maxInputTokens) {
    throw new Error(
      `Coach input would be ~${inTokens} tokens, over the ${policy.maxInputTokens} cap. ` +
      `Edit the coach policy or shrink the context.`
    );
  }
  return inTokens;
}

// Resolve the provider + model the coach should actually call. Falls back
// through: explicit override → policy → user's hub default → OpenRouter
// default. The provider-neutral streamChat dispatches to the right adapter.
function routeStreamChat({ providerId, modelId, systemPrompt, userPrompt, appTitle, onChunk }) {
  const fallbackProviderId = providerId || getDefaultProvider() || DEFAULT_PROVIDER_ID;
  const fallbackModelId = modelId || getDefaultModel(fallbackProviderId) || DEFAULT_MODEL_ID;
  return providerStreamChat({
    providerId: fallbackProviderId,
    modelId: fallbackModelId,
    systemPrompt,
    userPrompt,
    appTitle,
    onChunk,
  });
}

/**
 * Does the provider the coach is about to use need an API key it doesn't have?
 * Currently the only provider type that needs a key is OpenRouter.
 *
 * @param {string} [providerId]  Falls back to the policy default → hub default.
 * @returns {boolean} true if the call is ready to fire.
 */
export function isProviderReady(providerId) {
  const id = providerId || getDefaultProvider() || DEFAULT_PROVIDER_ID;
  const prov = getProvider(id);
  if (!prov) return false;
  if (prov.enabled === false) return false;
  if (prov.type === 'openrouter') return hasOpenRouterKey();
  return true;  // lmstudio / custom — no key needed
}

// Back-compat shim: the panel imported `hasApiKey` from ai-coach.js as the
// "is the coach usable" check. New callers should prefer isProviderReady().
export function hasApiKey(providerId) {
  return isProviderReady(providerId);
}

// ── Transcript persistence (append-only, per-lab IndexedDB) ──
//
// Convention: pass `dbName: '<app-id>-coach'`. The coach DB MUST be separate
// from the lab's own IndexedDB — opening an existing DB at v1 with a missing
// store will not trigger onupgradeneeded, so the `coach-transcripts` store
// would silently fail to be created. Use `coachDbName(appId)` to be safe.

const TRANSCRIPT_STORE = 'coach-transcripts';
const TRANSCRIPT_DB_VERSION = 1;

export function coachDbName(appId) {
  if (!appId) throw new Error('appId required');
  return `${appId}-coach`;
}

const _dbCache = new Map();

function openCoachDB(dbName) {
  if (_dbCache.has(dbName)) return _dbCache.get(dbName);
  const promise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, TRANSCRIPT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) {
        const store = db.createObjectStore(TRANSCRIPT_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('lessonId', 'lessonId', { unique: false });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  _dbCache.set(dbName, promise);
  return promise;
}

export async function appendTranscript(dbName, entry) {
  const db = await openCoachDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSCRIPT_STORE, 'readwrite');
    const req = tx.objectStore(TRANSCRIPT_STORE).add({ ts: new Date().toISOString(), ...entry });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listTranscripts(dbName, { lessonId } = {}) {
  const db = await openCoachDB(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSCRIPT_STORE, 'readonly');
    const store = tx.objectStore(TRANSCRIPT_STORE);
    const out = [];
    const req = lessonId
      ? store.index('lessonId').openCursor(IDBKeyRange.only(lessonId))
      : store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { out.push(cursor.value); cursor.continue(); }
      else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Coach modes ──

/**
 * @param {Object} opts
 * @param {string} opts.dbName            Per-lab IndexedDB name (transcripts).
 * @param {string} opts.systemPrompt      Lab's coach system prompt (domain, level, rubric).
 * @param {Object} [opts.policy]          Coach policy overrides; merged onto defaults.
 * @param {string} [opts.modelId]         Override the policy/default model.
 * @param {string} [opts.appTitle]        Sent as X-Title on the OpenRouter request.
 * @param {string} [opts.lessonId]        Tags the transcript entry for per-lesson browsing.
 * @param {Object} [opts.context]         Output of <lab>/services/coachContext.js buildCoachContext.
 * @param {string} opts.question          User-asked free-text question.
 * @param {(chunk:string)=>void} [opts.onChunk]
 */
export async function ask({ dbName, systemPrompt, policy, modelId, appTitle, lessonId, context, question, onChunk }) {
  if (!question) throw new Error('question is empty');
  const p = mergeCoachPolicy(policy);
  const { system, user } = buildMessages({
    systemPrompt,
    policy: p,
    contextChunk: context,
    userTurn: `User question: ${question}\n\nAnswer grounded in the current state above. Reference specific values from the state where possible.`,
  });
  assertBudget(p, system, user);
  const answer = await routeStreamChat({
    providerId: p.providerId,
    modelId: modelId || p.modelId,
    systemPrompt: system,
    userPrompt: user,
    appTitle: appTitle || 'AI Coach',
    onChunk,
  });
  if (dbName) await appendTranscript(dbName, { mode: 'ask', lessonId, question, answer, context });
  return answer;
}

/**
 * LLM-asked question scoped to the current lab state. The lab follows up
 * with gradeAnswer() once the user responds.
 */
export async function quiz({ dbName, systemPrompt, policy, modelId, appTitle, lessonId, context, onChunk }) {
  const p = mergeCoachPolicy(policy);
  const { system, user } = buildMessages({
    systemPrompt,
    policy: p,
    contextChunk: context,
    userTurn:
      `Propose ONE quiz question scoped to the current lab state. ` +
      `Respond as a JSON object on a single line with keys: ` +
      `{ "question": string, "expectedAnswerKind": "text"|"matrix"|"vector"|"interaction", "hint": string }. ` +
      `No commentary, no code fences.`,
  });
  assertBudget(p, system, user);
  const raw = await routeStreamChat({
    providerId: p.providerId,
    modelId: modelId || p.modelId,
    systemPrompt: system,
    userPrompt: user,
    appTitle: appTitle || 'AI Coach',
    onChunk,
  });
  let parsed = null;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, '')); } catch { /* surface raw */ }
  if (dbName) await appendTranscript(dbName, { mode: 'quiz', lessonId, question: parsed?.question || raw, raw, context });
  return parsed || { question: raw, expectedAnswerKind: 'text', hint: '' };
}

/**
 * Structured grading of the user's answer to a quiz question. Returns
 * { score, feedback, misconceptions, nextStep } — the rubric shape every
 * lab agrees on.
 */
export async function gradeAnswer({ dbName, systemPrompt, policy, modelId, appTitle, lessonId, context, question, answer, onChunk }) {
  if (!question) throw new Error('question is required');
  if (answer == null) throw new Error('answer is required');
  const p = mergeCoachPolicy(policy);
  const userTurn = [
    `Question: ${question}`,
    `Student answer: ${typeof answer === 'string' ? answer : JSON.stringify(answer)}`,
    ``,
    `Grade the answer. Respond as a JSON object on a single line with keys:`,
    `{ "score": number /* 0..1 */, "feedback": string, "misconceptions": string[], "nextStep": string }.`,
    `No commentary, no code fences.`,
  ].join('\n');
  const { system, user } = buildMessages({ systemPrompt, policy: p, contextChunk: context, userTurn });
  assertBudget(p, system, user);
  const raw = await routeStreamChat({
    providerId: p.providerId,
    modelId: modelId || p.modelId,
    systemPrompt: system,
    userPrompt: user,
    appTitle: appTitle || 'AI Coach',
    onChunk,
  });
  let parsed = null;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\n?|\n?```$/g, '')); } catch { /* surface raw */ }
  const result = parsed || { score: null, feedback: raw, misconceptions: [], nextStep: '' };
  if (dbName) await appendTranscript(dbName, { mode: 'grade', lessonId, question, answer, result, context });
  return result;
}

/**
 * "Explain this element" — grounded explanation of a UI element the user
 * clicked (a matrix cell, a graph node, a slider, …). The element descriptor
 * is whatever the lab wants; it's stringified into the prompt.
 */
export async function explain({ dbName, systemPrompt, policy, modelId, appTitle, lessonId, context, element, onChunk }) {
  if (!element) throw new Error('element is required');
  const p = mergeCoachPolicy(policy);
  const { system, user } = buildMessages({
    systemPrompt,
    policy: p,
    contextChunk: context,
    userTurn:
      `Explain this UI element to the user, grounded in the current state. ` +
      `Element:\n\n\`\`\`json\n${JSON.stringify(element, null, 2)}\n\`\`\`\n\n` +
      `Keep it short (2–4 sentences). Reference the element's current value.`,
  });
  assertBudget(p, system, user);
  const answer = await routeStreamChat({
    providerId: p.providerId,
    modelId: modelId || p.modelId,
    systemPrompt: system,
    userPrompt: user,
    appTitle: appTitle || 'AI Coach',
    onChunk,
  });
  if (dbName) await appendTranscript(dbName, { mode: 'explain', lessonId, element, answer, context });
  return answer;
}

// (hasApiKey + isProviderReady are exported above. The panel reads them
// directly — no re-export needed.)

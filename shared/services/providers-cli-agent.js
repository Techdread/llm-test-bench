// Local CLI agent provider adapter.
//
// Presents each coding agent behind the serve.py bridge (Claude Code, Codex,
// Antigravity, Grok) as an ordinary provider, so any app that already talks to
// `model-providers.js` can pick one from its normal model dropdown and generate
// with it — no per-app agent wiring, no separate button.
//
// The providers are synthetic: they are never written to `providers.json` and
// never appear in provider settings. `model-providers.js` mints them on the fly
// while the bridge answers, and drops them when it does not (a plain
// `http.server` 404s `/__agent/*`, so the rows simply vanish).
//
// What an agent run is NOT: a chat turn. There is no conversation state on the
// bridge, so a multi-message history is flattened into one prompt, sampling
// sampling params are meaningless (the CLI owns them), while Antigravity's
// reasoning-effort parameter is forwarded. Tool-calling requests are refused
// rather than silently ignored.

import { runAgent, listAgentModelOptions, isAgentBridgeReachable, AGENTS } from './agent-backend.js';
import { createRunStats } from './gen-params.js';

export const PROVIDER_TYPE = 'cli-agent';

/** `cli-agent:claude-code` — the same id scheme executor-models.js uses. */
export const CLI_PROVIDER_PREFIX = 'cli-agent:';
/** Sentinel model meaning "whatever the CLI itself defaults to". */
export const CLI_DEFAULT_MODEL = '__cli_default__';

// Generous but bounded: a CLI agent legitimately thinks for minutes, and the
// bridge watchdog — not the browser — is the authority on when to give up.
const DEFAULT_BUDGETS = {
  maxAgentSeconds: 900,
  idleTimeoutSeconds: 180,
  maxTurns: 40,
};

export function isCliAgentProviderId(providerId) {
  return String(providerId || '').startsWith(CLI_PROVIDER_PREFIX);
}

export function agentIdFromProviderId(providerId) {
  return String(providerId || '').slice(CLI_PROVIDER_PREFIX.length);
}

/** The synthetic provider entry for one agent descriptor from AGENTS. */
export function createProvider(agent) {
  return {
    id: `${CLI_PROVIDER_PREFIX}${agent.id}`,
    type: PROVIDER_TYPE,
    name: `${agent.label} CLI`,
    agentId: agent.id,
    enabled: true,
    // Marks the entry as bridge-owned so the registry never persists it.
    synthetic: true,
    tags: ['local', 'cli-agent'],
  };
}

/** Every agent the bridge knows about, as provider entries. */
export function listProviders() {
  return AGENTS.map(createProvider);
}

/** Resolve any `cli-agent:*` id to its provider, reachable or not. */
export function providerFromId(providerId) {
  const agent = AGENTS.find(a => a.id === agentIdFromProviderId(providerId));
  return agent ? createProvider(agent) : null;
}

export function validateProvider(provider) {
  if (!provider?.agentId) return { valid: false, error: 'Missing agent id' };
  if (!AGENTS.some(a => a.id === provider.agentId)) {
    return { valid: false, error: `Unknown CLI agent: ${provider.agentId}` };
  }
  return { valid: true };
}

export async function testConnection(provider) {
  if (!(await isAgentBridgeReachable({ refresh: true }))) {
    return { ok: false, error: 'Agent bridge unreachable — run the hub with serve.py' };
  }
  const models = await listAgentModelOptions(provider.agentId);
  // Zero listed models is not a failure: Claude Code and Codex both run fine on
  // their own default, and the "CLI default" row always exists.
  return { ok: true, modelCount: models.length + 1 };
}

/**
 * One row for the agent's own default plus one per model it can enumerate.
 * Priced at zero so `freeOnly` filters keep local agents rather than dropping
 * them for having no price list.
 */
export async function fetchModels(provider) {
  const agent = AGENTS.find(a => a.id === provider.agentId);
  if (!agent) throw new Error(`Unknown CLI agent: ${provider.agentId}`);
  if (!(await isAgentBridgeReachable())) {
    throw new Error(`${provider.name}: agent bridge unreachable — run the hub with serve.py`);
  }
  const discovered = await listAgentModelOptions(agent.id);
  const models = [...new Map(discovered.filter(option => option?.id).map(option => [option.id, option])).values()];
  const row = (modelId, name) => ({
    providerId: provider.id,
    providerType: PROVIDER_TYPE,
    providerName: provider.name,
    modelId,
    name,
    displayLabel: `${provider.name} / ${name}`,
    supportsStreaming: true,
    contextLength: null,
    pricing: { prompt: '0', completion: '0' },
    tags: provider.tags || [],
    raw: { agentId: agent.id },
  });
  return [row(CLI_DEFAULT_MODEL, 'CLI default'), ...models.map(model => row(model.id, model.label || model.id))];
}

// ── Prompt assembly ──

function partToText(part) {
  if (typeof part === 'string') return part;
  if (part?.type === 'text') return part.text || '';
  // CLI agents take a text prompt on argv; an inline image cannot ride along.
  if (part?.type === 'image_url') return '[image omitted — CLI agents take text prompts only]';
  return '';
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(partToText).filter(Boolean).join('\n');
  return '';
}

const ROLE_LABELS = { system: 'System', user: 'User', assistant: 'Assistant', tool: 'Tool' };

/**
 * Flatten a message array into the single prompt string the bridge takes.
 * A lone user message is passed through verbatim — labelling a one-shot prompt
 * would put words in the agent's input that the app never wrote.
 */
export function messagesToPrompt(messages = []) {
  const rendered = messages
    .map(m => ({ role: m?.role || 'user', text: contentToText(m?.content).trim() }))
    .filter(m => m.text);
  if (rendered.length === 0) return '';
  if (rendered.length === 1 && rendered[0].role === 'user') return rendered[0].text;
  const [first] = rendered;
  if (rendered.length === 2 && first.role === 'system' && rendered[1].role === 'user') {
    return `${first.text}\n\n---\n\n${rendered[1].text}`;
  }
  return rendered.map(m => `${ROLE_LABELS[m.role] || m.role}: ${m.text}`).join('\n\n');
}

/**
 * Run one agent and resolve with its answer.
 *
 * Live `message` events are streamed so the caller sees text as it lands, but
 * the returned answer prefers the run's `done` summary — for every adapter that
 * is the agent's final response, where the message stream also carries its
 * intermediate narration.
 */
function agentRunOptions(provider, modelId, params) {
  const options = modelId && modelId !== CLI_DEFAULT_MODEL ? { model: modelId } : {};
  const effort = params?.reasoning_effort || params?.reasoning?.effort;
  if (provider.agentId === 'antigravity' && ['low', 'medium', 'high'].includes(effort)) {
    options.effort = effort;
  } else if (provider.agentId === 'codex' && ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) {
    options.effort = effort;
  }
  return options;
}

async function runAgentChat({ provider, modelId, prompt, onChunk, signal, budgets, onEvent, params }) {
  if (!prompt.trim()) throw new Error('empty prompt');
  const stats = createRunStats();
  const messages = [];
  const errors = [];

  const result = await runAgent({
    agent: provider.agentId,
    prompt,
    // Empty: the bridge substitutes its own scratch dir under the data root, so
    // a chat-shaped call needs no project of its own.
    projectDir: '',
    options: agentRunOptions(provider, modelId, params),
    budgets: { ...DEFAULT_BUDGETS, ...(budgets || {}) },
    signal,
    onEvent: (event) => {
      onEvent?.(event);
      if (event?.type === 'message' && event.text) {
        stats.markFirstToken();
        messages.push(event.text);
        onChunk?.(messages.join('\n\n'));
      } else if (event?.type === 'reasoning') {
        stats.markReasoning();
      } else if (event?.type === 'error' && event.message) {
        errors.push(event.message);
      }
    },
  });

  const summary = (result?.doneEvent?.summary || '').trim();
  const text = summary || messages.join('\n\n').trim();
  if (!text) {
    throw new Error(errors.length
      ? `${provider.name}: ${errors.join('; ')}`
      : `${provider.name}: the agent produced no output`);
  }
  // Land the caller on the same string this returns, so a UI that rendered the
  // streamed narration ends up showing the final answer.
  if (summary && onChunk) onChunk(text);
  return { text, stats, doneEvent: result?.doneEvent || null };
}

// ── Generation API (the shape every provider adapter implements) ──

export async function streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk, signal, params, onStats }) {
  const prompt = messagesToPrompt([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  const { text, stats } = await runAgentChat({ provider, modelId, prompt, onChunk, signal, params });
  onStats?.(stats.finish());
  return text;
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null });
}

function toOpenAiResponse(text) {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
}

function refuseTools(provider, tools) {
  if (tools?.length) {
    throw new Error(`${provider.name}: local CLI agents run their own tools — tool-calling requests are not supported`);
  }
}

export async function chatCompletion({ provider, modelId, messages, tools }) {
  refuseTools(provider, tools);
  const { text } = await runAgentChat({ provider, modelId, prompt: messagesToPrompt(messages) });
  return toOpenAiResponse(text);
}

export async function streamChatCompletion({ provider, modelId, messages, tools, onChunk, returnResponse = false, signal, params }) {
  refuseTools(provider, tools);
  const { text } = await runAgentChat({
    provider,
    modelId,
    prompt: messagesToPrompt(messages),
    signal,
    params,
    onChunk: onChunk ? (accumulated => onChunk(accumulated, { content: accumulated, toolCalls: [] })) : null,
  });
  return returnResponse ? toOpenAiResponse(text) : text;
}

// Local CLI agent provider adapter.
//
// Presents each coding agent behind the serve.py bridge (Claude Code, Codex,
// Antigravity, Grok, Devin, Cursor) as an ordinary provider, so any app that already talks to
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
// sampling params are meaningless (the CLI owns them), while the reasoning
// effort is forwarded to the agents that take one (Claude Code, Codex,
// Antigravity). A caller that passes no `reasoning_effort` gets the level the
// shared picker saved for that agent + model, so every app's dropdown drives it. Browser image data URLs are staged
// as jailed workspace files by the bridge. Tool-calling requests are refused
// rather than silently ignored.

import {
  runAgent, listAgentModelOptions, isAgentBridgeReachable, agentBridgeFeatures, AGENTS, getAgentModelEffort,
} from './agent-backend.js';
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
  // Older serve.py builds use one durable scratch directory for every
  // chat-shaped run. Give those pre-existing files headroom so a provider run
  // is not rejected before the CLI starts. Current bridges isolate each run.
  maxFiles: 2000,
  maxTotalBytes: 128 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxImages: 100,
  maxImagePixels: 512 * 1024 * 1024,
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
  // The bridge stages data-URL images in the jailed workspace and appends the
  // exact paths to the prompt before starting the CLI.
  if (part?.type === 'image_url') return '[reference image attached separately]';
  return '';
}

function imageUrlFromPart(part) {
  if (part?.type !== 'image_url') return '';
  const value = part.image_url;
  return typeof value === 'string' ? value : (value?.url || '');
}

/** Extract browser data-URL images for staging by the local bridge. */
export function messagesToImageAttachments(messages = []) {
  const attachments = [];
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      const dataUrl = imageUrlFromPart(part);
      if (dataUrl.startsWith('data:image/')) attachments.push({ dataUrl });
    }
  }
  return attachments;
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
const AGENT_EFFORTS = {
  'claude-code': ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  antigravity: ['low', 'medium', 'high'],
};

function savedEffort(agentId, modelId) {
  // No localStorage under node tests: that just means "nothing saved".
  try {
    return getAgentModelEffort(agentId, modelId && modelId !== CLI_DEFAULT_MODEL ? modelId : '');
  } catch {
    return '';
  }
}

function agentRunOptions(provider, modelId, params) {
  let resolvedModelId = modelId;
  let modelVariantEffort = '';

  // `agy models` exposes Antigravity's reasoning variants as picker-friendly
  // ids such as `gemini-3.8-flash-high`, but `agy --model` only accepts the
  // base id. The variant belongs on the separate `--effort` flag. Keep the
  // catalogue ids in the shared provider picker (where High/Medium/Low are
  // useful choices) and translate them at the bridge boundary.
  if (provider.agentId === 'antigravity') {
    const variant = String(modelId || '').match(/^(.*)-(low|medium|high)$/);
    if (variant) {
      [, resolvedModelId, modelVariantEffort] = variant;
    }
  }

  const options = resolvedModelId && resolvedModelId !== CLI_DEFAULT_MODEL
    ? { model: resolvedModelId }
    : {};
  const effort = modelVariantEffort || params?.reasoning_effort || params?.reasoning?.effort
    || savedEffort(provider.agentId, resolvedModelId);
  if ((AGENT_EFFORTS[provider.agentId] || []).includes(effort)) {
    options.effort = effort;
  }
  return options;
}

// Agents are coding tools first: asked to "build a game" they write index.html
// (or seven files), start a preview server and reply "done — see index.html",
// and the calling app — which only ever receives the reply — gets the summary
// instead of the game. Measured in Ensemble Studio: Devin's "answer" was a
// 2 KB changelog, Antigravity spent 616k tokens on a multi-file project and hit
// the token budget. So a chat-shaped run says up front where the answer goes.
export const CHAT_MODE_PREAMBLE = [
  'You are answering as a chat model inside an app. The app receives ONLY your final reply text —',
  'files you write, servers you start and previews you open are never seen by anyone.',
  'Put the complete answer in your reply. If it is code (for example a web page), reply with the',
  'whole file in one fenced code block, not a description of it. Do not create files, run servers',
  'or explore the workspace unless the request needs it.',
].join(' ');

export function chatModePrompt(prompt) {
  return `${CHAT_MODE_PREAMBLE}\n\n---\n\n${prompt}`;
}

const FENCE_LANG = { html: 'html', htm: 'html', js: 'javascript', mjs: 'javascript', css: 'css', json: 'json', md: 'markdown', py: 'python', ts: 'typescript', svg: 'svg' };

/**
 * If the agent wrote its answer to files anyway, fold them back into the reply
 * so the app receives the work rather than a pointer to a scratch folder. Files
 * whose content already appears in the reply are skipped; `index.html` leads.
 */
export function foldScratchFiles(text, files = []) {
  const written = (files || []).filter(f => typeof f?.text === 'string' && f.text.trim()
    && !text.includes(f.text.trim().slice(0, 200)));
  if (!written.length) return text;
  const rank = f => (/(^|\/)index\.html?$/i.test(f.path) ? 0 : /\.html?$/i.test(f.path) ? 1 : 2);
  written.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  const blocks = written.map((f) => {
    const lang = FENCE_LANG[(f.path.split('.').pop() || '').toLowerCase()] || '';
    return `\`${f.path}\`:\n\n\`\`\`${lang}\n${f.text.replace(/\n$/, '')}\n\`\`\``;
  });
  const skipped = (files || []).filter(f => typeof f?.text !== 'string').map(f => f.path);
  const note = skipped.length ? `\n\n(Also written but too large or binary to include: ${skipped.join(', ')})` : '';
  return `${blocks.join('\n\n')}${note}\n\n---\n\n${text}`.trim();
}

async function fetchScratchFiles(runId) {
  if (!runId) return [];
  try {
    if (!(await agentBridgeFeatures()).includes('scratch-files')) return [];
    const res = await fetch(`/__agent/scratch-files/${encodeURIComponent(runId)}`);
    if (!res.ok) return [];
    return (await res.json())?.files || [];
  } catch {
    return [];
  }
}

async function runAgentChat({ provider, modelId, prompt, attachments, onChunk, signal, budgets, onEvent, onLive, params, telemetry }) {
  if (!prompt.trim()) throw new Error('empty prompt');
  const stats = createRunStats(undefined, telemetry);
  const messages = [];
  const errors = [];
  let lastWasDelta = false;

  const result = await runAgent({
    agent: provider.agentId,
    prompt: chatModePrompt(prompt),
    // Empty: the bridge substitutes its own scratch dir under the data root, so
    // a chat-shaped call needs no project of its own.
    projectDir: '',
    options: agentRunOptions(provider, modelId, params),
    budgets: {
      ...DEFAULT_BUDGETS,
      // Codex emits completed items rather than token deltas. A long answer
      // can be silent for minutes; the total run deadline still bounds it.
      ...(provider.agentId === 'codex' ? { idleTimeoutSeconds: DEFAULT_BUDGETS.maxAgentSeconds } : {}),
      ...(budgets || {}),
    },
    attachments,
    signal,
    // The provider's tracker (model-providers owns it): runAgent feeds it the
    // bridge's phases instead of opening a second record for the same call.
    telemetry,
    onLive,
    onEvent: (event) => {
      onEvent?.(event);
      if (event?.type === 'message' && event.text) {
        stats.markFirstToken();
        // Antigravity streams true deltas (they can end mid-word), which
        // continue the message in progress rather than starting a new one.
        if (event.delta && messages.length && lastWasDelta) messages[messages.length - 1] += event.text;
        else messages.push(event.text);
        lastWasDelta = !!event.delta;
        onChunk?.(messages.join('\n\n'));
      } else if (event?.type === 'reasoning') {
        stats.markReasoning();
      } else if (event?.type === 'error' && event.message) {
        errors.push(event.message);
      }
    },
  });

  const summary = (result?.doneEvent?.summary || '').trim();
  const done = result?.doneEvent;
  if (!done || (done.exitCode != null && done.exitCode !== 0) || errors.length) {
    const reason = errors.join('; ') || result?.bridgeRun?.budgetStop?.reason
      || (!done ? 'the agent stream ended without a completion event'
        : `agent exited with code ${done.exitCode}`);
    throw new Error(`${provider.name}: ${reason}`);
  }
  const reply = summary || messages.join('\n\n').trim();
  const text = foldScratchFiles(reply, await fetchScratchFiles(result?.runId));
  if (!text) {
    throw new Error(errors.length
      ? `${provider.name}: ${errors.join('; ')}`
      : `${provider.name}: the agent produced no output`);
  }
  // Land the caller on the same string this returns, so a UI that rendered the
  // streamed narration ends up showing the final answer.
  if ((summary || text !== reply) && onChunk) onChunk(text);
  return { text, stats, doneEvent: result?.doneEvent || null };
}

// ── Generation API (the shape every provider adapter implements) ──

/**
 * `onAgentEvent` / `onAgentLive` expose the run itself — tool calls, shell
 * commands, thinking — to a caller that wants to show what the agent is doing
 * (an `AgentTrace`), not just the reply text `onChunk` carries.
 */
export async function streamChat({
  provider, modelId, systemPrompt, userPrompt, onChunk, signal, params, onStats, telemetry, onAgentEvent, onAgentLive,
}) {
  const prompt = messagesToPrompt([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  const { text, stats } = await runAgentChat({
    provider, modelId, prompt, onChunk, signal, params, telemetry, onEvent: onAgentEvent, onLive: onAgentLive,
  });
  onStats?.(stats.finish());
  return text;
}

export async function completeChat({ provider, modelId, systemPrompt, userPrompt, telemetry }) {
  return streamChat({ provider, modelId, systemPrompt, userPrompt, onChunk: null, telemetry });
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

export async function chatCompletion({ provider, modelId, messages, tools, telemetry }) {
  refuseTools(provider, tools);
  const { text } = await runAgentChat({
    provider,
    modelId,
    prompt: messagesToPrompt(messages),
    attachments: messagesToImageAttachments(messages),
    telemetry,
  });
  return toOpenAiResponse(text);
}

export async function streamChatCompletion({ provider, modelId, messages, tools, onChunk, returnResponse = false, signal, params, telemetry }) {
  refuseTools(provider, tools);
  const { text } = await runAgentChat({
    provider,
    modelId,
    prompt: messagesToPrompt(messages),
    attachments: messagesToImageAttachments(messages),
    signal,
    params,
    telemetry,
    onChunk: onChunk ? (accumulated => onChunk(accumulated, { content: accumulated, toolCalls: [] })) : null,
  });
  return returnResponse ? toOpenAiResponse(text) : text;
}

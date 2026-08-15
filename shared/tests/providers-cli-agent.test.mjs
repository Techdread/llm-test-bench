import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLI_DEFAULT_MODEL,
  agentIdFromProviderId,
  chatCompletion,
  createProvider,
  fetchModels,
  isCliAgentProviderId,
  listProviders,
  messagesToPrompt,
  providerFromId,
  streamChat,
  streamChatCompletion,
  testConnection,
  validateProvider,
} from '../services/providers-cli-agent.js';

// ── Bridge stubs ─────────────────────────────────────────────────────────────
// The adapter talks to serve.py over fetch + EventSource; both are replaced so
// the tests exercise the adapter's own behaviour, not the bridge's.

let bridgeUp = true;
let agentModels = { 'claude-code': ['opus', 'sonnet'], codex: [], antigravity: [], grok: ['grok-4.6'] };
let agentModelOptions = {};
let runEvents = [];
let lastRunBody = null;

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) });
}

globalThis.fetch = (url, init) => {
  const path = String(url);
  if (path === '/__agent/runs') {
    return bridgeUp ? jsonResponse({ runs: [], activeCount: 0 }) : jsonResponse({}, false);
  }
  if (path.startsWith('/__agent/models/')) {
    if (!bridgeUp) return jsonResponse({}, false);
    const agent = decodeURIComponent(path.split('/').pop());
    return jsonResponse({
      models: agentModels[agent] || [],
      ...(agentModelOptions[agent] ? { modelOptions: agentModelOptions[agent] } : {}),
    });
  }
  if (path === '/__agent/run') {
    lastRunBody = JSON.parse(init.body);
    return jsonResponse({ runId: 'run-test' });
  }
  if (path.startsWith('/__agent/cancel/')) return jsonResponse({ ok: true });
  throw new Error(`unexpected fetch: ${path}`);
};

globalThis.EventSource = class {
  constructor() {
    setTimeout(() => {
      this.onopen?.();
      for (const event of runEvents) this.onmessage?.({ data: JSON.stringify(event) });
    }, 0);
  }
  close() {}
};

// The bridge probe is cached per module load, so the first call decides. Every
// test below runs with the bridge up except the one that re-probes explicitly.
test.beforeEach(() => {
  bridgeUp = true;
  agentModelOptions = {};
  lastRunBody = null;
  runEvents = [
    { type: 'message', text: 'Working on it.' },
    { type: 'done', summary: 'The answer is 42.', exitCode: 0 },
  ];
});

// ── Provider shape ───────────────────────────────────────────────────────────

test('every bridge agent is offered as a provider under the cli-agent: prefix', () => {
  const providers = listProviders();
  assert.deepEqual(providers.map(p => p.id).sort(),
    ['cli-agent:antigravity', 'cli-agent:claude-code', 'cli-agent:codex', 'cli-agent:grok']);
  for (const provider of providers) {
    assert.equal(provider.type, 'cli-agent');
    assert.equal(provider.synthetic, true, 'must be flagged so the registry never persists it');
    assert.equal(validateProvider(provider).valid, true);
  }
});

test('provider ids round-trip to agent ids', () => {
  assert.equal(isCliAgentProviderId('cli-agent:codex'), true);
  assert.equal(isCliAgentProviderId('openrouter'), false);
  assert.equal(agentIdFromProviderId('cli-agent:codex'), 'codex');
  assert.equal(providerFromId('cli-agent:codex').name, 'Codex CLI');
  assert.equal(providerFromId('cli-agent:nope'), null);
  assert.equal(validateProvider({ agentId: 'nope' }).valid, false);
});

test('fetchModels offers the CLI default plus every enumerated model, priced free', async () => {
  const models = await fetchModels(createProvider({ id: 'claude-code', label: 'Claude Code' }));
  assert.deepEqual(models.map(m => m.modelId), [CLI_DEFAULT_MODEL, 'opus', 'sonnet']);
  assert.equal(models[0].name, 'CLI default');
  assert.equal(models[0].displayLabel, 'Claude Code CLI / CLI default');
  // Zero pricing keeps local agents out of the "free models only" filter's way.
  for (const model of models) assert.deepEqual(model.pricing, { prompt: '0', completion: '0' });
});

test('an agent that enumerates no models still offers its own default', async () => {
  const models = await fetchModels(createProvider({ id: 'codex', label: 'Codex' }));
  assert.deepEqual(models.map(m => m.modelId), [CLI_DEFAULT_MODEL]);
});

test('Grok exposes the models enumerated by its CLI', async () => {
  const models = await fetchModels(createProvider({ id: 'grok', label: 'Grok' }));
  assert.deepEqual(models.map(model => model.modelId), [CLI_DEFAULT_MODEL, 'grok-4.6']);
  assert.equal(models[1].displayLabel, 'Grok CLI / grok-4.6');
});

test('fetchModels preserves catalogue display labels for Gemini effort variants', async () => {
  agentModelOptions.antigravity = [
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  ];
  const models = await fetchModels(createProvider({ id: 'antigravity', label: 'Antigravity' }));
  assert.deepEqual(models.slice(1).map(model => [model.modelId, model.name]), [
    ['gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'],
    ['gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)'],
    ['gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)'],
  ]);
});

// ── Prompt flattening ────────────────────────────────────────────────────────

test('a lone user message is passed through verbatim', () => {
  assert.equal(messagesToPrompt([{ role: 'user', content: 'Explain closures.' }]), 'Explain closures.');
});

test('system + user is joined without role labels', () => {
  assert.equal(
    messagesToPrompt([{ role: 'system', content: 'Be terse.' }, { role: 'user', content: 'Why?' }]),
    'Be terse.\n\n---\n\nWhy?',
  );
});

test('a real conversation keeps its roles', () => {
  const prompt = messagesToPrompt([
    { role: 'user', content: 'One?' },
    { role: 'assistant', content: 'Two.' },
    { role: 'user', content: 'Three?' },
  ]);
  assert.equal(prompt, 'User: One?\n\nAssistant: Two.\n\nUser: Three?');
});

test('multimodal parts flatten to text and say what was dropped', () => {
  const prompt = messagesToPrompt([{
    role: 'user',
    content: [
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ],
  }]);
  assert.equal(prompt, 'What is this?\n[image omitted — CLI agents take text prompts only]');
});

test('empty and whitespace-only messages are dropped', () => {
  assert.equal(messagesToPrompt([{ role: 'system', content: '  ' }, { role: 'user', content: 'Hi' }]), 'Hi');
  assert.equal(messagesToPrompt([]), '');
});

// ── Generation ───────────────────────────────────────────────────────────────

test('streamChat streams live messages and resolves with the run summary', async () => {
  const chunks = [];
  const stats = [];
  const text = await streamChat({
    provider: createProvider({ id: 'claude-code', label: 'Claude Code' }),
    modelId: 'opus',
    systemPrompt: 'Be terse.',
    userPrompt: 'What is the answer?',
    onChunk: c => chunks.push(c),
    onStats: s => stats.push(s),
  });

  assert.equal(text, 'The answer is 42.');
  assert.equal(chunks[0], 'Working on it.', 'intermediate narration streams as it lands');
  assert.equal(chunks.at(-1), 'The answer is 42.', 'the last chunk matches the returned text');
  assert.equal(stats.length, 1);
  assert.equal(lastRunBody.agent, 'claude-code');
  assert.equal(lastRunBody.options.model, 'opus');
  assert.equal(lastRunBody.prompt, 'Be terse.\n\n---\n\nWhat is the answer?');
  assert.equal(lastRunBody.projectDir, '', 'no project dir — the bridge supplies its scratch dir');
});

test('the CLI default sentinel is sent as "no model flag"', async () => {
  await streamChat({
    provider: createProvider({ id: 'codex', label: 'Codex' }),
    modelId: CLI_DEFAULT_MODEL,
    userPrompt: 'Hi',
  });
  assert.deepEqual(lastRunBody.options, {});
});

test('Antigravity receives low, medium, and high reasoning effort', async () => {
  for (const effort of ['low', 'medium', 'high']) {
    await streamChat({
      provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
      modelId: 'gemini-3.7-flash',
      userPrompt: 'Hi',
      params: { reasoning_effort: effort },
    });
    assert.deepEqual(lastRunBody.options, { model: 'gemini-3.7-flash', effort });
  }
});

test('Codex receives every GPT-5.6 reasoning level', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    await streamChat({
      provider: createProvider({ id: 'codex', label: 'Codex' }),
      modelId: 'gpt-5.6-sol',
      userPrompt: 'Hi',
      params: { reasoning_effort: effort },
    });
    assert.deepEqual(lastRunBody.options, { model: 'gpt-5.6-sol', effort });
  }
});

test('streamChatCompletion reports accumulated text with the tool-call shape callers expect', async () => {
  const seen = [];
  const text = await streamChatCompletion({
    provider: createProvider({ id: 'claude-code', label: 'Claude Code' }),
    modelId: '',
    messages: [{ role: 'user', content: 'Ask' }],
    onChunk: (accumulated, meta) => seen.push([accumulated, meta]),
  });
  assert.equal(text, 'The answer is 42.');
  assert.deepEqual(seen.at(-1), ['The answer is 42.', { content: 'The answer is 42.', toolCalls: [] }]);
});

test('streamChatCompletion can return an OpenAI-shaped response', async () => {
  const response = await streamChatCompletion({
    provider: createProvider({ id: 'claude-code', label: 'Claude Code' }),
    messages: [{ role: 'user', content: 'Ask' }],
    returnResponse: true,
  });
  assert.equal(response.choices[0].message.content, 'The answer is 42.');
  assert.equal(response.choices[0].message.role, 'assistant');
});

test('a run with no summary falls back to the messages it did emit', async () => {
  runEvents = [
    { type: 'message', text: 'Part one.' },
    { type: 'message', text: 'Part two.' },
    { type: 'done', summary: '', exitCode: 0 },
  ];
  const text = await chatCompletion({
    provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
    messages: [{ role: 'user', content: 'Ask' }],
  });
  assert.equal(text.choices[0].message.content, 'Part one.\n\nPart two.');
});

test('a silent failed run raises the agent error rather than returning empty text', async () => {
  runEvents = [
    { type: 'error', message: 'agy: no output produced' },
    { type: 'done', summary: '', exitCode: 1 },
  ];
  await assert.rejects(
    () => chatCompletion({
      provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
      messages: [{ role: 'user', content: 'Ask' }],
    }),
    /Antigravity CLI: agy: no output produced/,
  );
});

test('tool-calling is refused instead of being silently dropped', async () => {
  await assert.rejects(
    () => chatCompletion({
      provider: createProvider({ id: 'codex', label: 'Codex' }),
      messages: [{ role: 'user', content: 'Ask' }],
      tools: [{ type: 'function', function: { name: 'noop' } }],
    }),
    /tool-calling requests are not supported/,
  );
});

test('an empty prompt never reaches the bridge', async () => {
  await assert.rejects(
    () => chatCompletion({
      provider: createProvider({ id: 'codex', label: 'Codex' }),
      messages: [{ role: 'user', content: '   ' }],
    }),
    /empty prompt/,
  );
  assert.equal(lastRunBody, null);
});

// Kept last: it re-probes with the bridge down, which the cached probe keeps.
test('testConnection reports a down bridge as a plain unreachable', async () => {
  bridgeUp = false;
  const result = await testConnection(createProvider({ id: 'codex', label: 'Codex' }));
  assert.equal(result.ok, false);
  assert.match(result.error, /serve\.py/);
});

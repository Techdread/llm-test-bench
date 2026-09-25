import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLI_DEFAULT_MODEL,
  CHAT_MODE_PREAMBLE,
  agentIdFromProviderId,
  foldScratchFiles,
  chatCompletion,
  createProvider,
  fetchModels,
  isCliAgentProviderId,
  listProviders,
  messagesToPrompt,
  messagesToImageAttachments,
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
let scratchFiles = [];

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) });
}

globalThis.fetch = (url, init) => {
  const path = String(url);
  if (path === '/__agent/runs') {
    return bridgeUp
      ? jsonResponse({ runs: [], activeCount: 0, features: ['inline-image-attachments', 'scratch-files'] })
      : jsonResponse({}, false);
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
  if (path === '/__agent/scratch-files/run-test') return jsonResponse({ files: scratchFiles });
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
  scratchFiles = [];
  runEvents = [
    { type: 'message', text: 'Working on it.' },
    { type: 'done', summary: 'The answer is 42.', exitCode: 0 },
  ];
});

// ── Provider shape ───────────────────────────────────────────────────────────

test('every bridge agent is offered as a provider under the cli-agent: prefix', () => {
  const providers = listProviders();
  assert.deepEqual(providers.map(p => p.id).sort(),
    ['cli-agent:antigravity', 'cli-agent:claude-code', 'cli-agent:codex', 'cli-agent:cursor',
      'cli-agent:devin', 'cli-agent:grok', 'cli-agent:opencode']);
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
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
    { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  ];
  const models = await fetchModels(createProvider({ id: 'antigravity', label: 'Antigravity' }));
  assert.deepEqual(models.slice(1).map(model => [model.modelId, model.name]), [
    ['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'],
    ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'],
    ['gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'],
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

test('multimodal parts flatten to text and mark the separately staged image', () => {
  const prompt = messagesToPrompt([{
    role: 'user',
    content: [
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ],
  }]);
  assert.equal(prompt, 'What is this?\n[reference image attached separately]');
});

test('multimodal data URLs are extracted as bridge attachments', () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image_url', image_url: 'https://example.com/remote.png' },
      { type: 'text', text: 'Inspect it' },
    ],
  }];
  assert.deepEqual(messagesToImageAttachments(messages), [
    { dataUrl: 'data:image/png;base64,AAA' },
  ]);
});

test('multimodal completion sends extracted images to the bridge', async () => {
  await streamChatCompletion({
    provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
    modelId: 'gemini-3.7-flash-high',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        { type: 'text', text: 'Inspect it' },
      ],
    }],
  });
  assert.deepEqual(lastRunBody.attachments, [{ dataUrl: 'data:image/png;base64,AAA' }]);
  assert.equal(lastRunBody.options.model, 'gemini-3.7-flash');
  assert.equal(lastRunBody.options.effort, 'high');
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
  assert.equal(lastRunBody.prompt, `${CHAT_MODE_PREAMBLE}\n\n---\n\nBe terse.\n\n---\n\nWhat is the answer?`,
    'a chat-shaped run is told its reply is the only thing the app receives');
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

test('Antigravity picker variants become a base model plus reasoning effort', async () => {
  for (const effort of ['low', 'medium', 'high']) {
    await streamChat({
      provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
      modelId: `gemini-3.7-flash-${effort}`,
      userPrompt: 'Hi',
    });
    assert.deepEqual(lastRunBody.options, { model: 'gemini-3.7-flash', effort });
  }
});

test('Gemini 3.8 picker variants become the new base model plus reasoning effort', async () => {
  for (const effort of ['low', 'medium', 'high']) {
    await streamChat({
      provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
      modelId: `gemini-3.8-flash-${effort}`,
      userPrompt: 'Hi',
    });
    assert.deepEqual(lastRunBody.options, { model: 'gemini-3.8-flash', effort });
  }
});

test('Antigravity picker variant effort wins over a stale generation parameter', async () => {
  await streamChat({
    provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
    modelId: 'gemini-3.7-flash-high',
    userPrompt: 'Hi',
    params: { reasoning_effort: 'low' },
  });
  assert.deepEqual(lastRunBody.options, { model: 'gemini-3.7-flash', effort: 'high' });
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

test('Claude Code receives its --effort levels, and never Codex-only ones', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    await streamChat({
      provider: createProvider({ id: 'claude-code', label: 'Claude Code' }),
      modelId: 'opus',
      userPrompt: 'Hi',
      params: { reasoning_effort: effort },
    });
    assert.deepEqual(lastRunBody.options, { model: 'opus', effort });
  }
  await streamChat({
    provider: createProvider({ id: 'claude-code', label: 'Claude Code' }),
    modelId: 'opus',
    userPrompt: 'Hi',
    params: { reasoning_effort: 'ultra' },
  });
  assert.deepEqual(lastRunBody.options, { model: 'opus' });
});

test('a run with no reasoning_effort uses the level the picker saved for that model', async () => {
  const store = { 'devtools-hub-cli-agent-efforts': JSON.stringify({ 'claude-code:sonnet': 'xhigh', 'claude-code:__default__': 'low' }) };
  globalThis.localStorage = { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = value; } };
  try {
    const provider = createProvider({ id: 'claude-code', label: 'Claude Code' });
    await streamChat({ provider, modelId: 'sonnet', userPrompt: 'Hi' });
    assert.deepEqual(lastRunBody.options, { model: 'sonnet', effort: 'xhigh' });
    await streamChat({ provider, modelId: CLI_DEFAULT_MODEL, userPrompt: 'Hi' });
    assert.deepEqual(lastRunBody.options, { effort: 'low' });
    await streamChat({ provider, modelId: 'sonnet', userPrompt: 'Hi', params: { reasoning_effort: 'medium' } });
    assert.deepEqual(lastRunBody.options, { model: 'sonnet', effort: 'medium' });
  } finally {
    delete globalThis.localStorage;
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

test('a failed Codex run cannot turn its last progress message into an answer', async () => {
  runEvents = [
    { type: 'message', text: 'I am building the range.' },
    { type: 'error', message: 'Agent idle timeout exceeded' },
    { type: 'done', summary: 'I am building the range.', exitCode: -15 },
  ];
  await assert.rejects(() => streamChat({
    provider: providerFromId('cli-agent:codex'), modelId: 'gpt-6-astra', userPrompt: 'Build a range',
  }), /Agent idle timeout exceeded/);
  assert.equal(lastRunBody.budgets.idleTimeoutSeconds, 900);
  assert.equal(lastRunBody.budgets.maxAgentSeconds, 900);
});

test('Claude quota errors are rejected even when the result contains text', async () => {
  runEvents = [
    { type: 'message', text: 'You have hit your session limit' },
    { type: 'error', message: 'You have hit your session limit' },
    { type: 'done', summary: 'You have hit your session limit', exitCode: 1 },
  ];
  await assert.rejects(() => chatCompletion({
    provider: providerFromId('cli-agent:claude-code'), messages: [{ role: 'user', content: 'Build a page' }],
  }), /session limit/);
});

test('a nonzero exit without an error event is still a failure', async () => {
  runEvents = [
    { type: 'message', text: 'Partial output' },
    { type: 'done', summary: 'Partial output', exitCode: 1 },
  ];
  await assert.rejects(() => streamChat({
    provider: providerFromId('cli-agent:codex'), userPrompt: 'Build a page',
  }), /exited with code 1/);
});

test('budget errors cannot be hidden by an otherwise successful completion', async () => {
  runEvents = [
    { type: 'error', message: 'Agent token budget exceeded' },
    { type: 'done', summary: 'Some answer', exitCode: 0 },
  ];
  await assert.rejects(() => streamChat({
    provider: providerFromId('cli-agent:codex'), userPrompt: 'Build a page',
  }), /token budget exceeded/);
});

test('files an agent wrote instead of answering are folded back into the reply', async () => {
  runEvents = [{ type: 'done', summary: 'Built it — open index.html.', exitCode: 0 }];
  scratchFiles = [
    { path: 'game.js', size: 9, text: 'let a=1;\n' },
    { path: 'index.html', size: 30, text: '<!doctype html><script src="game.js"></script>\n' },
    { path: 'sprite.png', size: 4096 },
  ];
  const chunks = [];
  const text = await streamChat({
    provider: createProvider({ id: 'devin', label: 'Devin' }),
    userPrompt: 'Build a game',
    onChunk: c => chunks.push(c),
  });
  assert.ok(text.startsWith('`index.html`:\n\n```html\n<!doctype html>'), 'index.html leads so HTML extractors find it first');
  assert.match(text, /```javascript\nlet a=1;\n```/);
  assert.match(text, /too large or binary to include: sprite\.png/);
  assert.ok(text.endsWith('Built it — open index.html.'), 'the agent\'s own reply is kept');
  assert.equal(chunks.at(-1), text, 'the caller lands on the folded answer');
});

test('a reply that already contains the file is returned unchanged', () => {
  const html = '<!doctype html><title>x</title><body>hello</body>';
  const reply = `Here it is:\n\n\`\`\`html\n${html}\n\`\`\``;
  assert.equal(foldScratchFiles(reply, [{ path: 'index.html', text: `${html}\n` }]), reply);
  assert.equal(foldScratchFiles('plain answer', []), 'plain answer');
});

test('streamed deltas continue the message instead of starting new paragraphs', async () => {
  runEvents = [
    { type: 'message', text: 'I built a single', delta: true },
    { type: 'message', text: '-page Tow', delta: true },
    { type: 'message', text: 'er game.', delta: true },
    { type: 'done', summary: '', exitCode: 0 },
  ];
  const chunks = [];
  const text = await streamChat({
    provider: createProvider({ id: 'antigravity', label: 'Antigravity' }),
    userPrompt: 'Go',
    onChunk: c => chunks.push(c),
  });
  assert.equal(text, 'I built a single-page Tower game.');
  assert.equal(chunks[1], 'I built a single-page Tow');
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

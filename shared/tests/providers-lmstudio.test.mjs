import test from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCompletion } from '../services/providers-lmstudio.js';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('raw streaming forwards params and treats reasoning chunks as activity', async () => {
  const encoder = new TextEncoder();
  const events = [
    { choices: [{ delta: { role: 'assistant', reasoning_content: 'planning' }, finish_reason: null }] },
    { choices: [{ delta: { content: '<!doctype html>' }, finish_reason: null }] },
    { choices: [{ delta: { content: '<html></html>' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 120, completion_tokens: 345, total_tokens: 465 } },
  ];
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const body = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const chunks = [];
  const response = await streamChatCompletion({
    provider: { name: '3090', baseUrl: 'http://studio.test', streamTimeoutMs: 1_000 },
    modelId: 'muse-glimmer-30b',
    messages: [{ role: 'user', content: 'Build Pac-Man' }],
    params: { max_tokens: 16_384, temperature: 0.1, repeat_penalty: 1 },
    returnResponse: true,
    onChunk: (text, meta) => chunks.push({ text, meta }),
  });

  assert.equal(requestBody.max_tokens, 16_384);
  assert.equal(requestBody.temperature, 0.1);
  assert.equal(requestBody.repeat_penalty, 1);
  assert.deepEqual(requestBody.stream_options, { include_usage: true });
  assert.equal(requestBody.tools, undefined);
  assert.equal(chunks[0].text, '');
  assert.equal(chunks[0].meta.reasoning, true);
  assert.equal(chunks.at(-1).text, '<!doctype html><html></html>');
  assert.equal(response.choices[0].message.content, '<!doctype html><html></html>');
  assert.equal(response.usage.completion_tokens, 345);
});

test('raw streaming explicitly enables automatic tool selection', async () => {
  const encoder = new TextEncoder();
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  };
  const tools = [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }];
  await streamChatCompletion({
    provider: { name: '3090', baseUrl: 'http://studio.test' },
    modelId: 'muse-glimmer-30b', messages: [{ role: 'user', content: 'Build' }],
    tools, onChunk() {}, returnResponse: true,
  });
  assert.deepEqual(requestBody.tools, tools);
  assert.equal(requestBody.tool_choice, 'auto');
});

test('raw streaming honors required tool selection for agent loops', async () => {
  const encoder = new TextEncoder();
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  };
  await streamChatCompletion({
    provider: { name: '3090', baseUrl: 'http://studio.test' },
    modelId: 'muse-glimmer-30b', messages: [{ role: 'user', content: 'Build' }],
    tools: [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }],
    toolChoice: 'required', onChunk() {}, returnResponse: true,
  });
  assert.equal(requestBody.tool_choice, 'required');
});

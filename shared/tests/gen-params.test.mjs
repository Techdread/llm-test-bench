import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PARAM_SPEC,
  normalizeParams,
  paramsSignature,
  applyParams,
  withUsageReporting,
  expandSweep,
  extractUsage,
  createRunStats,
} from '../services/gen-params.js';

test('normalizeParams drops unset values so "server defaults" sends nothing', () => {
  assert.deepEqual(normalizeParams({}), {});
  assert.deepEqual(normalizeParams({ temperature: '', top_p: null, top_k: undefined, seed: NaN }), {});
  // 0 is a real value (greedy sampling) and must survive
  assert.deepEqual(normalizeParams({ temperature: 0 }), { temperature: 0 });
});

test('normalizeParams coerces to the declared type', () => {
  const p = normalizeParams({ temperature: '0.7', top_k: '40.6', enable_thinking: 1, seed: '42' });
  assert.deepEqual(p, { temperature: 0.7, top_k: 41, enable_thinking: true, seed: 42 });
});

test('normalizeParams passes unknown keys through untouched', () => {
  assert.deepEqual(normalizeParams({ custom_thing: 'x' }), { custom_thing: 'x' });
});

test('paramsSignature is stable and key-order independent', () => {
  assert.equal(paramsSignature({}), 'server defaults');
  assert.equal(
    paramsSignature({ top_p: 0.9, temperature: 0.2 }),
    paramsSignature({ temperature: 0.2, top_p: 0.9 }),
  );
  assert.equal(paramsSignature({ temperature: 0.2, top_p: 0.9 }), 'temperature=0.2, top_p=0.9');
});

test('applyParams maps the LM Studio dialect', () => {
  const body = applyParams(
    { model: 'm', messages: [] },
    { temperature: 0.2, repeat_penalty: 1.1, reasoning_effort: 'low', enable_thinking: false },
    'lmstudio',
  );
  assert.equal(body.temperature, 0.2);
  assert.equal(body.repeat_penalty, 1.1);
  assert.equal(body.reasoning_effort, 'low');
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.model, 'm', 'existing body fields survive');
  assert.equal(body.repetition_penalty, undefined, 'no OpenRouter spelling leaks in');
});

test('applyParams maps the OpenRouter dialect', () => {
  const body = applyParams(
    { model: 'm' },
    { temperature: 0.2, repeat_penalty: 1.1, reasoning_effort: 'high', enable_thinking: true },
    'openrouter',
  );
  assert.equal(body.repetition_penalty, 1.1);
  assert.equal(body.repeat_penalty, undefined);
  assert.deepEqual(body.reasoning, { effort: 'high', enabled: true });
});

test('applyParams with no params leaves the body alone', () => {
  const original = { model: 'm', messages: [], stream: true };
  assert.deepEqual(applyParams(original, {}, 'lmstudio'), original);
  assert.deepEqual(applyParams(original, undefined, 'openrouter'), original);
});

test('withUsageReporting uses each provider\'s opt-in', () => {
  assert.deepEqual(withUsageReporting({}, 'openrouter').usage, { include: true });
  assert.deepEqual(withUsageReporting({}, 'lmstudio').stream_options, { include_usage: true });
});

test('expandSweep produces a stable cartesian product', () => {
  const combos = expandSweep({ temperature: [0, 0.7], top_p: [0.9, 1] });
  assert.deepEqual(combos, [
    { temperature: 0, top_p: 0.9 },
    { temperature: 0, top_p: 1 },
    { temperature: 0.7, top_p: 0.9 },
    { temperature: 0.7, top_p: 1 },
  ]);
});

test('expandSweep treats scalars as fixed and empty grids as one server-default run', () => {
  assert.deepEqual(expandSweep({ temperature: [0, 1], seed: 42 }), [
    { temperature: 0, seed: 42 },
    { temperature: 1, seed: 42 },
  ]);
  assert.deepEqual(expandSweep({}), [{}]);
  assert.deepEqual(expandSweep({ temperature: [] }), [{}]);
});

test('extractUsage pulls reasoning tokens out of the OpenAI-style block', () => {
  const u = extractUsage({
    prompt_tokens: 22, completion_tokens: 80, total_tokens: 102,
    completion_tokens_details: { reasoning_tokens: 77 },
  });
  assert.equal(u.reasoningTokens, 77);
  assert.equal(u.completionTokens, 80);
  assert.equal(extractUsage(null), null);
});

test('createRunStats measures TTFT and tokens/sec from the streaming clock', () => {
  let t = 1000;
  const stats = createRunStats(() => t);
  t = 1500;               // first token after 500ms
  stats.markFirstToken();
  t = 2500;               // 1000ms of generation
  stats.setUsage({ completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 0 } });
  stats.setFinishReason('stop');
  const r = stats.finish();

  assert.equal(r.ttftMs, 500);
  assert.equal(r.durationMs, 1500);
  assert.equal(r.tokensPerSecond, 50, '50 tokens in 1s of generation, excluding TTFT');
  assert.equal(r.finishReason, 'stop');
  assert.equal(r.thought, false);
});

test('createRunStats reports thinking when reasoning was actually streamed', () => {
  let t = 0;
  const stats = createRunStats(() => t);
  stats.markReasoning();
  t = 100;
  const r = stats.finish();
  assert.equal(r.thought, true);
  assert.equal(r.ttftMs, 0, 'reasoning counts as the first token');
});

test('createRunStats infers thinking from usage even without reasoning deltas', () => {
  const stats = createRunStats(() => 0);
  stats.setUsage({ completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 17 } });
  assert.equal(stats.finish().thought, true);
});

test('PARAM_SPEC keys are unique', () => {
  const keys = PARAM_SPEC.map(p => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

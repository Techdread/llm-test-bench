import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutorModels,
  buildExecutorMetadata,
  CLI_DEFAULT_MODEL,
  decodeExecutorSelection,
} from '../services/executor-models.js';

test('buildExecutorModels keeps provider models and adds every CLI agent', () => {
  const provider = { providerId: 'lm-studio', providerName: 'LM Studio', providerType: 'openai-compatible', modelId: 'local-model' };
  const models = buildExecutorModels([provider], { codex: ['gpt-5.6-codex', 'gpt-5.6-codex'] });

  assert.equal(models[0], provider);
  assert.ok(models.some(model => model.providerId === 'cli-agent:claude-code' && model.modelId === CLI_DEFAULT_MODEL));
  assert.ok(models.some(model => model.providerId === 'cli-agent:codex' && model.modelId === 'gpt-5.6-codex'));
  assert.ok(models.some(model => model.providerId === 'cli-agent:antigravity' && model.modelId === CLI_DEFAULT_MODEL));
  assert.ok(models.some(model => model.providerId === 'cli-agent:grok' && model.modelId === CLI_DEFAULT_MODEL));
  assert.equal(models.filter(model => model.modelId === 'gpt-5.6-codex').length, 1);
});

test('buildExecutorMetadata gives CLI default a durable human-readable model name', () => {
  assert.deepEqual(buildExecutorMetadata({ backend: 'agent', agentId: 'codex', agentModelId: '' }), {
    backend: 'cli-agent',
    providerId: 'cli-agent:codex',
    providerName: 'Codex CLI',
    providerType: 'cli-agent',
    agentId: 'codex',
    model: 'Codex CLI default',
    modelId: '',
    modelName: 'Codex CLI default',
    modelDisplayLabel: 'Codex CLI / default',
  });
});

test('buildExecutorMetadata snapshots provider and explicit CLI model labels', () => {
  const providerModels = [{
    providerId: 'lm-studio', providerName: 'Local Qwen', providerType: 'lmstudio',
    modelId: 'qwen3-coder', name: 'Qwen 3 Coder', displayLabel: 'Local Qwen / Qwen 3 Coder',
  }];
  assert.equal(buildExecutorMetadata({
    backend: 'model', providerId: 'lm-studio', modelId: 'qwen3-coder', providerModels,
  }).modelDisplayLabel, 'Local Qwen / Qwen 3 Coder');
  assert.equal(buildExecutorMetadata({
    backend: 'agent', agentId: 'claude-code', agentModelId: 'claude-opus-4-6',
  }).modelDisplayLabel, 'Claude Code CLI / claude-opus-4-6');
});

test('decodeExecutorSelection separates provider and CLI selections', () => {
  assert.deepEqual(decodeExecutorSelection('lm-studio', 'qwen'), {
    backend: 'model', providerId: 'lm-studio', modelId: 'qwen',
  });
  assert.deepEqual(decodeExecutorSelection('cli-agent:codex', CLI_DEFAULT_MODEL), {
    backend: 'agent', agentId: 'codex', modelId: '',
  });
  assert.deepEqual(decodeExecutorSelection('cli-agent:claude-code', 'sonnet'), {
    backend: 'agent', agentId: 'claude-code', modelId: 'sonnet',
  });
});

test('CLI agents already supplied by the provider list are not added twice', () => {
  // model-providers.js now mints the same agents as synthetic providers, so its
  // rows arrive through `providerModels` and must not be duplicated here.
  const fromRegistry = {
    providerId: 'cli-agent:codex', providerName: 'Codex CLI', providerType: 'cli-agent',
    modelId: CLI_DEFAULT_MODEL, name: 'CLI default',
  };
  const models = buildExecutorModels([fromRegistry], { codex: ['gpt-5.6-codex'] });

  assert.equal(models.filter(m => m.providerId === 'cli-agent:codex').length, 2,
    'one default row plus one discovered model, with no duplicate registry row');
  assert.equal(models.filter(m => m.providerId === 'cli-agent:codex' && m.modelId === CLI_DEFAULT_MODEL).length, 1);
  assert.ok(models.some(m => m.providerId === 'cli-agent:claude-code'), 'other agents are still added');
});

test('executor rows collapse CLI variants and retain effort capabilities', () => {
  const models = buildExecutorModels([], {
    codex: [{
      id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', defaultEffort: 'low',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    }],
    antigravity: [
      { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
      { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
      { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
    ],
  });
  const codex = models.find(model => model.providerId === 'cli-agent:codex' && model.modelId === 'gpt-5.6-sol');
  const gemini = models.filter(model => model.providerId === 'cli-agent:antigravity' && model.modelId !== CLI_DEFAULT_MODEL);

  assert.deepEqual(codex.raw.efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepEqual(gemini.map(model => model.modelId), ['gemini-3.7-flash']);
  assert.deepEqual(gemini[0].raw.efforts, ['low', 'medium', 'high']);
});

test('an unreachable bridge drops CLI rows that came in through the provider list', () => {
  const fromRegistry = {
    providerId: 'cli-agent:codex', providerType: 'cli-agent', modelId: CLI_DEFAULT_MODEL, name: 'CLI default',
  };
  const provider = { providerId: 'lm-studio', providerType: 'lmstudio', modelId: 'local-model' };
  const models = buildExecutorModels([provider, fromRegistry], {}, { bridgeReachable: false });

  assert.deepEqual(models, [provider]);
});

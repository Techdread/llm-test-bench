import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAgentModelEffort,
  groupAgentModelOptions,
  resolveAgentModelSelection,
  saveAgentModelEffort,
} from '../services/agent-backend.js';

const preferenceStore = new Map();
globalThis.localStorage = {
  getItem: key => preferenceStore.get(key) ?? null,
  setItem: (key, value) => preferenceStore.set(key, String(value)),
};

const catalogue = [
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

test('Antigravity catalogue variants collapse into base-model choices', () => {
  const choices = groupAgentModelOptions(catalogue);
  assert.deepEqual(choices.map(choice => [choice.id, choice.label, choice.efforts, choice.fixedEffort]), [
    ['gemini-3.7-flash', 'Gemini 3.7 Flash', ['low', 'medium', 'high'], ''],
    ['gemini-3.1-pro', 'Gemini 3.1 Pro', ['low', 'high'], ''],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)', [], 'thinking'],
    ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)', [], 'thinking'],
    ['gpt-oss-120b', 'GPT-OSS 120B', ['medium'], ''],
  ]);
});

test('saved variant ids migrate to the base slug and matching effort', () => {
  const choices = groupAgentModelOptions(catalogue);
  assert.deepEqual(
    resolveAgentModelSelection('gemini-3.7-flash-high', 'medium', choices),
    { modelId: 'gemini-3.7-flash', effort: 'high', supportedEfforts: ['low', 'medium', 'high'] },
  );
  assert.deepEqual(
    resolveAgentModelSelection('gemini-3.7-flash', 'medium', choices),
    { modelId: 'gemini-3.7-flash', effort: 'medium', supportedEfforts: ['low', 'medium', 'high'] },
  );
});

test('unsupported effort falls back to one the selected model exposes', () => {
  const choices = groupAgentModelOptions(catalogue);
  assert.deepEqual(
    resolveAgentModelSelection('gemini-3.1-pro', 'medium', choices),
    { modelId: 'gemini-3.1-pro', effort: 'low', supportedEfforts: ['low', 'high'] },
  );
});

test('Codex catalogue metadata preserves GPT-5.6 reasoning levels and defaults', () => {
  const choices = groupAgentModelOptions([
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      defaultEffort: 'low',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      effortDescriptions: { ultra: 'Maximum reasoning with automatic task delegation' },
    },
    {
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6-Luna',
      defaultEffort: 'medium',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
  ]);

  assert.deepEqual(choices[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(choices[0].defaultEffort, 'low');
  assert.equal(choices[0].effortDescriptions.ultra, 'Maximum reasoning with automatic task delegation');
  assert.deepEqual(
    resolveAgentModelSelection('gpt-5.6-sol', '', choices),
    { modelId: 'gpt-5.6-sol', effort: 'low', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  );
  assert.deepEqual(
    resolveAgentModelSelection('gpt-5.6-luna', 'ultra', choices),
    { modelId: 'gpt-5.6-luna', effort: 'medium', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  );
});

test('reasoning effort preferences are stored independently per CLI model', () => {
  preferenceStore.clear();
  assert.equal(saveAgentModelEffort('codex', 'gpt-5.6-sol', 'ultra'), true);
  assert.equal(saveAgentModelEffort('codex', 'gpt-5.6-luna', 'max'), true);
  assert.equal(getAgentModelEffort('codex', 'gpt-5.6-sol'), 'ultra');
  assert.equal(getAgentModelEffort('codex', 'gpt-5.6-luna'), 'max');
  assert.equal(saveAgentModelEffort('codex', 'gpt-5.6-sol', 'bogus'), false);
});

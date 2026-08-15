import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProvider,
  fetchModels,
  testConnection,
  validateProvider,
} from '../services/providers-lemonade.js';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('validates Lemonade provider configuration', () => {
  assert.deepEqual(validateProvider({ type: 'lemonade', baseUrl: 'http://127.0.0.1:8001' }), { valid: true });
  assert.equal(validateProvider({ type: 'lmstudio', baseUrl: 'http://127.0.0.1:8001' }).valid, false);
  assert.equal(validateProvider({ type: 'lemonade', baseUrl: 'file:///tmp/lemonade' }).valid, false);
});

test('creates a Lemonade provider with the expected defaults', () => {
  const provider = createProvider({ baseUrl: 'http://127.0.0.1:8001' });
  assert.match(provider.id, /^lemonade-\d+$/);
  assert.equal(provider.type, 'lemonade');
  assert.equal(provider.name, 'Lemonade');
  assert.equal(provider.baseUrl, 'http://127.0.0.1:8001');
  assert.equal(provider.enabled, true);
});

test('discovers and normalizes OpenAI-compatible models', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:8001/v1/models');
    return Response.json({ data: [{ id: 'Qwen3.6-27B-Q4_K_S.gguf', context_length: 262144 }] });
  };

  const provider = createProvider({ id: 'lemonade-local', name: 'My Lemonade', baseUrl: 'http://127.0.0.1:8001' });
  const models = await fetchModels(provider);
  assert.equal(models.length, 1);
  assert.equal(models[0].providerType, 'lemonade');
  assert.equal(models[0].modelId, 'Qwen3.6-27B-Q4_K_S.gguf');
  assert.equal(models[0].contextLength, 262144);
  assert.match(models[0].displayLabel, /My Lemonade/);
});

test('tests connection and reports model count', async () => {
  globalThis.fetch = async () => Response.json({ data: [{ id: 'one' }, { id: 'two' }] });
  const result = await testConnection(createProvider({ baseUrl: 'http://127.0.0.1:8001' }));
  assert.deepEqual(result, { ok: true, modelCount: 2 });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLocalNetworkUrl,
  localNetworkFetch,
  targetAddressSpaceFor,
} from '../services/local-network.js';

test('classifies loopback and private-network model endpoints', () => {
  assert.equal(targetAddressSpaceFor('http://localhost:1234/v1/models'), 'loopback');
  assert.equal(targetAddressSpaceFor('http://127.0.0.1:8888/v1/models'), 'loopback');
  assert.equal(targetAddressSpaceFor('http://192.168.1.20:1234/v1/models'), 'local');
  assert.equal(targetAddressSpaceFor('http://10.0.0.4:11434/api/tags'), 'local');
  assert.equal(targetAddressSpaceFor('https://openrouter.ai/api/v1/models'), '');
  assert.equal(isLocalNetworkUrl('http://model-box.local:8080'), true);
});

test('annotates local fetches without changing public provider requests', async () => {
  const calls = [];
  const fakeFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response('{}', { status: 200 });
  };

  await localNetworkFetch('http://localhost:1234/v1/models', { headers: { Accept: 'application/json' } }, fakeFetch);
  await localNetworkFetch('https://openrouter.ai/api/v1/models', { method: 'GET' }, fakeFetch);

  assert.equal(calls[0].init.targetAddressSpace, 'loopback');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
  assert.equal(calls[1].init.targetAddressSpace, undefined);
});

test('turns opaque browser network failures into useful setup guidance', async () => {
  const failingFetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    localNetworkFetch('http://localhost:1234/v1/models', {}, failingFetch),
    error => error.name === 'LocalNetworkConnectionError'
      && /enable its CORS\/web-access option/.test(error.message)
      && /Local network access/.test(error.message),
  );
});

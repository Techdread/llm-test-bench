import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUB_PROXY_PREFIX,
  encodeProxyTarget,
  endpointUrl,
  usesProxy,
} from '../services/providers-openai-compatible.js';

const provider = { baseUrl: 'http://127.0.0.1:8080/', useProxy: true };

function documentWith(dataset = {}) {
  return { documentElement: { dataset } };
}

function withGlobalDocument(doc, fn) {
  const had = 'document' in globalThis;
  const previous = globalThis.document;
  globalThis.document = doc;
  try { return fn(); }
  finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
}

test('the private hub routes through the serve.py proxy by default', () => {
  assert.equal(usesProxy({ baseUrl: 'http://x' }, documentWith()), true);
  assert.equal(usesProxy({ useProxy: false }, documentWith()), false);
  assert.equal(
    endpointUrl(provider, '/v1/models'),
    `${HUB_PROXY_PREFIX}/${encodeProxyTarget('http://127.0.0.1:8080')}/v1/models`,
  );
});

test('the public static build never uses the /__llm proxy it does not have', () => {
  const doc = documentWith({ distribution: 'public' });
  assert.equal(usesProxy(provider, doc), false);
  withGlobalDocument(doc, () => {
    assert.equal(endpointUrl(provider, '/v1/models'), 'http://127.0.0.1:8080/v1/models');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadShowcaseItem, showcaseIdFromHash } from '../services/showcase.js';

// A fetch stub that answers from a url -> body map and records what was asked.
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!(url in routes)) return { ok: false, status: 404, json: async () => ({}) };
    const body = routes[url];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const payload = (code) => ({ id: 'tetris', bench: 'prompt-gallery', title: 'Tetris', prompt: 'p', code });

test('showcase routes are recognised and anything else is not', () => {
  assert.equal(showcaseIdFromHash('#/showcase/lava-planet'), 'lava-planet');
  assert.equal(showcaseIdFromHash('#/create'), '');
  assert.equal(showcaseIdFromHash('#/showcase/../x'), '');
});

test('the public build asks the backend first', async () => {
  const { fetchImpl, calls } = stubFetch({ '../api/showcase/tetris': payload('live') });
  const item = await loadShowcaseItem('tetris', { useApi: true, fetchImpl });
  assert.equal(item.code, 'live');
  assert.deepEqual(calls, ['../api/showcase/tetris']);
});

test('the baked-in file is the fallback when the backend is missing, down or unaware', async () => {
  const baked = { '../_showcase/tetris.json': payload('baked') };
  for (const api of [{}, { '../api/showcase/tetris': new Error('offline') }, { '../api/showcase/tetris': { error: 'x' } }]) {
    const { fetchImpl, calls } = stubFetch({ ...baked, ...api });
    const item = await loadShowcaseItem('tetris', { useApi: true, fetchImpl });
    assert.equal(item.code, 'baked');
    assert.deepEqual(calls, ['../api/showcase/tetris', '../_showcase/tetris.json']);
  }
});

test('the private hub never asks a backend it does not have', async () => {
  const { fetchImpl, calls } = stubFetch({});
  assert.equal(await loadShowcaseItem('tetris', { fetchImpl }), null); // node: no document => private hub
  assert.deepEqual(calls, ['../_showcase/tetris.json']);
});

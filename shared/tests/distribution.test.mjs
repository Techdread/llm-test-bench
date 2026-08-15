import test from 'node:test';
import assert from 'node:assert/strict';

import {
  crossAppHandoffsEnabled,
  distributionName,
} from '../services/distribution.js';

function documentWith(dataset = {}) {
  return { documentElement: { dataset } };
}

test('private hub is the backwards-compatible default', () => {
  assert.equal(distributionName(documentWith()), 'private-hub');
  assert.equal(crossAppHandoffsEnabled(documentWith()), true);
});

test('public distributions disable cross-app handoffs by default', () => {
  const doc = documentWith({ distribution: 'public' });
  assert.equal(distributionName(doc), 'public');
  assert.equal(crossAppHandoffsEnabled(doc), false);
});

test('an explicit handoff setting wins over the distribution default', () => {
  assert.equal(crossAppHandoffsEnabled(documentWith({ distribution: 'public', crossAppHandoffs: 'on' })), true);
  assert.equal(crossAppHandoffsEnabled(documentWith({ distribution: 'private-hub', crossAppHandoffs: 'off' })), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentProjectDir,
  createAgentRunId,
  normalizeAgentOutputPath,
} from '../services/coding-agent.js';

test('normalizes safe project-relative output paths', () => {
  assert.equal(normalizeAgentOutputPath('/nested\\index.html'), 'nested/index.html');
  assert.equal(normalizeAgentOutputPath('output.svg'), 'output.svg');
});

test('rejects output paths that can escape or alias the workspace', () => {
  for (const value of ['', '.', '../index.html', 'a/../index.html', 'a//index.html']) {
    assert.throws(() => normalizeAgentOutputPath(value), /safe project-relative path/);
  }
});

test('builds a deterministic jailed data-root path', () => {
  const runId = createAgentRunId(1_700_000_000_000, 0.123456);
  assert.match(runId, /^agent-[a-z0-9]+-[a-z0-9]{6}$/);
  assert.equal(buildAgentProjectDir('prompt-gallery', runId), `prompt-gallery/runs/${runId}/project`);
  assert.throws(() => buildAgentProjectDir('../escape', runId), /Invalid appId/);
});

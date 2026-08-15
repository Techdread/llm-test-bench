import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSvgBenchmarkAgentTask, SVG_BENCHMARK_AGENT_OUTPUT } from '../services/codingAgent.js';

test('SVG Benchmark agent contract requires valid standalone SVG output', () => {
  const task = buildSvgBenchmarkAgentTask('Draw a lighthouse');
  assert.equal(SVG_BENCHMARK_AGENT_OUTPUT, 'output.svg');
  assert.match(task, /Draw a lighthouse/);
  assert.match(task, /root element is <svg>/);
  assert.match(task, /viewBox/);
});

test('SVG Benchmark agent contract names a seeded reference image', () => {
  const task = buildSvgBenchmarkAgentTask('', { hasReference: true });
  assert.match(task, /reference\.png/);
  assert.match(task, /Reproduce the supplied reference image/);
});

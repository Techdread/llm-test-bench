import test from 'node:test';
import assert from 'node:assert/strict';

import { collectRunJobs, gridShape, runItemKey } from '../services/runComparison.js';

test('run item keys distinguish parameter sweeps of the same prompt', () => {
  const cool = runItemKey({ promptId: 'nebula', generationParams: { temperature: 0.2 } });
  const hot = runItemKey({ promptId: 'nebula', generationParams: { temperature: 0.9 } });
  assert.notEqual(cool, hot);
  assert.equal(runItemKey({ jobKey: 'saved-job-key' }), 'saved-job-key');
});

test('run comparison keeps first-seen order and deduplicates matching jobs', () => {
  const jobs = collectRunJobs([
    { items: [
      { promptId: 'a', title: 'A', generationParams: {} },
      { promptId: 'b', title: 'B', generationParams: { seed: 3 } },
    ] },
    { items: [
      { promptId: 'a', title: 'A again', generationParams: {} },
      { promptId: 'c', title: 'C', generationParams: {} },
    ] },
  ]);
  assert.deepEqual(jobs.map(job => job.title), ['A', 'B', 'C']);
  assert.equal(jobs[1].paramsLabel, 'seed=3');
});

test('live-canvas comparison grid remains balanced through nine runs', () => {
  assert.deepEqual(gridShape(2), { cols: 2, rows: 1 });
  assert.deepEqual(gridShape(4), { cols: 2, rows: 2 });
  assert.deepEqual(gridShape(6), { cols: 3, rows: 2 });
  assert.deepEqual(gridShape(9), { cols: 3, rows: 3 });
});

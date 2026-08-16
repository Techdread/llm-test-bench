import test from 'node:test';
import assert from 'node:assert/strict';

import { runBatch, validateSketchCode } from '../services/batchRunner.js';
import { listBatchRuns } from '../services/storage/projectStore.js';

const VALID_CODE = `function sketch(p, ctx) {
  p.setup = () => p.createCanvas(100, 100);
  p.draw = () => p.background(ctx.params.light ?? 20);
}`;

test('sketch validator requires the runner signature and valid JavaScript', () => {
  assert.equal(validateSketchCode(VALID_CODE).ok, true);
  assert.match(validateSketchCode('function setup() {}').reason, /Missing function sketch/);
  assert.match(validateSketchCode('function sketch(p, ctx) {').reason, /syntax error/i);
});

test('batch runner retries, previews, captures, and saves sequentially', async () => {
  const events = [];
  const saves = [];
  let attempts = 0;
  const summary = await runBatch({
    prompts: [{ id: 'one', title: 'One', prompt: 'first', generationParams: { temperature: 0.4 } }],
    model: { modelId: 'model-a', label: 'Model A' },
    options: { apiRetries: 1, retryDelayMs: 0, captureThumbnails: true },
    deps: {
      generate: async (prompt, { params, onChunk, onStats }) => {
        attempts++;
        assert.deepEqual(params, { temperature: 0.4 });
        if (attempts === 1) throw new Error('temporary');
        onChunk(VALID_CODE.slice(0, 40));
        onStats({ completionTokens: 50 });
        return VALID_CODE;
      },
      validate: validateSketchCode,
      extractParams: () => ({ light: 20 }),
      seedFor: () => 77,
      capture: async payload => {
        assert.equal(payload.seed, 77);
        return 'data:image/png;base64,AA==';
      },
      save: async payload => { saves.push(payload); return { id: 'saved-one' }; },
    },
    onEvent: event => events.push(event),
    shouldStop: () => false,
  });

  assert.equal(attempts, 2);
  assert.equal(summary.generated, 1);
  assert.equal(summary.rendered, 1);
  assert.equal(summary.saved, 1);
  assert.equal(saves[0].sketchParams.light, 20);
  assert.equal(saves[0].thumbnailDataUrl, 'data:image/png;base64,AA==');
  assert.ok(events.some(event => event.type === 'item' && event.status === 'validating'));
  assert.ok(events.some(event => event.type === 'item' && event.status === 'saved' && event.savedId === 'saved-one'));
});

test('batch runner skips existing work and honours stop between prompts', async () => {
  let stop = false;
  let generated = 0;
  const summary = await runBatch({
    prompts: [
      { id: 'skip', prompt: 'skip me' },
      { id: 'save', prompt: 'save me' },
      { id: 'never', prompt: 'never run' },
    ],
    model: { modelId: 'model-a' },
    options: { skipExisting: true, captureThumbnails: false },
    deps: {
      hasExistingForModel: prompt => prompt.id === 'skip',
      generate: async () => { generated++; return VALID_CODE; },
      validate: validateSketchCode,
      extractParams: () => ({}),
      save: async () => { stop = true; return { id: 'saved' }; },
    },
    shouldStop: () => stop,
  });

  assert.equal(generated, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.saved, 1);
  assert.equal(summary.stopped, true);
});

test('past runs are reconstructed and ordered from project metadata', async () => {
  const file = text => ({ getFile: async () => ({ text: async () => text }) });
  const project = (prompt, metadata) => ({
    kind: 'directory',
    getFileHandle: async name => file(name === 'prompt.md' ? prompt : JSON.stringify(metadata)),
  });
  const entries = [
    ['a-2', project('Prompt A2', { title: 'A2', model: 'Model A', modelId: 'a', batch: { id: 'batch-a', startedAt: '2026-01-01T10:00:00Z', index: 1 } })],
    ['b-1', project('Prompt B1', { title: 'B1', model: 'Model B', modelId: 'b', batch: { id: 'batch-b', startedAt: '2026-02-01T10:00:00Z', index: 0 } })],
    ['a-1', project('Prompt A1', { title: 'A1', model: 'Model A', modelId: 'a', batch: { id: 'batch-a', startedAt: '2026-01-01T10:00:00Z', index: 0 } })],
    ['manual', project('Not a batch', { title: 'Manual' })],
  ];
  const root = {
    getDirectoryHandle: async () => ({ async *[Symbol.asyncIterator]() { yield* entries; } }),
  };

  const runs = await listBatchRuns(root);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].id, 'batch-b');
  assert.equal(runs[1].count, 2);
  assert.deepEqual(runs[1].items.map(item => item.projectId), ['a-1', 'a-2']);
});

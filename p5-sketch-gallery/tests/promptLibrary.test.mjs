import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURATED_PROMPTS,
  guessPromptCategory,
  mergePromptLibrary,
  normalizePromptText,
  promptSimilarity,
} from '../services/promptLibrary.js';
import { listProjectPromptRecords } from '../services/storage/projectStore.js';

function fakeFile(text) {
  return { getFile: async () => ({ text: async () => text }) };
}

function fakeProject(files) {
  return {
    kind: 'directory',
    async getFileHandle(name) {
      if (!(name in files)) throw new Error('not found');
      return fakeFile(files[name]);
    },
  };
}

test('curated catalogue has unique ids and no near-duplicate prompts', () => {
  assert.ok(CURATED_PROMPTS.length >= 20);
  assert.equal(new Set(CURATED_PROMPTS.map(item => item.id)).size, CURATED_PROMPTS.length);

  for (let i = 0; i < CURATED_PROMPTS.length; i++) {
    assert.ok(CURATED_PROMPTS[i].prompt.includes('function sketch(p, ctx)'));
    for (let j = i + 1; j < CURATED_PROMPTS.length; j++) {
      assert.notEqual(normalizePromptText(CURATED_PROMPTS[i].prompt), normalizePromptText(CURATED_PROMPTS[j].prompt));
      assert.ok(
        promptSimilarity(CURATED_PROMPTS[i].prompt, CURATED_PROMPTS[j].prompt) < 0.82,
        `${CURATED_PROMPTS[i].title} duplicates ${CURATED_PROMPTS[j].title}`,
      );
    }
  }
});

test('saved generations with the same prompt collapse into one card', () => {
  const prompt = CURATED_PROMPTS[0];
  const merged = mergePromptLibrary([prompt], [
    { id: 'one', projectId: 'project-one', title: prompt.title, prompt: prompt.prompt, tags: ['saved'] },
    { id: 'two', projectId: 'project-two', title: prompt.title, prompt: `  ${prompt.prompt}\n`, tags: ['second'] },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'curated');
  assert.equal(merged[0].savedCount, 2);
  assert.deepEqual(new Set(merged[0].projectIds), new Set(['project-one', 'project-two']));
  assert.ok(merged[0].tags.includes('saved'));
});

test('distinct saved prompts remain visible and receive a useful category', () => {
  const galleryPrompt = {
    id: 'gallery-light-game',
    projectId: 'light-game',
    title: 'Tiny Light Puzzle',
    prompt: 'Build a player-controlled puzzle game where reflected rays unlock a maze exit.',
    tags: ['raycasting'],
  };
  const merged = mergePromptLibrary([], [galleryPrompt]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'gallery');
  assert.equal(merged[0].category, 'games');
  assert.equal(merged[0].savedCount, 1);
  assert.equal(guessPromptCategory({ prompt: 'Inline GLSL fragment shader raymarching clouds' }), 'webgl');
});

test('gallery prompt scan reads prompt and metadata without loading thumbnails', async () => {
  const projectEntries = [
    ['kept', fakeProject({
      'prompt.md': 'A procedural ink creature.',
      'metadata.json': JSON.stringify({ title: 'Ink Creature', tags: ['ink'] }),
    })],
    ['empty', fakeProject({
      'prompt.md': '   ',
      'metadata.json': JSON.stringify({ title: 'No Prompt' }),
    })],
  ];
  const rootHandle = {
    async getDirectoryHandle(name) {
      assert.equal(name, 'projects');
      return {
        async *[Symbol.asyncIterator]() { yield* projectEntries; },
      };
    },
  };

  const records = await listProjectPromptRecords(rootHandle);
  assert.deepEqual(records, [{
    id: 'kept',
    prompt: 'A procedural ink creature.',
    metadata: { title: 'Ink Creature', tags: ['ink'] },
  }]);
});

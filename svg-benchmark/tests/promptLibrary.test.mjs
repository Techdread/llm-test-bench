import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PROMPT_CATEGORIES,
  categoryInfo,
  inferPromptCategory,
  normalizePrompt,
} from '../services/promptLibrary.js';

const catalogue = JSON.parse(await readFile(
  new URL('../data/prompts.json', import.meta.url),
  'utf8',
)).prompts;

test('SVG prompt catalogue has stable unique ids and slugs', () => {
  assert.ok(catalogue.length >= 60);
  assert.equal(new Set(catalogue.map(item => item.id)).size, catalogue.length);
  assert.equal(new Set(catalogue.map(item => item.slug)).size, catalogue.length);
  for (const item of catalogue) {
    assert.ok(item.title?.trim(), 'title is required');
    assert.ok(item.prompt?.trim(), `${item.id} needs a prompt`);
    assert.ok(item.slug.length <= 60, `${item.id} slug exceeds benchmark limit`);
  }
});

test('legacy general prompts are assigned useful catalogue categories', () => {
  assert.equal(inferPromptCategory({ title: 'Corgi', category: 'general' }), 'animals');
  assert.equal(inferPromptCategory({ title: 'VR Headset', category: 'general' }), 'technology');
  assert.equal(inferPromptCategory({ title: 'Eiffel Tower', category: 'general' }), 'places');
  assert.equal(inferPromptCategory({ title: 'Typewriter', category: 'general' }), 'objects');
});

test('normalised catalogue categories all exist in the UI registry', () => {
  const categoryIds = new Set(PROMPT_CATEGORIES.map(item => item.id));
  const normalised = catalogue.map(normalizePrompt);
  assert.ok(normalised.some(item => item.difficulty === 'complex'));
  assert.ok(normalised.some(item => item.difficulty === 'artistic'));
  for (const item of normalised) assert.ok(categoryIds.has(item.category), item.category);
  assert.equal(categoryInfo('missing').id, 'general');
});

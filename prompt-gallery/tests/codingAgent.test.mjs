import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPromptGalleryAgentTask, PROMPT_GALLERY_AGENT_OUTPUT } from '../services/codingAgent.js';

test('Prompt Gallery agent contract requires a portable standalone HTML file', () => {
  const task = buildPromptGalleryAgentTask('Build a responsive calculator');
  assert.equal(PROMPT_GALLERY_AGENT_OUTPUT, 'index.html');
  assert.match(task, /Build a responsive calculator/);
  assert.match(task, /Write the complete result to index\.html/);
  assert.match(task, /Do not reference shared\/lib/);
});

test('Prompt Gallery agent contract rejects an empty request', () => {
  assert.throws(() => buildPromptGalleryAgentTask('  '), /prompt is required/i);
});

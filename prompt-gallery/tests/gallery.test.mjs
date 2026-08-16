import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectGalleryFacets,
  filterProjects,
  filterVariants,
  groupGenerationsByFolder,
  humanizeFolderName,
  pickDistinctModelVariants,
  sortProjects,
} from '../services/gallery.js';

function generation(folderId, variantKey, metadata = {}, prompt = '') {
  return {
    id: `${folderId}/${variantKey}`,
    folderId,
    variantKey,
    prompt,
    response: '<!doctype html>',
    metadata: {
      model: 'Model A',
      rating: 0,
      tags: [],
      createdAt: '2026-07-01T12:00:00Z',
      notes: '',
      ...metadata,
    },
  };
}

const generations = [
  generation('neon-city', 'model-a_1', { rating: 2, tags: ['city'], notes: 'First pass' }, 'Build a neon city'),
  generation('neon-city', 'model-b_2', {
    model: 'Model B', rating: 5, tags: ['city', 'favorite'], createdAt: '2026-07-08T12:00:00Z',
  }, 'Build a neon city'),
  generation('neon-city', 'model-c_3', {
    model: 'Model C', derivedFrom: 'model-b_2', refine: { kind: 'improve' }, createdAt: '2026-07-09T12:00:00Z',
  }, 'Build a neon city'),
  generation('ocean-scene', 'model-a_4', {
    rating: 4, tags: ['water'], archivedAt: '2026-07-10T12:00:00Z', createdAt: '2026-06-01T12:00:00Z',
  }, 'Render an ocean'),
];

test('groups variants by folder and selects the highest-rated active representative', () => {
  const groups = groupGenerationsByFolder(generations);
  assert.equal(groups.length, 2);
  const city = groups.find(group => group.id === 'neon-city');
  assert.equal(city.title, 'Neon City');
  assert.equal(city.variantCount, 3);
  assert.equal(city.models.length, 3);
  assert.equal(city.bestRating, 5);
  assert.equal(city.unreviewedCount, 1);
  assert.equal(city.refinedCount, 1);
  assert.equal(city.representative.variantKey, 'model-b_2');
  assert.deepEqual(city.tags, ['city', 'favorite']);
});

test('filters collections without showing archived variants in normal views', () => {
  const now = Date.parse('2026-07-10T12:00:00Z');
  assert.equal(filterVariants(generations, { collection: 'all' }, now).length, 3);
  assert.equal(filterVariants(generations, { collection: 'unreviewed' }, now).length, 1);
  assert.equal(filterVariants(generations, { collection: 'favorites' }, now).length, 1);
  assert.equal(filterVariants(generations, { collection: 'refined' }, now).length, 1);
  assert.equal(filterVariants(generations, { collection: 'recent' }, now).length, 2);
  assert.equal(filterVariants(generations, { collection: 'archived' }, now).length, 1);
});

test('searches project prompt text and applies model, tag, and rating facets', () => {
  const projects = groupGenerationsByFolder(generations);
  assert.deepEqual(filterProjects(projects, { query: 'render an ocean', collection: 'archived' }).map(p => p.id), ['ocean-scene']);
  assert.equal(filterProjects(projects, { query: 'first pass', collection: 'all' }).length, 1);
  assert.equal(filterProjects(projects, { model: 'Model B', collection: 'all' }).length, 1);
  assert.equal(filterProjects(projects, { tag: 'favorite', minRating: 5, collection: 'all' }).length, 1);
  assert.equal(filterProjects(projects, { tag: 'water', collection: 'all' }).length, 0);
});

test('sorts projects and exposes stable facets', () => {
  const projects = groupGenerationsByFolder(generations);
  assert.equal(sortProjects(projects, 'rating-desc')[0].id, 'neon-city');
  assert.equal(sortProjects(projects, 'name-asc')[0].id, 'neon-city');
  assert.deepEqual(collectGalleryFacets(generations), {
    models: ['Model A', 'Model B', 'Model C'],
    tags: ['city', 'favorite', 'water'],
  });
  assert.equal(humanizeFolderName('threejs-neon_city'), 'Threejs Neon City');
});

test('lining up a prompt takes one variant per model, best rated first', () => {
  const city = groupGenerationsByFolder(generations).find(group => group.id === 'neon-city');
  const picked = pickDistinctModelVariants(city.variants, 4);

  assert.deepEqual(picked.map(g => g.metadata.model), ['Model B', 'Model A', 'Model C']);
});

test('lining up respects the column limit and never picks a model twice', () => {
  const city = groupGenerationsByFolder(generations).find(group => group.id === 'neon-city');
  const picked = pickDistinctModelVariants(city.variants, 2);

  assert.equal(picked.length, 2);
  assert.equal(new Set(picked.map(g => g.metadata.model)).size, 2);
});

test('a single-model prompt still fills the columns with its own variants', () => {
  const variants = [
    generation('solo', 'a', { rating: 1 }),
    generation('solo', 'b', { rating: 3 }),
    generation('solo', 'c', { rating: 2 }),
  ];
  const picked = pickDistinctModelVariants(variants, 3);

  assert.deepEqual(picked.map(g => g.variantKey), ['b', 'c', 'a']);
});

test('archived variants are skipped unless that is all there is', () => {
  const ocean = groupGenerationsByFolder(generations).find(group => group.id === 'ocean-scene');
  assert.deepEqual(pickDistinctModelVariants(ocean.variants, 4).map(g => g.variantKey), ['model-a_4']);

  const mixed = [
    generation('mix', 'live', { rating: 1 }),
    generation('mix', 'old', { rating: 5, archivedAt: '2026-07-10T12:00:00Z' }),
  ];
  assert.deepEqual(pickDistinctModelVariants(mixed, 4).map(g => g.variantKey), ['live']);
});

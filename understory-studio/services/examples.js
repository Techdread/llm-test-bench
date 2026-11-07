// Bundled examples: finished projects shipped with the app in `examples/`, built
// from real runs by tools/understory-examples.mjs.
//
// They exist for the visitor who has neither a data root nor an API key (the
// public site has neither), so the first thing they see is an asset they can
// turn, light, inspect at every level of detail and export, not an empty
// viewport. An example opens as a NEW, unsaved project under a fresh id: refining
// it with a data root connected saves a project of your own, and the bundled
// file is never written to.

import { newProject } from './projectStore.js';

const EXAMPLES_URL = new URL('../examples/', import.meta.url);

/** `{ default, examples: [...] }`, with poster URLs made absolute. Never throws:
 *  a missing index means no examples, not a broken app. */
export async function loadExampleIndex(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(new URL('index.json', EXAMPLES_URL));
    if (!response.ok) return { default: '', examples: [] };
    return normalizeExampleIndex(await response.json(), EXAMPLES_URL);
  } catch {
    return { default: '', examples: [] };
  }
}

export function normalizeExampleIndex(index, base = EXAMPLES_URL) {
  const examples = (Array.isArray(index?.examples) ? index.examples : [])
    .filter(entry => entry && typeof entry.slug === 'string' && typeof entry.file === 'string')
    .map(entry => ({
      ...entry,
      name: entry.name || entry.slug,
      kind: entry.kind || 'object',
      rigging: entry.rigging || 'none',
      versions: Number(entry.versions) || 0,
      poster: entry.poster ? String(new URL(entry.poster, base)) : '',
      url: String(new URL(entry.file, base)),
    }));
  const fallback = examples[0]?.slug || '';
  const chosen = examples.some(entry => entry.slug === index?.default) ? index.default : fallback;
  return { default: chosen, examples };
}

/** The example as a project ready to open: a fresh id, so nothing the person
 *  does afterwards can be mistaken for the bundled file. */
export function exampleToProject(example, slug = '') {
  const versions = (Array.isArray(example?.versions) ? example.versions : []).filter(version => version?.code);
  if (!versions.length) throw new Error('That example has no design to show.');
  return {
    ...newProject({
      name: example.name || 'Example',
      kind: example.kind || 'object',
      brief: example.brief || '',
      references: Array.isArray(example.references) ? example.references : [],
    }),
    rigging: example.rigging || 'none',
    versions,
    example: slug,
  };
}

export async function loadExample(entry, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(entry.url);
  if (!response.ok) throw new Error(`The "${entry.name}" example could not be loaded (${response.status}).`);
  return exampleToProject(await response.json(), entry.slug);
}

// Metadata-shaped helpers — re-exports the project store's metadata surface.
export { createMetadata, updateMetadata } from './projectStore.js';

export function uniqueTags(projects) {
  const set = new Set();
  for (const p of projects) {
    for (const t of p.tags || []) set.add(t);
  }
  return [...set].sort();
}

export function lineageOf(projects, id) {
  const byId = new Map(projects.map(p => [p.id, p]));
  const ancestors = [];
  let cur = byId.get(id);
  while (cur && cur.parentId && byId.get(cur.parentId)) {
    cur = byId.get(cur.parentId);
    ancestors.unshift(cur);
  }
  const children = projects.filter(p => p.parentId === id);
  return { ancestors, children };
}

// Seed prompt library for SVG Benchmark.
// The prompts were harvested from the existing on-disk benchmarks into
// ./data/prompts.json (see tools/harvest). They ship with the app so the
// Batch Run feature always has a canonical set of prompts to iterate, even on
// a fresh data root. Each seed carries the same `slug` its benchmark folder
// uses, so batch submissions land in the right benchmark.

let seedsCache = null;

export async function loadSeedPrompts() {
  if (seedsCache) return seedsCache;
  try {
    const res = await fetch('./data/prompts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    seedsCache = (data.prompts || []).map(p => ({ ...p, source: 'seed' }));
  } catch (e) {
    console.warn('[promptLibrary] failed to load seed prompts:', e?.message || e);
    seedsCache = [];
  }
  return seedsCache;
}

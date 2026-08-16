import { paramsSignature } from '../../shared/services/gen-params.js';

// Live p5 canvases are substantially heavier than static SVG previews. Nine
// still gives a useful model/parameter matrix without creating dozens of
// continuously animating iframes at once.
export const MAX_COMPARE_RUNS = 9;

export function runItemKey(item = {}) {
  if (item.jobKey) return item.jobKey;
  const promptKey = item.promptId
    || String(item.prompt || item.title || item.projectId || 'sketch').trim().toLowerCase();
  const generationParams = item.generationParams || item.metadata?.generationParams || {};
  return `${promptKey}#${paramsSignature(generationParams)}`;
}

export function gridShape(count) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count <= 3) return { cols: count, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  return { cols: 3, rows: 3 };
}

export function collectRunJobs(runs = []) {
  const seen = new Map();
  for (const run of runs) {
    for (const item of (run.loaded || run.items || [])) {
      const key = runItemKey(item);
      if (!seen.has(key)) {
        const generationParams = item.generationParams || item.metadata?.generationParams || {};
        seen.set(key, {
          key,
          title: item.title || item.metadata?.title || item.promptId || item.projectId || 'Sketch',
          prompt: item.prompt || '',
          paramsLabel: paramsSignature(generationParams),
        });
      }
    }
  }
  return [...seen.values()];
}

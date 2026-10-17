import { ensureAppNamespace } from '../../shared/services/data-root-manager.js';
import { promoteBundleEntries } from '../../shared/game-refinement/services/promotion.js';
import { createGameForgeBundleEntries } from './bundleExport.js';

export async function promoteRunToStudio({ gameSlug, run, title, openInNewTab = true } = {}) {
  if (!run?.projectHandle || !run?.runDir) throw new Error('Select a saved run before promoting');
  const meta = run.meta || {};
  const bundle = await createGameForgeBundleEntries({
    projectHandle: run.projectHandle,
    runDir: run.runDir,
    meta,
    gameSlug,
    runId: run.runId,
  });
  const refinementRoot = await ensureAppNamespace('game-refinement');
  const promoted = await promoteBundleEntries({
    refinementRoot,
    entries: bundle.entries,
    title,
  });
  if (openInNewTab && typeof window !== 'undefined') {
    window.open(`../game-refinement/?project=${encodeURIComponent(promoted.projectId)}`, '_blank', 'noopener');
  }
  return promoted;
}

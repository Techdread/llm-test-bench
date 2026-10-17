// Forge runs (Game Forge, VR Forge) as showcase bundles: walk the run's
// project/ folder, keep only web runtime files, and leave pinned libraries out
// when this site already serves them. Browser-only (fetch for the library check).

import { isTextPath, projectFileRule } from './showcase-checks.js';
import { collectProjectFiles } from './candidates.js';
import { bundleProject, vendoredLibraryIndex } from '../../shared/forge/services/showcaseProject.js';

let index = null;
const served = new Map();

/** True when this site serves the pinned library with that hash (checked once per file). */
async function siteServes(sha256) {
  index ||= vendoredLibraryIndex();
  const source = index.get(sha256);
  if (!source) return false;
  if (!served.has(sha256)) {
    served.set(sha256, fetch(source.url, { method: 'HEAD' }).then(res => res.ok, () => false));
  }
  return served.get(sha256);
}

/** Read and bundle one run. Returns { text, bundle, skipped, vendoredCount, bytes }. */
export async function bundleRun(reader, candidate) {
  const { files, skipped } = await collectProjectFiles(reader, candidate.source, projectFileRule);
  const { bundle, text, vendoredCount } = await bundleProject(files, {
    app: candidate.bench, isText: isTextPath, canVendor: siteServes,
  });
  return { bundle, text, skipped, vendoredCount, bytes: new TextEncoder().encode(text).length };
}

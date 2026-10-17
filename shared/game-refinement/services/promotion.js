import { allocateRefinementProjectId, normalizeBundleManifest, normalizePromotionRequest } from '../contracts/promotion.js';
import { createRefinementProject } from '../contracts/refinementProject.js';
import { createIntegrityInventory, integrityIdentity, validateArchiveEntries, verifyIntegrityInventory } from './integrity.js';
import { ensureDirectory, writeEntries, writeFileAt, writeJsonAt } from './projectCopy.js';

const decoder = new TextDecoder();

function parseJson(entries, path, required = true) {
  const bytes = entries[path];
  if (!bytes) {
    if (required) throw new Error(`Bundle path is required: ${path}`);
    return null;
  }
  try { return JSON.parse(decoder.decode(bytes)); }
  catch { throw new Error(`Bundle JSON is invalid: ${path}`); }
}

async function uniqueProjectDirectory(refinementRoot, requestedId) {
  const projects = await refinementRoot.getDirectoryHandle('projects', { create: true });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const projectId = attempt === 0 && requestedId ? requestedId : allocateRefinementProjectId();
    try {
      await projects.getDirectoryHandle(projectId);
    } catch {
      return { projectId, projectDir: await projects.getDirectoryHandle(projectId, { create: true }) };
    }
  }
  throw new Error('Could not allocate a unique refinement project id');
}

export async function promoteBundleEntries({
  refinementRoot,
  entries: rawEntries,
  title,
  projectId,
  sourceArchiveBytes = null,
  createdAt = new Date().toISOString(),
  extractionLimits,
} = {}) {
  if (!refinementRoot) throw new Error('A game-refinement data-root namespace is required');
  const checked = validateArchiveEntries(rawEntries, extractionLimits);
  if (checked.errors.length) throw new Error(`Unsafe Game Forge bundle: ${checked.errors.join('; ')}`);
  const entries = checked.entries;
  const { manifest: bundle, errors: bundleErrors } = normalizeBundleManifest(parseJson(entries, 'bundle.json'));
  if (bundleErrors.length) throw new Error(`Invalid Game Forge bundle: ${bundleErrors.join('; ')}`);
  const suppliedIntegrity = parseJson(entries, bundle.contracts.integrity || 'integrity.json');
  const protectedEntries = { ...entries };
  delete protectedEntries[bundle.contracts.integrity || 'integrity.json'];
  const verified = await verifyIntegrityInventory(protectedEntries, suppliedIntegrity, { rejectUnlisted: true });
  if (!verified.ok) throw new Error(`Game Forge bundle integrity failed: ${verified.errors.join('; ')}`);

  const sourceRoot = bundle.contracts.sourceRoot || 'source/';
  const projectEntries = Object.fromEntries(Object.entries(entries)
    .filter(([path]) => path.startsWith(sourceRoot) && path.length > sourceRoot.length)
    .map(([path, bytes]) => [path.slice(sourceRoot.length), bytes]));
  if (!Object.keys(projectEntries).length) throw new Error('Game Forge bundle contains no source project files');
  const baselineIntegrity = await createIntegrityInventory(projectEntries, { kind: 'game-refinement-baseline-integrity' });
  const sourceIdentity = await integrityIdentity(baselineIntegrity);
  const validation = parseJson(entries, 'evidence/validation.json', false);
  const request = normalizePromotionRequest({
    title: title || bundle.artifact?.title,
    projectId,
    validationStatus: validation?.status || bundle.source.status || 'unknown',
  });
  const allocated = await uniqueProjectDirectory(refinementRoot, request.projectId);
  const screenshotPath = entries['evidence/preview.png'] ? 'baseline/evidence/screenshot.png' : null;
  const manifest = createRefinementProject({
    projectId: allocated.projectId,
    title: request.title,
    createdAt,
    source: {
      bundleId: bundle.bundleId,
      runId: bundle.source.runId,
      gameId: bundle.source.gameSlug,
      promptVersion: bundle.source.promptVersion,
      runtime: bundle.artifact?.runtime || 'unknown',
      integritySha256: sourceIdentity,
    },
    baseline: { validationStatus: request.validationStatus, screenshot: screenshotPath },
  });

  const sourceFiles = {
    'bundle-manifest.json': entries['bundle.json'],
    'brief.json': entries[bundle.contracts.brief || 'design/brief.json'],
    'acceptance.json': entries[bundle.contracts.acceptance || 'handoff/acceptance.json'],
    'provenance.json': entries[bundle.contracts.provenance || 'evidence/provenance.json'],
  };
  await writeEntries(await ensureDirectory(allocated.projectDir, 'source'), Object.fromEntries(Object.entries(sourceFiles).filter(([, value]) => value)));
  await writeEntries(await ensureDirectory(allocated.projectDir, 'baseline/project'), projectEntries);
  await writeJsonAt(allocated.projectDir, 'baseline/integrity.json', baselineIntegrity);
  if (validation) await writeJsonAt(allocated.projectDir, 'baseline/evidence/validation.json', {
    ...validation,
    refinementEvidence: { mode: 'reused', source: 'Game Forge bundle', reusedAt: createdAt },
  });
  if (entries['evidence/preview.png']) await writeFileAt(allocated.projectDir, 'baseline/evidence/screenshot.png', entries['evidence/preview.png']);
  if (sourceArchiveBytes) await writeFileAt(allocated.projectDir, 'imports/source.gameforge.zip', sourceArchiveBytes);
  await writeJsonAt(allocated.projectDir, 'refinement-project.json', manifest);
  return { projectId: allocated.projectId, projectDir: allocated.projectDir, manifest, baselineIntegrity, warning: request.warning };
}

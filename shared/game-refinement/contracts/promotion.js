export const PROMOTION_SCHEMA_VERSION = 1;
export const SUPPORTED_BUNDLE_SCHEMA_VERSION = 1;

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

export function allocateRefinementProjectId({
  now = Date.now(),
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
} = {}) {
  const suffix = randomUUID
    ? randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `refine-${Number(now).toString(36)}-${suffix}`;
}

export function normalizeBundleManifest(value = {}) {
  const manifest = {
    ...value,
    kind: value.kind,
    schemaVersion: Number(value.schemaVersion),
    bundleId: text(value.bundleId),
    producer: { ...(value.producer || {}) },
    source: { ...(value.source || {}) },
    artifact: { ...(value.artifact || {}) },
    contracts: { ...(value.contracts || {}) },
  };
  const errors = [];
  if (manifest.kind !== 'game-forge-bundle') errors.push('bundle kind must be game-forge-bundle');
  if (manifest.schemaVersion !== SUPPORTED_BUNDLE_SCHEMA_VERSION) {
    errors.push(`unsupported required bundle schemaVersion ${value.schemaVersion ?? 'missing'}`);
  }
  if (!manifest.bundleId) errors.push('bundleId is required');
  if (!text(manifest.source.runId)) errors.push('source.runId is required');
  if (!text(manifest.source.gameSlug)) errors.push('source.gameSlug is required');
  if (text(manifest.contracts.sourceRoot) !== 'source/') errors.push('contracts.sourceRoot must be source/');
  return { manifest, errors };
}

export function normalizePromotionRequest(value = {}) {
  const status = text(value.validationStatus || value.status, 'unknown').toLowerCase();
  return {
    schemaVersion: PROMOTION_SCHEMA_VERSION,
    title: text(value.title, 'Untitled refinement'),
    projectId: text(value.projectId) || null,
    validationStatus: status,
    userRated: Number(value.rating) > 0,
    warning: status === 'failed'
      ? 'The source run failed validation. Promotion preserves that status and evidence so a later revision can repair it.'
      : null,
  };
}

export function canPromoteRun(meta) {
  // A run folder with no forge.json (an interrupted or legacy run) has null
  // metadata; a default parameter does not cover null, and throwing here takes
  // the whole Runs view down with it.
  const { status, rating } = meta || {};
  const normalized = text(status, 'unknown').toLowerCase();
  const ordinary = ['passed', 'warned', 'passed-with-warnings'].includes(normalized);
  return {
    allowed: ordinary || normalized === 'failed' || Number(rating) > 0,
    requiresWarning: normalized === 'failed',
  };
}

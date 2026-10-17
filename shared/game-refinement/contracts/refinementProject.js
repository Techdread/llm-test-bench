export const REFINEMENT_PROJECT_SCHEMA_VERSION = 1;

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

export function createRefinementProject({
  projectId,
  title,
  source,
  baseline,
  createdAt = new Date().toISOString(),
} = {}) {
  return {
    kind: 'game-refinement-project',
    schemaVersion: REFINEMENT_PROJECT_SCHEMA_VERSION,
    projectId: text(projectId),
    title: text(title, 'Untitled refinement'),
    createdAt,
    source: {
      bundleId: text(source?.bundleId),
      runId: text(source?.runId),
      gameId: text(source?.gameId),
      promptVersion: Number(source?.promptVersion || 1),
      runtime: text(source?.runtime, 'unknown'),
      integritySha256: text(source?.integritySha256),
    },
    baseline: {
      revisionId: 'baseline',
      validationStatus: text(baseline?.validationStatus, 'unknown'),
      screenshot: baseline?.screenshot || null,
    },
    classification: {
      primaryGenre: null,
      secondaryGenres: [],
      confidence: null,
      decidedBy: null,
    },
    acceptedRevisionId: 'baseline',
    contentPacks: [],
    updatedAt: createdAt,
  };
}

export function normalizeRefinementProject(value = {}) {
  const project = {
    ...value,
    kind: value.kind,
    schemaVersion: Number(value.schemaVersion),
    projectId: text(value.projectId),
    title: text(value.title, 'Untitled refinement'),
    source: { ...(value.source || {}) },
    baseline: { ...(value.baseline || {}), revisionId: 'baseline' },
    classification: {
      primaryGenre: value.classification?.primaryGenre || null,
      secondaryGenres: [...new Set((value.classification?.secondaryGenres || []).filter(Boolean))],
      confidence: Number.isFinite(Number(value.classification?.confidence))
        ? Math.max(0, Math.min(1, Number(value.classification.confidence))) : null,
      decidedBy: value.classification?.decidedBy || null,
    },
    acceptedRevisionId: text(value.acceptedRevisionId, 'baseline'),
    contentPacks: Array.isArray(value.contentPacks) ? [...value.contentPacks] : [],
  };
  const errors = [];
  if (project.kind !== 'game-refinement-project') errors.push('kind must be game-refinement-project');
  if (project.schemaVersion !== REFINEMENT_PROJECT_SCHEMA_VERSION) errors.push('unsupported refinement project schemaVersion');
  if (!project.projectId) errors.push('projectId is required');
  if (!text(project.source.bundleId)) errors.push('source.bundleId is required');
  if (!text(project.source.integritySha256)) errors.push('source.integritySha256 is required');
  if (project.baseline.revisionId !== 'baseline') errors.push('baseline.revisionId must be baseline');
  return { project, errors };
}

export function updateClassification(project, classification, { decidedBy = 'human', updatedAt = new Date().toISOString() } = {}) {
  const next = normalizeRefinementProject({
    ...project,
    classification: {
      ...project.classification,
      ...classification,
      decidedBy,
    },
    updatedAt,
  });
  if (next.errors.length) throw new Error(next.errors.join('; '));
  return next.project;
}

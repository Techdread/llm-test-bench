/** Local start time + the original unique run ID + a short filesystem-safe model. */
export function readableRunId({ now, suffix, backend, modelId, modelName, agentId, agentModel } = {}) {
  const pad = value => String(value).padStart(2, '0');
  const date = new Date(now);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const model = backend === 'agent'
    ? (agentModel || `${agentId || 'agent'}-default`)
    : (modelId || modelName || 'unknown-model');
  const label = String(model).split('/').filter(Boolean).pop()
    ?.replace(/:free$/i, '').replace(/-\d{8}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'unknown-model';
  return `${stamp}_run-${now}-${suffix}_${label}`;
}

/** Compare old and readable IDs by start time, independent of timezone or label. */
export function compareRunsNewestFirst(a, b) {
  const time = run => {
    const match = String(run.runId).match(/(?:^|_)run-(\d+)-/);
    return match ? Number(match[1]) : (Date.parse(run.meta?.createdAt) || 0);
  };
  return time(b) - time(a) || String(b.runId).localeCompare(String(a.runId));
}

/** Run IDs are opaque: bridge recovery accepts both legacy and readable folders. */
export function parseRunProjectPath(appId, projectDir = '') {
  const [app, projects, gameSlug, runId, project, ...extra] = projectDir.split('/');
  if (app !== appId || projects !== 'projects' || project !== 'project' || extra.length
    || !gameSlug || !runId || [gameSlug, runId].some(part => part === '.' || part === '..')) return null;
  return { gameSlug, runId };
}

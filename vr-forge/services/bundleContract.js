export const GAME_FORGE_BUNDLE_SCHEMA_VERSION = 1;
export const GAME_FORGE_PORT_REQUEST_SCHEMA_VERSION = 1;
export const GAME_FORGE_CONVERSION_REPORT_SCHEMA_VERSION = 1;

export const TARGET_ENVIRONMENTS = Object.freeze([
  {
    id: 'godot', title: 'Godot', icon: 'fa-robot', kind: 'engine',
    languages: ['gdscript', 'csharp'], defaultLanguage: 'gdscript',
    platforms: ['windows', 'linux', 'macos', 'android'], defaultPlatforms: ['windows'],
  },
  {
    id: 'unity', title: 'Unity', icon: 'fa-cubes', kind: 'engine',
    languages: ['csharp'], defaultLanguage: 'csharp',
    platforms: ['windows', 'linux', 'macos', 'android'], defaultPlatforms: ['windows'],
  },
  {
    id: 'unreal', title: 'Unreal Engine', icon: 'fa-cube', kind: 'engine',
    languages: ['cpp'], defaultLanguage: 'cpp',
    platforms: ['windows', 'linux', 'macos', 'android'], defaultPlatforms: ['windows'],
  },
  {
    id: 'android-native', title: 'Android native', icon: 'fa-mobile-screen-button', kind: 'platform',
    languages: ['kotlin', 'java'], defaultLanguage: 'kotlin',
    platforms: ['android'], defaultPlatforms: ['android'],
  },
  {
    id: 'desktop-wrapper', title: 'Desktop wrapper', icon: 'fa-desktop', kind: 'wrapper',
    languages: ['javascript', 'rust'], defaultLanguage: 'javascript',
    platforms: ['windows', 'linux', 'macos'], defaultPlatforms: ['windows'],
  },
]);

const TARGET_BY_ID = new Map(TARGET_ENVIRONMENTS.map(target => [target.id, target]));

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function uniqueStrings(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => stringValue(item).toLowerCase()).filter(Boolean))];
}

function snapshotFromMeta(meta = {}) {
  return meta.taskSnapshot || meta.promptSnapshot || {};
}

export function gameForgeBundleId(gameSlug, runId) {
  return `vr-forge:${stringValue(gameSlug, 'game')}:${stringValue(runId, 'run')}`;
}

export function createBundleManifest({
  gameSlug, runId, meta = {}, project = {}, forgeProject = null, createdAt = new Date().toISOString(),
} = {}) {
  const snapshot = snapshotFromMeta(meta);
  const bundleId = gameForgeBundleId(gameSlug || meta.artifactSlug, runId || meta.runId);
  return {
    kind: 'game-forge-bundle',
    schemaVersion: GAME_FORGE_BUNDLE_SCHEMA_VERSION,
    bundleId,
    immutable: true,
    createdAt,
    producer: { appId: 'vr-forge', adapterId: meta.adapterId || 'vr' },
    source: {
      gameSlug: stringValue(gameSlug || meta.artifactSlug),
      runId: stringValue(runId || meta.runId),
      parentRunId: meta.parentRunId || null,
      sourceRunIds: uniqueStrings(meta.sourceRunIds),
      promptVersion: Number(snapshot.version || meta.promptVersion || 1),
      createdAt: meta.createdAt || null,
      status: meta.status || null,
    },
    artifact: {
      kind: 'game',
      title: snapshot.title || meta.gameTitle || meta.taskTitle || gameSlug || 'Game',
      category: snapshot.category || meta.category || 'uncategorized',
      subcategory: snapshot.subcategory || meta.subcategory || '',
      collections: uniqueStrings(snapshot.collections || meta.collections),
      tags: uniqueStrings(snapshot.tags),
      originalTargetStack: snapshot.targetStack || meta.targetStack || 'web',
      runtime: forgeProject?.runtime || null,
      entry: forgeProject?.entry || null,
      fileCount: Number(project.fileCount) || 0,
      totalBytes: Number(project.totalBytes) || 0,
    },
    contracts: {
      sourceRoot: 'source/',
      brief: 'design/brief.json',
      gameSpec: 'design/game-spec.json',
      acceptance: 'handoff/acceptance.json',
      integrity: 'integrity.json',
      provenance: 'evidence/provenance.json',
    },
  };
}

export function createBriefContract(meta = {}) {
  const snapshot = snapshotFromMeta(meta);
  return {
    kind: 'game-forge-brief',
    schemaVersion: 1,
    id: snapshot.id || meta.taskId || null,
    version: Number(snapshot.version || meta.promptVersion || 1),
    title: snapshot.title || meta.gameTitle || meta.taskTitle || 'Game',
    prompt: snapshot.prompt || meta.prompt || '',
    watchFor: snapshot.watchFor || meta.watchFor || '',
    classification: {
      category: snapshot.category || meta.category || 'uncategorized',
      subcategory: snapshot.subcategory || meta.subcategory || '',
      collections: uniqueStrings(snapshot.collections || meta.collections),
      tags: uniqueStrings(snapshot.tags),
      era: snapshot.era || meta.era || '',
    },
    originalTarget: {
      stack: snapshot.targetStack || meta.targetStack || 'web',
      libraries: uniqueStrings(snapshot.libraries || meta.libraries),
    },
    authoring: snapshot.authoring || null,
  };
}

export function createGameSpecContract({ meta = {}, forgeProject = null } = {}) {
  const brief = createBriefContract(meta);
  return {
    kind: 'game-forge-game-spec',
    schemaVersion: 1,
    title: brief.title,
    sourceOfTruth: {
      implementation: 'source/',
      intent: 'design/brief.json',
      acceptance: 'handoff/acceptance.json',
      rule: 'When structured fields are incomplete, inspect and run the source rather than inventing behaviour.',
    },
    classification: brief.classification,
    implementation: forgeProject ? {
      runtime: forgeProject.runtime || null,
      entry: forgeProject.entry || null,
      build: forgeProject.build ?? null,
      run: forgeProject.run ?? null,
      assets: Array.isArray(forgeProject.assets) ? forgeProject.assets : [],
      declaredControls: Array.isArray(forgeProject.declaredControls) ? forgeProject.declaredControls : [],
    } : null,
    // Deliberately extensible rather than pretending Forge has a universal game IR.
    semanticInventory: {
      scenes: [],
      entities: [],
      systems: [],
      progression: [],
      persistence: [],
    },
  };
}

export function createAcceptanceContract({ meta = {}, validation = null } = {}) {
  const brief = createBriefContract(meta);
  const validationIssues = Array.isArray(validation?.issues) ? validation.issues : [];
  return {
    kind: 'game-forge-acceptance',
    schemaVersion: 1,
    principle: 'Preserve observable behaviour and creative intent; do not perform a line-by-line language translation.',
    criteria: [
      { id: 'brief', required: true, description: brief.prompt },
      ...(brief.watchFor ? [{ id: 'watch-for', required: true, description: brief.watchFor }] : []),
      { id: 'playable', required: true, description: 'The target project builds, launches, accepts input, and has working win/lose or progression states.' },
      { id: 'portable', required: true, description: 'The returned project contains no paths into the DevTools Hub repository.' },
      { id: 'report', required: true, description: 'Return conversion-report.json with parity, build evidence, changes, and known gaps.' },
    ],
    sourceValidation: validation ? {
      status: validation.status || null,
      checkedAt: validation.checkedAt || null,
      issues: validationIssues.map(issue => ({
        severity: issue.severity || 'warning', code: issue.code || 'issue',
        message: issue.message || '', path: issue.path || null,
      })),
    } : null,
    sourceEvaluation: meta.evaluation || null,
  };
}

export function normalizePortRequest(value = {}, { createdAt = new Date().toISOString() } = {}) {
  const targetEnvironment = stringValue(value.target?.environment || value.environment || 'godot').toLowerCase();
  const target = TARGET_BY_ID.get(targetEnvironment) || TARGET_BY_ID.get('godot');
  const requestedPlatforms = uniqueStrings(value.target?.platforms || value.platforms);
  const platforms = requestedPlatforms.filter(platform => target.platforms.includes(platform));
  const requestedLanguage = stringValue(value.target?.language || value.language).toLowerCase();
  return {
    kind: 'game-forge-port-request',
    schemaVersion: GAME_FORGE_PORT_REQUEST_SCHEMA_VERSION,
    requestId: stringValue(value.requestId) || `port-${createdAt.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    bundleId: stringValue(value.bundleId),
    target: {
      environment: target.id,
      environmentKind: target.kind,
      version: stringValue(value.target?.version || value.version) || null,
      language: target.languages.includes(requestedLanguage) ? requestedLanguage : target.defaultLanguage,
      platforms: platforms.length ? platforms : [...target.defaultPlatforms],
    },
    requirements: {
      preserveMechanics: value.requirements?.preserveMechanics !== false,
      preservePresentation: value.requirements?.preservePresentation !== false,
      adaptControls: value.requirements?.adaptControls !== false,
      offlineAssets: value.requirements?.offlineAssets !== false,
      buildAndRun: value.requirements?.buildAndRun !== false,
      appendOnlyOutput: true,
    },
    notes: stringValue(value.notes),
  };
}

export function validateBundleManifest(value) {
  const errors = [];
  if (value?.kind !== 'game-forge-bundle') errors.push('kind must be game-forge-bundle');
  if (Number(value?.schemaVersion) !== GAME_FORGE_BUNDLE_SCHEMA_VERSION) errors.push('unsupported bundle schemaVersion');
  if (!stringValue(value?.bundleId)) errors.push('bundleId is required');
  if (!stringValue(value?.source?.gameSlug)) errors.push('source.gameSlug is required');
  if (!stringValue(value?.source?.runId)) errors.push('source.runId is required');
  if (!stringValue(value?.contracts?.sourceRoot)) errors.push('contracts.sourceRoot is required');
  return errors;
}

export function validatePortRequest(value) {
  const errors = [];
  if (value?.kind !== 'game-forge-port-request') errors.push('kind must be game-forge-port-request');
  if (Number(value?.schemaVersion) !== GAME_FORGE_PORT_REQUEST_SCHEMA_VERSION) errors.push('unsupported port-request schemaVersion');
  if (!stringValue(value?.requestId)) errors.push('requestId is required');
  if (!stringValue(value?.bundleId)) errors.push('bundleId is required');
  const target = TARGET_BY_ID.get(value?.target?.environment);
  if (!target) errors.push('target.environment is unsupported');
  if (target && !(value.target.platforms || []).length) errors.push('target.platforms requires at least one platform');
  if (target && (value.target.platforms || []).some(platform => !target.platforms.includes(platform))) {
    errors.push('target.platforms contains an unsupported platform');
  }
  if (target && !target.languages.includes(value.target.language)) errors.push('target.language is unsupported');
  return errors;
}

export function createConversionReportTemplate(portRequest) {
  return {
    kind: 'game-forge-conversion-report',
    schemaVersion: GAME_FORGE_CONVERSION_REPORT_SCHEMA_VERSION,
    requestId: portRequest.requestId,
    bundleId: portRequest.bundleId,
    status: 'not-started',
    target: portRequest.target,
    toolchain: { environmentVersion: null, sdkVersions: {}, host: null },
    output: { projectRoot: 'output/project/', buildArtifacts: [], runCommand: null },
    parity: [],
    validation: { build: null, launch: null, tests: [], screenshots: [] },
    intentionalChanges: [],
    knownGaps: [],
    completedAt: null,
  };
}

export function summarizeTrace(trace = [], limit = 20) {
  return (Array.isArray(trace) ? trace : []).slice(-limit).map((step, index) => ({
    index: Math.max(0, trace.length - limit) + index,
    type: step.type || null,
    role: step.role || null,
    timestamp: step.timestamp || null,
    summary: stringValue(step.summary || step.text || step.content).slice(0, 1200),
    toolCalls: (step.toolCalls || step.calls || []).slice(0, 12).map(call => ({
      name: call.name || call.function?.name || null,
      ok: call.ok ?? call.valid ?? null,
      error: stringValue(call.error).slice(0, 400) || null,
    })),
  }));
}

export function renderAgentHandoff({ bundleManifest, portRequest }) {
  const target = TARGET_BY_ID.get(portRequest.target.environment);
  return `# VR Forge port handoff

You are working in the target environment for **${target?.title || portRequest.target.environment}**.
This archive is a behavioural contract and evidence package. It does not contain a mechanical source-code conversion.

## Objective

Create a complete ${target?.title || portRequest.target.environment} project for ${portRequest.target.platforms.join(', ')} using ${portRequest.target.language}${portRequest.target.version ? ` and target version ${portRequest.target.version}` : ''}.

## Contract

- Bundle: ${bundleManifest.bundleId}
- Port request: ${portRequest.requestId}
- Original implementation: \`source/\`
- Creative brief: \`design/brief.json\`
- Structured inventory: \`design/game-spec.json\`
- Required behaviour: \`handoff/acceptance.json\`
- Source evidence: \`evidence/\`
- File integrity: \`integrity.json\`

The source project is authoritative for existing behaviour. The brief and acceptance contract are authoritative for intent. Run and inspect the source where possible. Do not invent mechanics merely because the semantic inventory is intentionally incomplete.

## Required workflow

1. Inspect the contracts, evidence, source tree, controls, assets, and runtime manifest.
2. Record the target toolchain and SDK versions you actually find.
3. Write the new project under \`output/project/\`; never modify \`source/\`.
4. Port behaviour idiomatically for the target environment. Adapt controls and platform APIs without silently deleting mechanics.
5. Build and launch in the target environment. Capture useful logs/tests/screenshots under \`output/evidence/\`.
6. Complete \`output/conversion-report.json\` using \`handoff/conversion-report.template.json\`. Give every important mechanic a parity result and list every known gap.

Generated files alone are not completion. A successful handoff includes a buildable project, execution evidence, and an honest conversion report.
${portRequest.notes ? `\n## Request notes\n\n${portRequest.notes}\n` : ''}`;
}

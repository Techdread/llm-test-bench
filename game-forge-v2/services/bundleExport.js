import { projectManifest, projectZipEntries } from './projectWorkbench.js';
import { readProjectManifest } from './previewAdapters.js';
import {
  createAcceptanceContract, createBriefContract, createBundleManifest,
  createConversionReportTemplate, createGameSpecContract, normalizePortRequest,
  renderAgentHandoff, summarizeTrace, validateBundleManifest, validatePortRequest,
} from './bundleContract.js';

const encoder = new TextEncoder();

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value, null, 2));
}

function textBytes(value) {
  return encoder.encode(String(value));
}

async function readOptionalFile(directory, name) {
  try { return await (await directory.getFileHandle(name)).getFile(); }
  catch { return null; }
}

async function readOptionalJson(directory, name) {
  const file = await readOptionalFile(directory, name);
  if (!file) return null;
  try { return JSON.parse(await file.text()); } catch { return null; }
}

function safeFilename(value) {
  return String(value || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';
}

async function hashBytes(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const value of bytes) hash = Math.imul(hash ^ value, 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function integrityContract(entries) {
  const files = {};
  for (const path of Object.keys(entries).sort()) {
    files[path] = { bytes: entries[path].byteLength, sha256: await hashBytes(entries[path]) };
  }
  return {
    kind: 'game-forge-integrity', schemaVersion: 1,
    algorithm: globalThis.crypto?.subtle ? 'SHA-256' : 'FNV-1a fallback', files,
  };
}

function bundleReadme(bundleManifest, portRequest) {
  return `# ${bundleManifest.artifact.title}

This is an immutable Game Forge V2 contract bundle for run \`${bundleManifest.source.runId}\`.

- Original project: \`source/\`
- Creative brief: \`design/brief.json\`
- Game contract: \`design/game-spec.json\`
- Acceptance criteria: \`handoff/acceptance.json\`
- Provenance and validation: \`evidence/\`
- Integrity inventory: \`integrity.json\`
${portRequest ? `- Port request: \`handoff/port-request.json\`\n- Target-agent instructions: \`handoff/AGENT.md\`\n` : ''}
The bundle preserves both implementation and intent. Structured game fields may be incomplete by design; consumers must inspect the source and evidence rather than treating the bundle as a universal game-engine intermediate representation.
`;
}

export async function createGameForgeBundleEntries({
  projectHandle, runDir, meta = {}, gameSlug, runId,
  portRequestInput = null, createdAt = new Date().toISOString(),
} = {}) {
  const [sourceEntries, project, manifestInfo, validation, trace, capabilityAudit] = await Promise.all([
    projectZipEntries(projectHandle),
    projectManifest(projectHandle),
    readProjectManifest(projectHandle, { stack: meta.targetStack }),
    readOptionalJson(runDir, 'validation.json'),
    readOptionalJson(runDir, 'trace.json'),
    readOptionalJson(runDir, 'capability-audit.json'),
  ]);
  const bundleManifest = createBundleManifest({
    gameSlug, runId, meta, project, forgeProject: manifestInfo.manifest, createdAt,
  });
  const bundleErrors = validateBundleManifest(bundleManifest);
  if (bundleErrors.length) throw new Error(`Invalid Game Forge bundle: ${bundleErrors.join('; ')}`);

  const portRequest = portRequestInput ? normalizePortRequest({
    ...portRequestInput, bundleId: bundleManifest.bundleId,
  }, { createdAt }) : null;
  if (portRequest) {
    const portErrors = validatePortRequest(portRequest);
    if (portErrors.length) throw new Error(`Invalid port request: ${portErrors.join('; ')}`);
  }

  const entries = {};
  for (const [path, bytes] of Object.entries(sourceEntries)) entries[`source/${path}`] = bytes;
  entries['bundle.json'] = jsonBytes(bundleManifest);
  entries['README.md'] = textBytes(bundleReadme(bundleManifest, portRequest));
  entries['design/brief.json'] = jsonBytes(createBriefContract(meta));
  entries['design/game-spec.json'] = jsonBytes(createGameSpecContract({ meta, forgeProject: manifestInfo.manifest }));
  entries['handoff/acceptance.json'] = jsonBytes(createAcceptanceContract({ meta, validation }));
  entries['evidence/provenance.json'] = jsonBytes({
    kind: 'game-forge-provenance', schemaVersion: 1, bundledAt: createdAt, run: meta,
  });
  entries['evidence/project-manifest.json'] = jsonBytes(project);
  entries['evidence/preview-manifest.json'] = jsonBytes(manifestInfo);
  if (validation) entries['evidence/validation.json'] = jsonBytes(validation);
  if (meta.evaluation) entries['evidence/evaluation.json'] = jsonBytes(meta.evaluation);
  if (trace) entries['evidence/trace-summary.json'] = jsonBytes({
    kind: 'game-forge-trace-summary', schemaVersion: 1, steps: summarizeTrace(trace),
  });
  if (capabilityAudit) entries['evidence/capability-audit.json'] = jsonBytes(capabilityAudit);
  const preview = await readOptionalFile(runDir, 'preview.png');
  if (preview) entries['evidence/preview.png'] = new Uint8Array(await preview.arrayBuffer());

  if (portRequest) {
    entries['handoff/port-request.json'] = jsonBytes(portRequest);
    entries['handoff/AGENT.md'] = textBytes(renderAgentHandoff({ bundleManifest, portRequest }));
    entries['handoff/conversion-report.template.json'] = jsonBytes(createConversionReportTemplate(portRequest));
  }
  entries['integrity.json'] = jsonBytes(await integrityContract(entries));
  return { entries, bundleManifest, portRequest, project };
}

export async function createGameForgeBundleArchive(params) {
  const prepared = await createGameForgeBundleEntries(params);
  const { zipSync } = await import('../../shared/lib/fflate/0.8.2/index.mjs');
  return { ...prepared, bytes: zipSync(prepared.entries, { level: 6 }) };
}

async function ensureDirectory(root, parts) {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory;
}

function exportId(kind, createdAt) {
  const timestamp = createdAt.replace(/[:.]/g, '-');
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) || Math.random().toString(36).slice(2, 8);
  return `${kind}-${timestamp}-${suffix}`;
}

async function persistArchive(runDir, archive, createdAt) {
  const kind = archive.portRequest ? 'port' : 'bundle';
  const id = exportId(kind, createdAt);
  const directory = await ensureDirectory(runDir, ['exports', id]);
  const files = {
    'export.json': jsonBytes({
      kind: 'game-forge-export', schemaVersion: 1, exportId: id, createdAt,
      bundleId: archive.bundleManifest.bundleId,
      requestId: archive.portRequest?.requestId || null,
      type: archive.portRequest ? 'port-handoff' : 'source-bundle',
      archive: 'game.gameforge.zip',
    }),
    'bundle.json': jsonBytes(archive.bundleManifest),
    ...(archive.portRequest ? { 'port-request.json': jsonBytes(archive.portRequest) } : {}),
    'game.gameforge.zip': archive.bytes,
  };
  for (const [name, bytes] of Object.entries(files)) {
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    await writer.write(bytes);
    await writer.close();
  }
  return { exportId: id, path: `exports/${id}/game.gameforge.zip` };
}

function downloadArchive(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportGameForgeBundle({
  projectHandle, runDir, meta, gameSlug, runId, portRequestInput = null,
} = {}) {
  const createdAt = new Date().toISOString();
  const archive = await createGameForgeBundleArchive({
    projectHandle, runDir, meta, gameSlug, runId, portRequestInput, createdAt,
  });
  const persisted = await persistArchive(runDir, archive, createdAt);
  const target = archive.portRequest?.target.environment;
  const filename = `${safeFilename(gameSlug || meta?.artifactSlug)}-${safeFilename(runId)}${target ? `-${target}` : ''}.gameforge.zip`;
  downloadArchive(archive.bytes, filename);
  return {
    filename, bytes: archive.bytes.byteLength, ...persisted,
    bundleManifest: archive.bundleManifest, portRequest: archive.portRequest,
  };
}

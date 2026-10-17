import { projectManifest } from './projectWorkbench.js';
import { readProjectManifest } from './previewAdapters.js';

const MAX_CONTEXT_CHARS = 48_000;
const KEY_FILE_RE = /(^|\/)(forge-project\.json|readme\.md|index\.html|main\.(?:js|mjs|py|rs|c|cpp)|game\.(?:js|mjs))$/i;

function compactTrace(steps = [], agentEvents = []) {
  if (steps.length) {
    return steps.slice(-5).map(step => ({
      turn: step.turn,
      content: step.content?.slice(0, 1000) || null,
      tools: (step.toolCalls || []).map((call, index) => ({
        name: call.name,
        path: call.arguments?.path || null,
        error: step.toolResults?.[index]?.error || call.parseError || null,
      })),
      note: step.note || null,
    }));
  }
  return agentEvents.slice(-12);
}

export async function buildCoachContext({
  game, projectHandle, validation, steps, agentEvents, telemetry, doneSummary,
} = {}) {
  let files = { fileCount: 0, totalBytes: 0, files: [] };
  let preview = null;
  if (projectHandle) {
    [files, preview] = await Promise.all([
      projectManifest(projectHandle, { includeText: true, sourceLimit: 48 * 1024 }),
      readProjectManifest(projectHandle, { stack: game?.targetStack || 'web' }),
    ]);
  }
  const keyFiles = files.files
    .filter(file => file.text != null && (KEY_FILE_RE.test(file.path) || file.size < 12 * 1024))
    .slice(0, 10)
    .map(file => ({ path: file.path, size: file.size, text: file.text.slice(0, 9000) }));
  const context = {
    task: {
      title: game?.title || null,
      prompt: game?.prompt || null,
      watchFor: game?.watchFor || null,
      targetStack: game?.targetStack || 'web',
    },
    project: {
      fileCount: files.fileCount,
      totalBytes: files.totalBytes,
      manifest: preview?.manifest || null,
      files: files.files.map(file => ({ path: file.path, size: file.size, type: file.type })),
      keySources: keyFiles,
    },
    validation: validation ? {
      status: validation.status,
      issues: validation.issues || [],
      runtime: validation.runtime || null,
      structure: validation.structure || null,
      screenshotCaptured: !!validation.screenshotCaptured,
      screenshotArtifact: validation.screenshotCaptured ? 'preview.png in the current run folder' : null,
    } : null,
    recentTrace: compactTrace(steps, agentEvents),
    telemetry: telemetry || null,
    modelSummary: doneSummary || null,
  };
  const serialized = JSON.stringify(context, null, 2);
  return serialized.length <= MAX_CONTEXT_CHARS
    ? serialized
    : serialized.slice(0, MAX_CONTEXT_CHARS) + '\n… context truncated at 48,000 characters';
}

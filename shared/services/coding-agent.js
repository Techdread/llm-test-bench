// Reusable single-output coding-agent runner.
//
// Each run gets an append-only folder at:
//   <data-root>/<appId>/runs/<runId>/
//     request.json
//     trace.jsonl
//     result.json
//     project/<outputFile>
//
// The project folder is the only directory handed to the CLI agent.

import { ensureAppNamespace } from './data-root-manager.js';
import { getAgentModelEffort, runAgent } from './agent-backend.js';

export const DEFAULT_AGENT_BUDGETS = Object.freeze({
  maxTurns: 40,
  maxAgentSeconds: 900,
  idleTimeoutSeconds: 180,
  maxFiles: 100,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxImages: 6,
  maxImagePixels: 12 * 1024 * 1024,
  maxTokens: 200000,
  maxCostUsd: null,
});

const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_RE = /^[^/\\\0]+$/;

export function normalizeAgentOutputPath(value) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = path.split('/');
  if (!path || parts.some(part => !part || part === '.' || part === '..' || !SEGMENT_RE.test(part))) {
    throw new Error('Agent outputFile must be a safe project-relative path');
  }
  return parts.join('/');
}

export function createAgentRunId(now = Date.now(), random = Math.random()) {
  const suffix = Math.abs(Number(random) || 0).toString(36).replace(/^0\./, '').slice(0, 6).padEnd(6, '0');
  return `agent-${Number(now).toString(36)}-${suffix}`;
}

export function buildAgentProjectDir(appId, runId) {
  if (!APP_ID_RE.test(String(appId || ''))) throw new Error(`Invalid appId: ${appId}`);
  if (!/^agent-[a-z0-9-]+$/.test(String(runId || ''))) throw new Error(`Invalid agent run id: ${runId}`);
  return `${appId}/runs/${runId}/project`;
}

async function getDirectory(parent, name) {
  return parent.getDirectoryHandle(name, { create: true });
}

async function directoryForFile(root, relativePath, create = true) {
  const parts = normalizeAgentOutputPath(relativePath).split('/');
  const name = parts.pop();
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name };
}

async function writeFile(root, relativePath, content) {
  const { dir, name } = await directoryForFile(root, relativePath, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(content);
  await writer.close();
}

async function readFile(root, relativePath) {
  const { dir, name } = await directoryForFile(root, relativePath, false);
  const handle = await dir.getFileHandle(name);
  return (await handle.getFile()).text();
}

async function writeJson(root, name, value) {
  await writeFile(root, name, JSON.stringify(value, null, 2));
}

function createJsonlAppender(runDir) {
  let queue = Promise.resolve();
  return {
    append(value) {
      queue = queue.then(async () => {
        const handle = await runDir.getFileHandle('trace.jsonl', { create: true });
        const file = await handle.getFile();
        const writer = await handle.createWritable({ keepExistingData: true });
        await writer.seek(file.size);
        await writer.write(JSON.stringify(value) + '\n');
        await writer.close();
      }).catch(error => console.warn('[coding-agent] trace append failed:', error));
      return queue;
    },
    flush() { return queue; },
  };
}

export async function createCodingAgentWorkspace({ appId, outputFile, initialFiles = [], runId } = {}) {
  const safeOutputFile = normalizeAgentOutputPath(outputFile);
  const localRunId = runId || createAgentRunId();
  const appRoot = await ensureAppNamespace(appId);
  const runsDir = await getDirectory(appRoot, 'runs');
  const runDir = await getDirectory(runsDir, localRunId);
  const projectHandle = await getDirectory(runDir, 'project');
  for (const file of initialFiles || []) {
    await writeFile(projectHandle, normalizeAgentOutputPath(file.path), file.content ?? '');
  }
  return {
    runId: localRunId,
    runDir,
    projectHandle,
    projectDir: buildAgentProjectDir(appId, localRunId),
    outputFile: safeOutputFile,
  };
}

/**
 * Run a CLI coding agent in a fresh data-root workspace and return one required
 * output file. The entire project and trace remain on disk for audit/recovery.
 */
export async function runCodingAgentTask({
  appId,
  agentId,
  modelId = '',
  effort = '',
  task,
  outputFile,
  initialFiles = [],
  budgets = DEFAULT_AGENT_BUDGETS,
  signal,
  pollMs = 1000,
  onWorkspace,
  onStart,
  onEvent,
  onOutput,
} = {}) {
  if (!String(task || '').trim()) throw new Error('Coding-agent task is required');
  const resolvedEffort = effort || getAgentModelEffort(agentId, modelId, '');
  const workspace = await createCodingAgentWorkspace({ appId, outputFile, initialFiles });
  const startedAt = new Date().toISOString();
  const events = [];
  const trace = createJsonlAppender(workspace.runDir);
  let bridgeRunId = '';
  let lastOutput = '';
  let polling = false;

  await writeJson(workspace.runDir, 'request.json', {
    schemaVersion: 1,
    appId,
    runId: workspace.runId,
    agent: agentId,
    model: modelId || null,
    effort: resolvedEffort || null,
    outputFile: workspace.outputFile,
    projectDir: workspace.projectDir,
    initialFiles: initialFiles.map(file => normalizeAgentOutputPath(file.path)),
    budgets,
    task,
    createdAt: startedAt,
  });
  onWorkspace?.(workspace);

  const pollOutput = async () => {
    if (polling) return;
    polling = true;
    try {
      const content = await readFile(workspace.projectHandle, workspace.outputFile);
      if (content !== lastOutput) {
        lastOutput = content;
        onOutput?.(content, { final: false, workspace });
      }
    } catch {
      // Expected until the agent creates the required file.
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(pollOutput, Math.max(250, Number(pollMs) || 1000));

  try {
    const bridgeResult = await runAgent({
      agent: agentId,
      prompt: task,
      projectDir: workspace.projectDir,
      options: {
        ...(modelId ? { model: modelId } : {}),
        ...(resolvedEffort ? { effort: resolvedEffort } : {}),
      },
      budgets,
      signal,
      onStart: (id) => {
        bridgeRunId = id;
        onStart?.({ ...workspace, bridgeRunId: id });
      },
      onEvent: (event) => {
        events.push(event);
        trace.append({ index: events.length - 1, bridgeRunId, event, receivedAt: new Date().toISOString() });
        onEvent?.(event);
        if (event.type === 'file') pollOutput();
      },
    });
    bridgeRunId = bridgeResult.runId || bridgeRunId;
    await pollOutput();
    await trace.flush();
    const content = await readFile(workspace.projectHandle, workspace.outputFile)
      .catch(() => '');
    if (!content.trim()) {
      // A budget stop (idle/time/size) kills the agent mid-task, so "didn't
      // write the file" is the symptom, not the reason. Report the reason.
      const failure = [...events].reverse().find(event => event.type === 'error');
      throw new Error(failure?.message
        ? `${failure.message} — no ${workspace.outputFile} was written`
        : `Coding agent finished without writing ${workspace.outputFile}`);
    }
    if (content !== lastOutput) onOutput?.(content, { final: true, workspace });
    const result = {
      schemaVersion: 1,
      status: signal?.aborted ? 'cancelled' : 'completed',
      appId,
      runId: workspace.runId,
      bridgeRunId,
      agent: agentId,
      model: modelId || null,
      effort: resolvedEffort || null,
      outputFile: workspace.outputFile,
      projectDir: workspace.projectDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      doneEvent: bridgeResult.doneEvent || null,
      eventCount: events.length,
    };
    await writeJson(workspace.runDir, 'result.json', result);
    return { ...result, content, events, workspace };
  } catch (error) {
    await trace.flush();
    await writeJson(workspace.runDir, 'result.json', {
      schemaVersion: 1,
      status: signal?.aborted ? 'cancelled' : 'failed',
      appId,
      runId: workspace.runId,
      bridgeRunId: bridgeRunId || null,
      agent: agentId,
      model: modelId || null,
      effort: resolvedEffort || null,
      outputFile: workspace.outputFile,
      projectDir: workspace.projectDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      eventCount: events.length,
      error: error.message || String(error),
    }).catch(() => {});
    throw error;
  } finally {
    clearInterval(timer);
  }
}

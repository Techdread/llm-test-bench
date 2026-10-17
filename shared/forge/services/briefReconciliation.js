import { librariesFor, normalizeLibraryIds } from './projectLibraries.js';
import { AGENTS } from '../../services/agent-backend.js';

const MODES = new Set(['preserve', 'transform']);
const AGENT_IDS = new Set(AGENTS.map(agent => agent.id));
const META_FIELDS = new Set([
  'id', 'source', 'promptVersion', 'schemaVersion', 'authoring', 'derivation',
  'reviewNotes',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function jsonValue(value) {
  return JSON.stringify(value ?? null);
}

function librarySummary(ids, domain) {
  return librariesFor(ids).map(item => ({
    id: item.id,
    label: item.label,
    version: item.version,
    group: item.group,
    description: item.description,
    constraints: [
      ...item.briefing,
      ...(item.domainBriefing[domain] || []),
    ],
  }));
}

export function buildReconciliationMessages({
  brief,
  domain,
  domainLabel,
  mode = 'preserve',
  previousLibraries = [],
  selectedLibraries = [],
  intent = '',
} = {}) {
  if (!MODES.has(mode)) throw new Error(`Unknown reconciliation mode: ${mode}`);
  const selected = normalizeLibraryIds(selectedLibraries);
  const previous = normalizeLibraryIds(previousLibraries);
  const modeInstruction = mode === 'transform'
    ? `Transform the presentation or implementation where that is the clearest way to exploit the selected libraries.
The product's identity, core loop/problem, audience, and safety constraints must remain recognisable, but explicit
phrasing such as "2D sprites" may become a testable 3D requirement when a 3D engine and the user's intent support it.`
    : `Preserve the concept, genre, model question, audience, and presentation intent. Integrate the selected
libraries only where they help. Do not infer a 2D-to-3D conversion merely because a 3D-capable library is present.`;
  const system = `You reconcile a ${domainLabel || domain || 'Forge'} build brief with an author-selected,
locally provisioned library set. Rewrite the COMPLETE brief as one internally consistent object.

${modeInstruction}

Rules:
- Resolve contradictions across prompt, acceptance criteria, flows, visualisation, watch-for notes and other fields.
- Keep the selected library ids EXACTLY as supplied. Never add a dependency or CDN.
- Preserve the input JSON shape and all useful domain-specific fields.
- Make library use explicit and observable in the main prompt and relevant criteria.
- Respect every listed library constraint.
- Keep scope achievable in one autonomous coding run.
- Return JSON only with this shape:
  {"brief": <complete rewritten brief>, "summary": string, "conflicts": string[], "changes": string[]}`;
  const user = `Reconciliation mode: ${mode}
Domain: ${domain || 'forge'}
User intent (may be blank): ${clean(intent) || 'No additional instruction supplied.'}

Previous libraries:
${JSON.stringify(librarySummary(previous, domain), null, 2)}

Selected libraries (authoritative):
${JSON.stringify(librarySummary(selected, domain), null, 2)}

Current complete brief:
${JSON.stringify({ ...brief, libraries: selected }, null, 2)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseReconciliationResponse(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  let lastError = null;
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1));
          const brief = parsed.brief && typeof parsed.brief === 'object' ? parsed.brief : parsed;
          if (!brief || Array.isArray(brief) || typeof brief !== 'object') {
            throw new Error('The response did not contain a brief object.');
          }
          return {
            brief,
            summary: clean(parsed.summary),
            conflicts: (Array.isArray(parsed.conflicts) ? parsed.conflicts : []).map(clean).filter(Boolean),
            changes: (Array.isArray(parsed.changes) ? parsed.changes : []).map(clean).filter(Boolean),
          };
        } catch (error) {
          lastError = error;
          break;
        }
      }
    }
  }
  throw new Error(`Could not parse the reconciled brief: ${lastError?.message || 'no complete JSON object'}`);
}

function resolvedResponse(raw, brief, selectedLibraries) {
  const parsed = parseReconciliationResponse(raw);
  parsed.brief = {
    ...brief,
    ...parsed.brief,
    libraries: normalizeLibraryIds(selectedLibraries),
  };
  return { raw, ...parsed };
}

export async function reconcileBrief({
  brief,
  domain,
  domainLabel,
  mode,
  previousLibraries,
  selectedLibraries,
  intent,
  providerId,
  modelId,
  appTitle,
  signal,
  onChunk,
} = {}) {
  if (!providerId || !modelId) throw new Error('Select a model in the Forge toolbar first.');
  const { streamChatCompletion } = await import('../../services/model-providers.js');
  const raw = await streamChatCompletion({
    providerId,
    modelId,
    messages: buildReconciliationMessages({
      brief, domain, domainLabel, mode, previousLibraries, selectedLibraries, intent,
    }),
    appTitle: appTitle || 'Forge Brief Reconciler',
    signal,
    onChunk,
  });
  return resolvedResponse(raw, brief, selectedLibraries);
}

export function buildAgentReconciliationPrompt(options = {}) {
  const messages = buildReconciliationMessages(options);
  return `This is a planning and editing task only. Do not inspect, create, modify, or execute files.
Return the requested JSON object as your final answer, with no Markdown fence or commentary.

SYSTEM INSTRUCTIONS
${messages[0].content}

USER REQUEST
${messages[1].content}`;
}

async function writeJson(directory, name, value) {
  const file = await directory.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(value, null, 2));
  await writer.close();
}

function reconciliationJobId() {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
  return `reconcile-${new Date().toISOString().replace(/[:.]/g, '-')}-${random}`;
}

export async function reconcileBriefWithAgent({
  brief,
  domain,
  domainLabel,
  mode,
  previousLibraries,
  selectedLibraries,
  intent,
  appId,
  agentId,
  agentModel = '',
  runAgent,
  signal,
  onChunk,
  onEvent,
} = {}) {
  if (!AGENT_IDS.has(agentId)) throw new Error('Choose a supported CLI agent.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appId || '')) throw new Error('A valid Forge app id is required.');
  if (typeof runAgent !== 'function') throw new Error('The selected CLI bridge is unavailable.');

  const { ensureAppNamespace } = await import('../../services/data-root-manager.js');
  const appRoot = await ensureAppNamespace(appId);
  const jobsRoot = await appRoot.getDirectoryHandle('brief-reconciliations', { create: true });
  const jobId = reconciliationJobId();
  const jobDirectory = await jobsRoot.getDirectoryHandle(jobId, { create: true });
  const projectDir = `${appId}/brief-reconciliations/${jobId}`;
  const promptOptions = {
    brief, domain, domainLabel, mode, previousLibraries, selectedLibraries, intent,
  };
  const prompt = buildAgentReconciliationPrompt(promptOptions);
  const startedAt = new Date().toISOString();
  await writeJson(jobDirectory, 'request.json', {
    schemaVersion: 1,
    jobId,
    agentId,
    agentModel: agentModel || null,
    ...promptOptions,
    startedAt,
  });

  const messages = [];
  let lastError = null;
  let bridgeRunId = null;
  const result = await runAgent({
    agent: agentId,
    prompt,
    projectDir,
    options: agentModel ? { model: agentModel } : {},
    budgets: {
      maxTurns: 5,
      maxAgentSeconds: 300,
      idleTimeoutSeconds: 120,
      maxFiles: 2,
      maxTotalBytes: 128 * 1024,
      maxFileBytes: 64 * 1024,
      maxImages: 0,
      maxImagePixels: 0,
      maxTokens: 16_000,
      maxCostUsd: null,
    },
    signal,
    onStart: runId => { bridgeRunId = runId; },
    onEvent: event => {
      onEvent?.(event);
      if (event.type === 'message' && event.text) {
        messages.push(event.text);
        onChunk?.(messages.join('\n'));
      }
      if (event.type === 'error') lastError = event.message || 'CLI reconciliation failed.';
    },
  });
  if (signal?.aborted) throw new DOMException('Brief reconciliation cancelled', 'AbortError');
  const raw = clean(result.doneEvent?.summary) || messages.join('\n').trim();
  if ((result.doneEvent?.exitCode ?? 0) !== 0) {
    throw new Error(lastError || `The ${agentId} reconciliation process exited with an error.`);
  }
  if (!raw) throw new Error(lastError || `The ${agentId} reconciliation process returned no brief.`);

  const resolved = resolvedResponse(raw, brief, selectedLibraries);
  await writeJson(jobDirectory, 'response.json', {
    schemaVersion: 1,
    jobId,
    bridgeRunId: result.runId || bridgeRunId,
    raw,
    brief: resolved.brief,
    summary: resolved.summary,
    conflicts: resolved.conflicts,
    changes: resolved.changes,
    completedAt: new Date().toISOString(),
  });
  return { ...resolved, bridgeRunId: result.runId || bridgeRunId, jobId };
}

export function briefFieldDiff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter(key => !META_FIELDS.has(key) && jsonValue(before[key]) !== jsonValue(after[key]))
    .sort((left, right) => {
      const priority = ['title', 'prompt', 'libraries', 'acceptance', 'watchFor'];
      const li = priority.indexOf(left);
      const ri = priority.indexOf(right);
      if (li >= 0 || ri >= 0) return (li < 0 ? 99 : li) - (ri < 0 ? 99 : ri);
      return left.localeCompare(right);
    })
    .map(field => ({ field, before: before[field], after: after[field] }));
}

export function libraryChange(previous = [], selected = []) {
  const before = normalizeLibraryIds(previous);
  const after = normalizeLibraryIds(selected);
  return {
    added: after.filter(id => !before.includes(id)),
    removed: before.filter(id => !after.includes(id)),
    changed: jsonValue(before) !== jsonValue(after),
  };
}

export function reconciliationProvenance({
  parent,
  mode,
  intent,
  previousLibraries,
  selectedLibraries,
  backend = 'model',
  providerId,
  modelId,
  agentId,
  agentModel,
  modelDisplayLabel,
} = {}) {
  const change = libraryChange(previousLibraries, selectedLibraries);
  const generatedAt = new Date().toISOString();
  return {
    authoring: {
      source: 'ai-rewrite',
      mode: 'library-reconciliation',
      backend,
      providerId: backend === 'model' ? providerId : null,
      modelId: backend === 'model' ? modelId : (agentModel || null),
      agentId: backend === 'agent' ? agentId : null,
      modelDisplayLabel: modelDisplayLabel
        || (backend === 'agent' ? (agentModel || 'CLI default') : modelId),
      generatedAt,
    },
    derivation: {
      kind: 'library-reconciliation',
      mode,
      parentPromptId: parent?.id || null,
      parentPromptVersion: Number(parent?.promptVersion) || 1,
      addedLibraries: change.added,
      removedLibraries: change.removed,
      instruction: clean(intent),
      createdAt: generatedAt,
    },
  };
}

import { normalizeLibraryIds } from './projectLibraries.js';
import { normalizePromptTaxonomy } from './promptCategories.js';
import { AGENTS } from './agentBackend.js';

const MODES = new Set(['draft', 'improve', 'review', 'watch']);
const AGENT_IDS = new Set(AGENTS.map(agent => agent.id));

const SYSTEM_PROMPT = `You are a senior game designer and coding-model prompt engineer.
Write precise build briefs for an autonomous coding model that must produce a complete,
multi-file, portable game project.

Priorities:
- Specify the core game loop, controls, important mechanics, progression, win/lose states,
  presentation, and observable acceptance criteria.
- Keep the requested scope achievable in one autonomous coding run.
- Preserve the user's creative intent. Do not silently change genre or platform.
- The "watchFor" field must name likely shallow implementations or omitted mechanics.
- Prefer requirements that can be inspected or tested. Avoid vague praise and filler.
- For targetStack "web", require a self-contained static project without network dependencies.

Return exactly one JSON object with these keys:
{
  "title": string,
  "prompt": string,
  "era": string,
  "targetStack": string,
  "category": string,
  "subcategory": string,
  "collections": string[],
  "tags": string[],
  "watchFor": string,
  "reviewNotes": string[]
}

Keep "prompt" below 350 words, "watchFor" below 140 words, and tags to at most 10.
Return JSON only: no markdown, comments, preamble, or code fences.`;

const MODE_INSTRUCTIONS = {
  draft: 'Expand the user’s seed idea into a complete build-ready brief. Fill every field.',
  improve: 'Strengthen the current brief while preserving its intent. Resolve ambiguity and add missing observable requirements.',
  review: 'Review the current brief for ambiguity, conflicts, excessive scope, and untestable requirements. Return an improved version plus concise reviewNotes.',
  watch: 'Preserve title, prompt, era, targetStack, and tags. Rewrite only watchFor with concrete shortcuts, missing mechanics, and failure modes to inspect.',
};

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function normalizeDraftResult(value, fallback = {}) {
  if (!value || typeof value !== 'object') throw new Error('The drafting model did not return a JSON object.');
  const tags = [...new Set((Array.isArray(value.tags) ? value.tags : fallback.tags || [])
    .map(tag => cleanString(tag).toLowerCase()).filter(Boolean))].slice(0, 10);
  const result = {
    title: cleanString(value.title, cleanString(fallback.title)),
    prompt: cleanString(value.prompt, cleanString(fallback.prompt)),
    era: cleanString(value.era, cleanString(fallback.era, 'Custom')) || 'Custom',
    targetStack: cleanString(value.targetStack, cleanString(fallback.targetStack, 'web')) || 'web',
    // Provisioning is an author-controlled technical choice. Drafting keeps it
    // but cannot invent an unregistered dependency.
    libraries: normalizeLibraryIds(value.libraries ?? fallback.libraries),
    tags,
    ...normalizePromptTaxonomy({
      ...fallback,
      ...value,
      tags,
      category: cleanString(value.category, cleanString(fallback.category)),
      subcategory: cleanString(value.subcategory, cleanString(fallback.subcategory)),
      collections: Array.isArray(value.collections) ? value.collections : fallback.collections,
    }),
    watchFor: cleanString(value.watchFor, cleanString(fallback.watchFor)),
    reviewNotes: (Array.isArray(value.reviewNotes) ? value.reviewNotes : [])
      .map(note => cleanString(note)).filter(Boolean).slice(0, 8),
  };
  if (!result.title) throw new Error('The drafting model returned no title.');
  if (!result.prompt) throw new Error('The drafting model returned no build prompt.');
  return result;
}

export function parseDraftResponse(raw, fallback = {}) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  let lastError = null;
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          return normalizeDraftResult(JSON.parse(text.slice(start, index + 1)), fallback);
        } catch (error) {
          lastError = error;
          break;
        }
      }
    }
  }
  if (!text.includes('{')) {
    throw new Error('The drafting model did not return JSON. Try Review or choose a stronger instruction-following model.');
  }
  throw new Error(`Could not parse the drafting model’s JSON: ${lastError?.message || 'incomplete object'}`);
}

export function buildDraftMessages({ mode = 'draft', fields = {} } = {}) {
  if (!MODES.has(mode)) throw new Error(`Unknown prompt drafting mode: ${mode}`);
  const current = {
    title: cleanString(fields.title),
    prompt: cleanString(fields.prompt),
    era: cleanString(fields.era, 'Custom') || 'Custom',
    targetStack: cleanString(fields.targetStack, 'web') || 'web',
    libraries: normalizeLibraryIds(fields.libraries),
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    ...normalizePromptTaxonomy(fields),
    watchFor: cleanString(fields.watchFor),
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${MODE_INSTRUCTIONS[mode]}\n\nCurrent prompt fields:\n${JSON.stringify(current, null, 2)}`,
    },
  ];
}

export function buildAgentDraftPrompt({ mode = 'draft', fields = {} } = {}) {
  const messages = buildDraftMessages({ mode, fields });
  return `${messages[0].content}

${messages[1].content}

This is a prompt-authoring task only. Do not inspect the workspace, call tools,
run shell commands, or write files. Return the JSON object directly as your
final response.`;
}

export async function generatePromptDraft({
  mode = 'draft', fields, providerId, modelId, onChunk, signal,
} = {}) {
  if (!providerId || !modelId) throw new Error('Select a drafting model first.');
  if (!cleanString(fields?.title) && !cleanString(fields?.prompt)) {
    throw new Error('Enter a title or seed idea before asking the model to draft.');
  }
  const { streamChatCompletion } = await import('../../shared/services/model-providers.js');
  const messages = buildDraftMessages({ mode, fields });
  const raw = await streamChatCompletion({
    providerId,
    modelId,
    messages,
    appTitle: 'Game Forge V2 Prompt Author',
    onChunk,
    signal,
  });
  return {
    raw,
    suggestion: parseDraftResponse(raw, fields),
  };
}

async function writeJson(directory, name, value) {
  const file = await directory.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(JSON.stringify(value, null, 2));
  await writer.close();
}

function draftJobId() {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || Math.random().toString(36).slice(2, 10);
  return `draft-${new Date().toISOString().replace(/[:.]/g, '-')}-${random}`;
}

export async function generatePromptDraftWithAgent({
  mode = 'draft', fields, agentId, agentModel = '', onChunk, onEvent, signal,
} = {}) {
  if (!AGENT_IDS.has(agentId)) {
    throw new Error('Choose a supported CLI agent.');
  }
  if (!cleanString(fields?.title) && !cleanString(fields?.prompt)) {
    throw new Error('Enter a title or seed idea before asking the agent to draft.');
  }
  const [{ ensureAppNamespace }, { runAgent }] = await Promise.all([
    import('../../shared/services/data-root-manager.js'),
    import('./agentBackend.js'),
  ]);
  const appRoot = await ensureAppNamespace('game-forge-v2');
  const draftsRoot = await appRoot.getDirectoryHandle('prompt-drafts', { create: true });
  const jobId = draftJobId();
  const jobDirectory = await draftsRoot.getDirectoryHandle(jobId, { create: true });
  const projectDir = `game-forge-v2/prompt-drafts/${jobId}`;
  const prompt = buildAgentDraftPrompt({ mode, fields });
  const startedAt = new Date().toISOString();
  await writeJson(jobDirectory, 'request.json', {
    schemaVersion: 1,
    jobId,
    mode,
    agentId,
    agentModel: agentModel || null,
    fields,
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
      maxAgentSeconds: 180,
      idleTimeoutSeconds: 60,
      maxFiles: 4,
      maxTotalBytes: 128 * 1024,
      maxFileBytes: 64 * 1024,
      maxImages: 0,
      maxImagePixels: 0,
      maxTokens: 12_000,
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
      if (event.type === 'error') lastError = event.message || 'Agent drafting failed.';
    },
  });
  if (signal?.aborted) throw new DOMException('Prompt drafting cancelled', 'AbortError');
  const raw = cleanString(result.doneEvent?.summary) || messages.join('\n').trim();
  if ((result.doneEvent?.exitCode ?? 0) !== 0) {
    throw new Error(lastError || `The ${agentId} drafting process exited with an error.`);
  }
  if (!raw) throw new Error(lastError || `The ${agentId} drafting process returned no prompt.`);
  const suggestion = parseDraftResponse(raw, fields);
  await writeJson(jobDirectory, 'response.json', {
    schemaVersion: 1,
    jobId,
    bridgeRunId: result.runId || bridgeRunId,
    raw,
    suggestion,
    completedAt: new Date().toISOString(),
  });
  return {
    raw,
    suggestion,
    jobId,
    bridgeRunId: result.runId || bridgeRunId,
  };
}

import { projectManifest } from './projectWorkbench.js';

/** Keep the original brief and every accepted addition across successive forks. */
export function revisionBrief(game, iteration) {
  if (!iteration) {
    const composed = [game.originalPrompt, ...(game.specAdditions || []).map((item, index) =>
      `## Spec addition ${index + 1}\n${item.requestedChange}`)].join('\n\n');
    return game.originalPrompt !== undefined && composed === game.prompt
      ? { ...game, specAdditions: (game.specAdditions || []).map(item => ({ ...item })) }
      : { ...game, originalPrompt: game.prompt, specAdditions: [] };
  }
  const parent = iteration?.sources?.[0]?.meta || game;
  const originalPrompt = parent.originalPrompt ?? parent.prompt ?? game.prompt;
  const specAdditions = (parent.specAdditions || []).map(item => ({ ...item }));
  // Older revisions stored the instruction only in lineage metadata.
  if (!parent.specAdditions && parent.requestedChange && parent.iterationKind !== 'fork') {
    specAdditions.push({ requestedChange: parent.requestedChange, parentRunId: parent.parentRunId || null });
  }
  const requestedChange = String(iteration?.requestedChange || '').trim();
  if (requestedChange && iteration.kind !== 'fork') {
    specAdditions.push({ requestedChange, parentRunId: iteration.sources?.[0]?.runId || null });
  }
  const prompt = [originalPrompt, ...specAdditions.map((item, index) =>
    `## Spec addition ${index + 1}\n${item.requestedChange}`)].join('\n\n');
  return { ...game, originalPrompt, specAdditions, prompt };
}

export function improvementMessages({ meta = {}, manifest, instruction = '', validation }) {
  let remaining = 24000;
  // Game logic should reach the reviewer before large art and library files.
  const rank = file => /(^|\/)(vendor|lib|libraries|node_modules)\//i.test(file.path) ? 3
    : /\.(js|mjs|ts|py|c|cpp|rs|html?)$/i.test(file.path) ? 0
      : /\.(json|md|css)$/i.test(file.path) ? 1 : 2;
  const files = [...manifest.files].sort((a, b) => rank(a) - rank(b)).slice(0, 200).map(file => {
    const excerpt = typeof file.text === 'string' ? file.text.slice(0, Math.min(4000, remaining)) : '';
    remaining -= excerpt.length;
    return { path: file.path, size: file.size, excerpt, truncated: excerpt.length < (file.size || 0) };
  });
  return [
    { role: 'system', content: `Review this existing multi-file game and suggest 4–6 concrete improvements as a numbered list.
Ground ideas in the supplied spec, source excerpts, and validation evidence. Name relevant files and observable acceptance checks.
Preserve working gameplay and the original intent. Treat improvements as additions to the spec, never a replacement brief.
Excerpts are incomplete; distinguish possible issues from verified failures. Do not claim to have played the game.
The user's existing instructions are retained separately: suggest complementary ideas, not duplicates.
This is a review only. Do not use tools, inspect the workspace, execute code, or write files. Return only the suggestions.` },
    { role: 'user', content: JSON.stringify({
      title: meta.gameTitle || meta.title,
      spec: revisionBrief({ prompt: meta.prompt || '' }, { sources: [{ meta }] }).prompt,
      watchFor: meta.watchFor || '',
      existingInstructions: instruction,
      validation: validation ? { status: validation.status, issues: validation.issues } : null,
      project: { fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, files },
    }) },
  ];
}

export async function suggestImprovements({ source, instruction, validation, backend, agentId, agentModel,
  providerId, modelId, signal, onChunk, stream, readManifest = projectManifest }) {
  const selectedProvider = backend === 'agent' ? `cli-agent:${agentId}` : providerId;
  const selectedModel = backend === 'agent' ? agentModel || '__cli_default__' : modelId;
  if (!selectedProvider || !selectedModel || (backend === 'agent' && !agentId)) {
    throw new Error('Select a model or CLI agent in the toolbar first.');
  }
  if (!source?.projectHandle) throw new Error('The saved project is unavailable. Reopen the run and try again.');
  const manifest = await readManifest(source.projectHandle, { includeText: true, sourceLimit: 128 * 1024 });
  if (signal?.aborted) throw new DOMException('Suggestions cancelled', 'AbortError');
  const generate = stream || (await import('../../shared/services/model-providers.js')).streamChatCompletion;
  const result = await generate({
    providerId: selectedProvider, modelId: selectedModel,
    messages: improvementMessages({ meta: source.meta, manifest, instruction, validation }),
    appTitle: 'Game Forge V2 Improvement Review', params: { max_tokens: 2000 }, signal, onChunk,
  });
  if (signal?.aborted) throw new DOMException('Suggestions cancelled', 'AbortError');
  if (!String(result || '').trim()) throw new Error('The model returned no suggestions. Try again or enter your own changes.');
  return result.trim();
}

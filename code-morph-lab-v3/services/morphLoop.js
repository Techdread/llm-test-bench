// Morph loop controller — pure orchestration, no UI.
// The caller supplies a `completion` function; in Phase 2 we pass a stub,
// in Phase 3 we replace it with a real shared/model-providers call.

import { getToolDefinitions, executeTool } from './toolRegistry.js';
import { classifyError, buildErrorSummary } from './errorClassifier.js';
import { computeDiff } from './workspaceStore.js';

/**
 * @param {Object} params
 * @param {string} params.goal
 * @param {'html'|'python'} params.language
 * @param {Object} params.workspace - createWorkspace() instance
 * @param {Object} [params.startingFiles] - name→content to seed the workspace
 * @param {number} params.maxIterations
 * @param {Function} params.completion - async ({messages, tools}) => response (OpenAI shape)
 * @param {Function} params.runner - async (entry, allFiles) => runResult
 * @param {AbortSignal} [params.abortSignal]
 * @param {Function} [params.onIterationStart]
 * @param {Function} [params.onIterationEnd]
 * @param {Function} [params.onToolCall]
 * @param {Function} [params.onModelStream]
 * @param {Function} [params.onWorkspaceUpdate]
 * @returns {Promise<{iterations, finalSuccess, totalDuration}>}
 */
export async function runMorphLoop({
  goal, language, workspace, startingFiles,
  maxIterations, completion, runner,
  abortSignal, onIterationStart, onIterationEnd, onToolCall, onModelStream, onWorkspaceUpdate,
}) {
  // Seed starting files (from fork or code arrival).
  if (startingFiles) workspace.loadFromObject(startingFiles);

  const tools = getToolDefinitions();
  const systemPrompt = buildSystemPrompt(language);
  const iterations = [];
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildInitialUserMessage(goal, workspace) },
  ];

  for (let i = 1; i <= maxIterations; i++) {
    if (abortSignal?.aborted) break;

    const before = workspace.snapshot();
    onIterationStart?.(i);

    const iteration = {
      number: i,
      toolCalls: [],
      filesChanged: [],
      runResult: null,
      errorInfo: null,
      success: false,
      duration: 0,
      modelText: '',
    };
    const startTime = performance.now();

    try {
      let keepGoing = true;
      let innerRounds = 0;
      const MAX_INNER_ROUNDS = 25;
      while (keepGoing) {
        if (abortSignal?.aborted) break;
        if (++innerRounds > MAX_INNER_ROUNDS) break;

        const response = await completion({
          messages,
          tools,
          onChunk: (text, info = {}) => {
            iteration.modelText = text || '';
            onModelStream?.({
              iteration: i,
              round: innerRounds,
              text: text || '',
              toolCalls: info.toolCalls || [],
              finishReason: info.finishReason || null,
            });
          },
        });
        const choice = response.choices?.[0];
        if (!choice) throw new Error('No response from model');
        const message = choice.message;
        messages.push(message);

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const tc of message.tool_calls) {
            if (abortSignal?.aborted) break;
            const fnName = tc.function.name;
            let fnArgs = {};
            try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}
            onToolCall?.({ name: fnName, args: fnArgs, id: tc.id });

            const result = await executeTool(fnName, fnArgs, workspace, runner);
            iteration.toolCalls.push({ id: tc.id, name: fnName, args: fnArgs, result: result.text });

            if ((fnName === 'write_file' || fnName === 'edit_file') && fnArgs.filename) {
              if (!iteration.filesChanged.includes(fnArgs.filename)) {
                iteration.filesChanged.push(fnArgs.filename);
              }
            }
            if (fnName === 'delete_file' && fnArgs.filename) {
              if (!iteration.filesChanged.includes(fnArgs.filename)) {
                iteration.filesChanged.push(fnArgs.filename);
              }
            }

            if (fnName === 'run_program' && result.rawResult) {
              iteration.runResult = { ...result.rawResult };
              iteration.errorInfo = classifyError(iteration.runResult, language);
              iteration.success = iteration.runResult.exitCode === 0 && !iteration.runResult.timedOut;
            }

            if (fnName === 'write_file' || fnName === 'edit_file' || fnName === 'delete_file') {
              onWorkspaceUpdate?.(workspace.snapshot(), {
                iteration: i,
                toolCall: { id: tc.id, name: fnName, args: fnArgs },
              });
            }

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result.text,
            });
          }
          keepGoing = !abortSignal?.aborted;
        } else {
          iteration.modelText = message.content || '';
          keepGoing = false;
        }

        if (choice.finish_reason === 'stop' && !(message.tool_calls?.length > 0)) {
          keepGoing = false;
        }
      }
    } catch (e) {
      if (!abortSignal?.aborted) {
        iteration.runResult = {
          exitCode: 1,
          stdout: '',
          stderr: e.message || String(e),
          duration: 0,
          timedOut: false,
        };
        iteration.errorInfo = { kind: 'unknown', label: 'API Error', color: '#ef4444', location: null };
      }
    }

    iteration.duration = Math.round(performance.now() - startTime);

    // Compute diffs from before→after
    const after = workspace.snapshot();
    iteration.diffs = {};
    for (const name of iteration.filesChanged) {
      iteration.diffs[name] = computeDiff(before.get(name) || '', after.get(name) || '');
    }
    for (const [name] of after) {
      if (!before.has(name) && !iteration.filesChanged.includes(name)) {
        iteration.filesChanged.push(name);
        iteration.diffs[name] = computeDiff('', after.get(name));
      }
    }

    iterations.push(iteration);
    await onIterationEnd?.(iteration, after);

    if (iteration.success) break;

    // Push feedback so the next iteration has context about what happened.
    if (!iteration.success) {
      messages.push({ role: 'user', content: buildIterationFeedback(iteration) });
    }
  }

  return {
    iterations,
    finalSuccess: iterations.length > 0 && iterations[iterations.length - 1].success,
    totalDuration: iterations.reduce((s, it) => s + it.duration, 0),
  };
}

function buildSystemPrompt(language) {
  if (language === 'python') return buildPythonSystemPrompt();
  return buildHtmlSystemPrompt();
}

function buildHtmlSystemPrompt() {
  return `You are a code repair and generation assistant in Code Morph Lab.

You are working with HTML (plus inline CSS and JavaScript).

Your workflow:
1. Use list_files and read_file to understand the current workspace state.
2. Use write_file to create a new file, or edit_file for targeted changes to an existing file.
3. Call run_program to execute your code and verify it works.
4. Read the run result. If there are errors, analyze them and try to fix them.
5. Repeat until the program works correctly or you have addressed the user's goal.

Rules:
- Only modify files within the workspace.
- Prefer single-file HTML documents with inline <style> and <script>.
- Do not add CDN dependencies. Keep HTML self-contained, or use pinned shared/lib paths for known browser libraries.
- Every HTML file should be a complete document with <!DOCTYPE html>, <html>, <head>, <body>.
- After every write_file or edit_file, call run_program to verify.
- Prefer edit_file over write_file for targeted changes — it's cheaper and less risky than full rewrites.
- Use write_file only for creating new files or for fully replacing small files.
- The run result captures console errors, warnings, and uncaught exceptions from the rendered page. A successful run has exit 0 and no errors.
- The rendered page is shown as a live preview to the user — make it visible, not just console output.
- If you encounter an error you cannot fix after examining the code, explain why and stop. Do not loop in circles.
- Keep your responses focused — avoid unnecessary explanation in tool calls.`;
}

function buildPythonSystemPrompt() {
  return `You are a code repair and generation assistant in Code Morph Lab.

You are working with Python (standard library only).

Your workflow:
1. Use list_files and read_file to understand the current workspace state.
2. Use write_file to create a new file, or edit_file for targeted changes to an existing file.
3. Call run_program to execute your code and verify it works.
4. Read the run result. If there are errors, analyze the traceback and try to fix them.
5. Repeat until the program works correctly or you have addressed the user's goal.

Rules:
- Only modify files within the workspace.
- Standard library only. No pip install. No third-party packages.
- Prefer single-file scripts.
- print() is fine; sys.stderr is fine.
- Every write_file or edit_file should be followed by run_program.
- Prefer edit_file over write_file for targeted changes.
- If run_program returns a traceback, the File "..." line is the exact file and line to fix.
- Python morphs have no visual preview — stdout is the user's feedback channel, so print useful output.
- If you encounter an error you cannot fix, explain why and stop.
- Keep your responses focused.`;
}

function buildInitialUserMessage(goal, workspace) {
  const files = workspace.listFiles();
  if (files.length === 0) {
    return `Goal: ${goal}\n\nThe workspace is currently empty. Use write_file to scaffold the initial file(s), then run_program to verify.`;
  }
  return `Goal: ${goal}\n\nThe workspace already contains: ${files.join(', ')}\nRead the files first to understand what exists, then proceed.`;
}

function buildIterationFeedback(iteration) {
  const parts = [`Iteration ${iteration.number} result:`];
  if (iteration.filesChanged.length > 0) {
    parts.push(`Files changed: ${iteration.filesChanged.join(', ')}`);
  }
  parts.push(buildErrorSummary(iteration.runResult, iteration.errorInfo));
  parts.push('\nPlease try again to fix the issues and achieve the goal.');
  return parts.join('\n');
}

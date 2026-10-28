// The agentic build loop shared by the Forge family — drives the selected model
// through the file tools until it reports done (or the turn budget is hit).
// Mirrors tool-calling-lab's chatService, with per-run telemetry.
//
// The domain lives in the caller's adapter, which supplies `systemPrompt`,
// `capabilities` and the app's identity. The game prompts below are the
// historical default for a caller that supplies none.

import { getOpenAIToolsArray, normalizeToolArgs, runTool } from './agentTools.js';
import { createBudgetLedger, normalizeBudgets } from './budgets.js';

// Keep this service importable under node:test. The shared provider facade has
// browser settings side effects, so load it only when an actual completion is
// about to start.
async function modelCompletion(params) {
  const { streamChatCompletion } = await import('../../services/model-providers.js');
  return streamChatCompletion(params);
}

export const WEB_SYSTEM_PROMPT = `You are an expert game engineer building a COMPLETE, PLAYABLE game as a multi-file web project inside a sandbox directory. You author the project entirely through tool calls.

RULES
- The entry point MUST be a file named "index.html" at the project root. Split logic into multiple files (e.g. index.html, styles.css, src/*.js) — do not cram everything into one file; multi-file structure is the point.
- The game must be fully SELF-CONTAINED and run from a static file open: vanilla HTML/CSS/JS, Canvas 2D or WebGL. Do NOT reference any external URL, CDN, or network resource. If you need a library, write it yourself or inline it.
- Prefer classic <script src="..."> includes over ES module imports for game scripts, so the project runs when opened directly.
- Generate any art procedurally (draw with canvas / shapes / simple sprite data) — you cannot fetch image or audio files.
- Make it actually playable: real controls, win/lose states, and the specific mechanics named in the task. Address every point in the task's "watch for" note.
- Write a short README.md describing controls and how to run it.
- Write a root forge-project.json manifest with schemaVersion:1, kind:"game", entry:"index.html", runtime:"static-web", build:null, run:null, an assets array, and a declaredControls array. Keep it accurate when files change.

EFFICIENCY (important)
- Use only tools offered in the request. A fresh build is empty: write the planned files directly instead of listing or reading them first.
- Write each file ONCE. The full text of files you already wrote is NOT echoed back to you in the conversation. Use read_file only when you genuinely need to inspect a file; it is not a required finishing step.
- For a change to an existing file, use edit_file (a targeted replacement), NOT write_file. The host rejects write_file when the path already exists.
- Never write the same file twice with identical content — that makes no progress and wastes the build.
- Tool acknowledgements and compact history summaries are status text, never source code. Never copy them into a file's content.
- Prefer one complete file-writing tool call per turn, then move to the next file.
- The moment index.html and all its files are written and the game is complete, call report_done. Do not keep re-writing files "to be safe".

WORKFLOW
1. Briefly plan the file layout.
2. Use write_file to author each file once; use read_file / list_files only when needed; edit_file for fixes.
3. Call report_done with a summary and the controls as soon as the game is complete.

Keep going autonomously until the game is finished. Do not ask the user questions.`;

// Injected as a user turn when the loop detects the model is spinning (repeating
// identical/redundant tool calls without making progress).
const STUCK_NUDGE = `You appear to be stuck: your recent turns repeated failed or redundant file calls, making no progress. Stop repeating yourself. If the game is complete, call report_done NOW with a short summary and the controls. If one specific file is wrong, use edit_file to fix only what is broken — do NOT call write_file for a path that already exists.`;

const TOOL_REQUIRED_NUDGE = missing => `You replied without using a tool, but the project is not complete. Missing evidence: ${missing.join(', ')}. Continue now with ONE concrete tool call. Write the next missing file, or call report_done only after every required project file exists.`;

const TOOL_ERROR_NUDGE = `One or more tool calls failed. Read the tool error already returned to you, correct only that call's arguments, and retry it once. Do not rewrite unrelated files.`;

// Back-compat alias.
export const GAME_SYSTEM_PROMPT = WEB_SYSTEM_PROMPT;

const nativeSystemPrompt = (lang) => `You are an expert game engineer building a COMPLETE, PLAYABLE game as a multi-file ${lang} project inside a sandbox directory. You author the project entirely through tool calls.

RULES
- Structure the project across multiple files in a way idiomatic for ${lang}, INCLUDING a build manifest so a reviewer can build it (e.g. Makefile/CMakeLists.txt for C/C++, Cargo.toml for Rust, go.mod for Go, a main module for Python). Multi-file structure is the point.
- Fully SELF-CONTAINED and buildable OFFLINE with the standard toolchain: standard library only — no third-party packages, no network or asset downloads. If you need a helper, write it yourself.
- Generate all art/data procedurally in code.
- Implement the actual mechanics named in the task and address every point in its "watch for" note. Include a real game loop and keyboard INPUT handling appropriate to ${lang} (e.g. terminal raw mode / curses, or a framebuffer/PPM renderer if there is no GUI).
- Write a README.md with the exact BUILD and RUN commands.
- Write a root forge-project.json manifest with schemaVersion:1, kind:"game", the real entry file, runtime:"native", the documented build/run commands, an assets array, and declaredControls.

EFFICIENCY (important)
- Write each file ONCE. The text of files you already wrote is NOT echoed back — call read_file to review one instead of re-emitting it. Use edit_file for changes; the host rejects write_file when its path already exists. As soon as the project is complete, call report_done — do not keep re-writing files.

NOTE: this ${lang} build is ARCHIVED for review right now — a human reviewer reads and builds it; it is not yet run live in the browser. So the code must be correct, complete, and actually compile/run with the commands you document.

WORKFLOW
1. Briefly plan the file layout. 2. write_file / edit_file / read_file / list_files to build it. 3. Re-read your entry and build files to sanity-check. 4. Call report_done with a summary plus the exact build & run commands.

Keep going autonomously until the game is finished. Do not ask the user questions.`;

const STACK_LANG = { c: 'C', cpp: 'C++', 'c++': 'C++', rust: 'Rust', go: 'Go', python: 'Python', py: 'Python', java: 'Java', zig: 'Zig' };

// Appended when the user enables AI image assets — overrides the "procedural art
// only" rule and tells the model how to use generate_image well.
const IMAGE_ASSETS_ADDENDUM = `

IMAGE ASSETS (enabled)
- You MAY create real art with the generate_image tool: it renders a sprite / background / tile / title graphic and saves it into the project as a PNG/JPG that you then reference by RELATIVE path (e.g. <img src="assets/player.png"> or drawImage after loading it). This is a local project file, not an external URL — that is allowed.
- Each generation takes several seconds, so generate only a FEW key assets (e.g. the player, one enemy, a background). Draw incidental/UI art procedurally.
- For a sprite or object that sits on top of the game, pass kind:"sprite" (or transparent:true): it is rendered on a flat magenta (#ff00ff) field — colour-key that magenta to transparent when you blit it (skip pixels where r>200 && g<80 && b>200), so it composites cleanly.
- Load every generated image before the game loop starts and wait for onload; account for the extra load time in your start sequence.`;

export function systemPromptForStack(stack, { imageAssets = false } = {}) {
  const s = String(stack || 'web').toLowerCase();
  const base = (s === 'web' || s === '') ? WEB_SYSTEM_PROMPT : nativeSystemPrompt(STACK_LANG[s] || s.toUpperCase());
  return imageAssets ? base + IMAGE_ASSETS_ADDENDUM : base;
}

/** The user-turn task string for a library game (shared by interactive + batch builds). */
export function buildTask(game) {
  return `${game.prompt}\n\n[Acceptance / watch for] ${game.watchFor || 'Make it genuinely playable.'}\n\nBuild it now as a multi-file project. Follow the target stack described in your instructions.`;
}

/**
 * @returns {Promise<{ steps, telemetry, doneSummary }>}
 */
export async function runBuild({
  task, providerId, modelId, directoryHandle,
  maxTurns = 40, stack = 'web', systemPrompt,
  nudgeAfter = 2, stopAfter = 4, imageAssets = false,
  capabilities = null, capabilityPolicies = {},
  budgets = {}, onStep, onBudget, onAudit, abortSignal,
  // Pause/resume (same contract as prompt-gallery's batch runner): the loop never
  // interrupts work in flight — it asks `shouldPause()` at safe boundaries only
  // (between turns, and between the tool calls of one turn) and, when the answer
  // is yes, parks on `waitIfPaused(context)` until the caller resolves it.
  shouldPause = null, waitIfPaused = null,
  // App identity. Defaults are Game Forge V2's, so the historical callers that
  // pass neither keep the exact provider attribution and wording they had.
  appId = 'game-forge-v2', appTitle = 'Game Forge V2',
  // Injected so this module stays domain-free: `previewInspector` backs the
  // preview_app tool, `projectRunner` backs run_project for a native Forge,
  // and `completionEvidence` decides when a project is finished.
  previewInspector = null, projectRunner = null, completionEvidence = inspectProjectCompletion,
  completion = modelCompletion,
  // Limit-aware continuation (spec 343). All three are off unless supplied, so
  // existing callers are unchanged.
  // - `resume` { messages, turn } continues a build from a checkpoint: the
  //   history is restored and turn numbering carries on from `turn`.
  // - `onCheckpoint({ turn, messages, at })` is awaited at the start of every
  //   turn after the first, i.e. between turns, with the compacted history the
  //   next request would send. A limit hit inside a turn resumes from the
  //   checkpoint taken just before it, so that turn is simply retried.
  // - `verifyResponse(response)` runs on each model response BEFORE its tool
  //   calls execute; throwing stops the build there, so a substitute model
  //   that answered in place of the requested one never writes a file.
  resume = null, onCheckpoint = null, verifyResponse = null,
  telemetryMeta = null,
}) {
  budgets = normalizeBudgets({ ...budgets, maxTurns });
  maxTurns = budgets.maxTurns;
  systemPrompt = systemPrompt || systemPromptForStack(stack, { imageAssets });
  const allowedCapabilities = capabilities
    ? [...new Set(capabilities)]
    : null; // Legacy direct callers retain the historical complete tool set.
  const tools = getOpenAIToolsArray({ imageGen: imageAssets, capabilities: allowedCapabilities });
  const messages = resume?.messages?.length
    ? clone(resume.messages)
    : [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];
  const startTurn = Math.max(0, Number(resume?.turn) || 0);
  const steps = [];
  const capabilityAudit = [];
  const telemetry = {
    turns: 0, toolCalls: 0, failedCalls: 0, filesWritten: 0, edits: 0, bytesWritten: 0,
    redundantWrites: 0, promptTokens: 0, completionTokens: 0,
    startedAt: Date.now(), finishedAt: null, stopReason: null,
  };
  let doneSummary = null;

  // Paused time is held out of the elapsed figure the trace reports: a run the
  // user parked for ten minutes did not spend ten minutes generating.
  telemetry.pausedMs = 0;
  const pauseGate = async (context) => {
    if (abortSignal?.aborted) return;
    let requested = false;
    try { requested = !!shouldPause?.(); } catch { requested = false; }
    if (!requested || !waitIfPaused) return;
    const parkedAt = Date.now();
    await waitIfPaused(context);
    telemetry.pausedMs += Date.now() - parkedAt;
    if (abortSignal?.aborted) throw new Error('Run cancelled');
  };

  const budget = createBudgetLedger(budgets);
  const initialCompletion = await completionEvidence(directoryHandle, stack);
  const inferFreshCompletion = !initialCompletion.complete;
  onBudget?.(budget.snapshot());

  // ── Progress / stuck tracking (see createProgressTracker) ──
  const tracker = createProgressTracker({ nudgeAfter, stopAfter });
  let stopReason = null, lastAction = null;
  let noToolStreak = 0;

  for (let turn = startTurn; turn < maxTurns; turn++) {
    if (abortSignal?.aborted) throw new Error('Run cancelled');
    if (onCheckpoint && turn > startTurn) {
      try {
        await onCheckpoint({ turn, messages: compactToolHistory(messages), at: new Date().toISOString() });
      } catch (error) { console.warn('[buildLoop] checkpoint failed', error); }
    }
    await pauseGate({ phase: 'before-turn', turn: turn + 1 });

    // Snapshot the exact request going on the wire and surface it as a *pending*
    // step BEFORE the model call. If chatCompletion throws (e.g. a local model's
    // context-overflow 400), the failing request stays visible in the trace/inspector.
    const wireMessages = compactToolHistory(messages);
    const request = {
      providerId, modelId, model: modelId,
      tools: tools.map(t => t.function?.name),
      messages: clone(wireMessages),
    };
    onStep?.({
      turn: turn + 1, type: 'assistant', content: null, toolCalls: null,
      toolResults: null, request, response: null, pending: true,
      timestamp: new Date().toISOString(),
    });

    // idleTimeoutSeconds 0 = no timeout at all: a slow local model can spend many
    // minutes on prompt processing before its first token, and the only honest
    // bound then is the user's hard-stop button. `timeouts` carries the same
    // policy into the provider adapter so its own watchdog cannot undercut it.
    const noIdleTimeout = !budgets.idleTimeoutSeconds;
    const responseController = new AbortController();
    let idleTimer = null;
    const resetIdle = () => {
      if (noIdleTimeout) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => responseController.abort(
        new DOMException(`No model output for ${budgets.idleTimeoutSeconds}s`, 'TimeoutError')
      ), budgets.idleTimeoutSeconds * 1000);
    };
    const abortParent = () => responseController.abort(abortSignal?.reason);
    abortSignal?.addEventListener('abort', abortParent, { once: true });
    resetIdle();
    let response;
    try {
      response = await completion({
        providerId, modelId, messages: wireMessages, tools, toolChoice: 'required', appTitle,
        returnResponse: true, signal: responseController.signal,
        timeouts: { streamMs: budgets.idleTimeoutSeconds * 1000, generationMs: budgets.idleTimeoutSeconds * 1000 },
        onChunk: resetIdle,
        ...(telemetryMeta ? { telemetryMeta } : {}),
      });
    } finally {
      clearTimeout(idleTimer);
      abortSignal?.removeEventListener('abort', abortParent);
    }
    if (verifyResponse) await verifyResponse(response, { turn: turn + 1 });
    const choice = response.choices?.[0];
    if (!choice) throw new Error('No response from model');

    telemetry.turns = turn + 1;
    telemetry.promptTokens += response.usage?.prompt_tokens || 0;
    telemetry.completionTokens += response.usage?.completion_tokens || 0;
    const tokenDecision = budget.recordTokens(
      response.usage?.prompt_tokens || 0,
      response.usage?.completion_tokens || 0,
      response.usage?.cost ?? response.usage?.cost_usd ?? null,
    );
    onBudget?.(budget.snapshot());

    const assistant = choice.message;
    messages.push(assistant);

    const step = {
      turn: turn + 1, type: 'assistant', content: assistant.content || null,
      toolCalls: null, toolResults: null,
      request,
      response: clone(response), // clone: the stub pass below mutates assistant.tool_calls in place
      finishReason: choice.finish_reason || null,
      usage: response.usage || null,
      timestamp: new Date().toISOString(),
    };
    if (!tokenDecision.ok) {
      step.note = `Budget stopped: ${tokenDecision.reason}`;
      steps.push(step);
      onStep?.(step);
      stopReason = 'budget';
      break;
    }

    const calls = assistant.tool_calls || [];
    if (calls.length) {
      step.toolCalls = calls.map(tc => {
        const p = parseArgs(tc.function.arguments);
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: normalizeToolArgs(tc.function.name, p.value),
          argsRaw: p.raw,
          parseError: p.error,
        };
      });
      step.toolResults = [];
      noToolStreak = 0;
      onStep?.(step); // show the tool calls immediately; results stream in below
      for (const tc of step.toolCalls) {
        if (abortSignal?.aborted) throw new Error('Run cancelled');
        // A boundary between two tool calls is safe: nothing is in flight and the
        // model's next turn has not been requested, so a pause here is honoured
        // without waiting for the whole turn to drain.
        await pauseGate({ phase: 'before-tool', turn: turn + 1, tool: tc.name });
        telemetry.toolCalls++;
        if (tc.name === 'report_done') doneSummary = tc.arguments.summary || 'done';

        // Long-running tools (generate_image) report progress into the trace.
        if (tc.name === 'generate_image') { step.status = `Generating ${tc.arguments.path || 'image'}…`; onStep?.(step); }
        const ctx = {
          signal: abortSignal,
          appId,
          budget,
          previewInspector,
          projectRunner,
          rejectWriteOverwrite: true,
          allowedCapabilities,
          capabilityPolicies,
          onAudit: record => {
            capabilityAudit.push(record);
            onAudit?.(record);
          },
          onProgress: (p) => {
            if (tc.name !== 'generate_image') return;
            const pct = Math.round(p?.percent || 0);
            step.status = `Generating ${tc.arguments.path || 'image'}… ${pct}%`;
            onStep?.(step);
          },
        };
        const exec = await runTool(tc.name, tc.arguments, directoryHandle, ctx);
        step.status = null;
        if (exec.error) telemetry.failedCalls++;
        if (!exec.error && tc.name === 'write_file') {
          telemetry.filesWritten++;
          telemetry.bytesWritten += (tc.arguments.content || '').length;
        }
        if (!exec.error && tc.name === 'edit_file') telemetry.edits++;
        if (tc.name === 'generate_image' && !exec.error) telemetry.imagesGenerated = (telemetry.imagesGenerated || 0) + 1;
        const result = { toolName: tc.name, ...exec };
        step.toolResults.push(result);
        onStep?.(step); // stream this result into the trace
        messages.push({
          role: 'tool', tool_call_id: tc.id,
          content: result.error || (typeof result.result === 'string' ? result.result : JSON.stringify(result.result)),
        });
        onBudget?.(budget.snapshot());
        if (!budget.decision.allowed) {
          step.note = `Budget stopped: ${budget.decision.reason}`;
          stopReason = 'budget';
          break;
        }
      }

      // ── Progress / stuck check for this turn ──
      const pr = tracker.assess(step.toolCalls, step.toolResults);
      telemetry.redundantWrites += pr.redundant;
      step.redundant = pr.redundant;
      step.unproductive = pr.unproductive;
      step.stuckStreak = pr.stuckStreak;
      lastAction = pr.action;
    }

    steps.push(step);
    onStep?.(step);

    if (doneSummary !== null) {
      const evidence = await completionEvidence(directoryHandle, stack);
      if (evidence.complete) { stopReason = 'done'; break; }
      doneSummary = null;
      step.note = `Ignored premature report_done — missing ${evidence.missing.join(', ')}.`;
      messages.push({ role: 'user', content: TOOL_REQUIRED_NUDGE(evidence.missing) });
      onStep?.(step);
      continue;
    }
    if (inferFreshCompletion && step.toolCalls?.some(call => ['write_file', 'edit_file', 'generate_image'].includes(call.name))) {
      const evidence = await completionEvidence(directoryHandle, stack);
      if (evidence.complete) {
        doneSummary = `${appTitle} verified the complete multi-file project on disk.`;
        stopReason = 'done';
        step.note = `All required multi-file project evidence now exists; ${appTitle} completed the fresh build without another model turn.`;
        onStep?.(step);
        break;
      }
    }
    if (stopReason === 'budget') break;
    if (!calls.length) {
      const evidence = await completionEvidence(directoryHandle, stack);
      if (evidence.complete) {
        doneSummary = String(assistant.content || '').trim() || `Project files completed; ${appTitle} inferred completion.`;
        stopReason = 'done';
        step.note = `All required multi-file project evidence exists; ${appTitle} accepted completion without report_done.`;
        onStep?.(step);
        break;
      }
      noToolStreak++;
      if (noToolStreak <= 2) {
        messages.push({ role: 'user', content: TOOL_REQUIRED_NUDGE(evidence.missing) });
        step.note = `No tool call received — requested concrete progress (${noToolStreak}/2).`;
        onStep?.(step);
        continue;
      }
      stopReason = 'no_tool_calls';
      break;
    }

    if (step.toolCalls.some(call => call.parseError)
      || step.toolResults.some(result => result.error)) {
      messages.push({ role: 'user', content: TOOL_ERROR_NUDGE });
      step.note = 'A tool call failed — asked the model to correct only the failed call.';
      onStep?.(step);
    }

    // Loop/stuck handling: nudge the model once, then abort the run rather than
    // burning the whole turn budget re-writing the same files (turns are a safety
    // cap, not the real limiter).
    if (lastAction === 'stop') {
      stopReason = 'stuck';
      step.note = `Stopped: no real progress for ${step.stuckStreak} consecutive turns — the model was repeating tool calls (${telemetry.redundantWrites} identical rewrites total).`;
      onStep?.(step);
      break;
    }
    if (lastAction === 'nudge') {
      messages.push({ role: 'user', content: STUCK_NUDGE });
      step.note = 'Loop detected — nudged the model to finish or make a real change.';
      onStep?.(step);
    }
  }

  telemetry.finishedAt = Date.now();
  telemetry.wallMs = telemetry.finishedAt - telemetry.startedAt;
  telemetry.elapsedMs = Math.max(0, telemetry.wallMs - telemetry.pausedMs);
  telemetry.stopReason = stopReason = stopReason || 'max_turns';
  const budgetSnapshot = budget.snapshot();
  budgetSnapshot.remaining.turns = Math.max(0, budgets.maxTurns - telemetry.turns);
  telemetry.budget = budgetSnapshot;
  return {
    steps, telemetry, doneSummary, messages, stopReason, budget: budgetSnapshot,
    capabilities: allowedCapabilities,
    capabilityPolicies,
    capabilityAudit,
  };
}

/**
 * Keep the newest tool turn verbatim so the model can use a just-written or
 * just-read file on its next turn. Older tool turns become plain summaries.
 *
 * Previously Game Forge replaced write_file.content inside an assistant tool
 * call with text such as "«1.2 KB written…»". Local models copied that marker
 * into their next write, corrupting the project. Summarising the complete old
 * assistant+tool exchange preserves valid chat structure and never presents a
 * placeholder as file content.
 */
export function compactToolHistory(messages = []) {
  const toolTurns = messages
    .map((message, index) => message?.role === 'assistant' && message.tool_calls?.length ? index : -1)
    .filter(index => index >= 0);
  const newestToolTurn = toolTurns.at(-1);
  const out = [];
  let openToolIds = new Set();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (index !== newestToolTurn && message?.role === 'assistant' && message.tool_calls?.length) {
      const resultById = new Map();
      let cursor = index + 1;
      while (messages[cursor]?.role === 'tool') {
        resultById.set(messages[cursor].tool_call_id, String(messages[cursor].content || ''));
        cursor++;
      }
      const lines = message.tool_calls.map(call => {
        const parsed = parseArgs(call.function?.arguments).value;
        const name = call.function?.name || 'unknown_tool';
        const target = parsed.path ? ` ${parsed.path}` : '';
        const result = resultById.get(call.id) || '';
        const outcome = /error|failed|validation failed|execution error/i.test(result) ? 'failed' : 'completed';
        return `- ${name}${target}: ${outcome}`;
      });
      out.push({
        role: 'assistant',
        content: `Earlier tool turn completed; file contents are on disk and are not repeated here.\n${lines.join('\n')}`,
      });
      openToolIds = new Set();
      index = cursor - 1;
      continue;
    }
    // A tool result can only legally follow its assistant tool-call message. If
    // malformed history contains an orphan, omit it rather than sending an
    // invalid OpenAI conversation to a strict local server.
    if (message?.role === 'tool') {
      if (!openToolIds.has(message.tool_call_id)) continue;
      out.push(clone(message));
      continue;
    }
    openToolIds = new Set(message?.role === 'assistant'
      ? (message.tool_calls || []).map(call => call.id)
      : []);
    out.push(clone(message));
  }
  return out;
}

async function projectPaths(directoryHandle) {
  const paths = [];
  async function walk(directory, prefix = '') {
    for await (const [name, handle] of directory.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle, path);
      else paths.push(path);
    }
  }
  try { await walk(directoryHandle); } catch { /* incomplete project */ }
  return paths;
}

async function readProjectFile(directoryHandle, path) {
  try {
    const parts = String(path || '').split('/').filter(Boolean);
    let directory = directoryHandle;
    for (let index = 0; index < parts.length - 1; index++) {
      directory = await directory.getDirectoryHandle(parts[index]);
    }
    const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
    return await file.text();
  } catch { return null; }
}

/** Host-side completion evidence means report_done is helpful, not fragile. */
export async function inspectProjectCompletion(directoryHandle, stack = 'web') {
  const paths = await projectPaths(directoryHandle);
  const files = new Set(paths);
  const missing = [];
  if (!files.has('README.md')) missing.push('README.md');
  if (!files.has('forge-project.json')) missing.push('forge-project.json');

  let manifest = null;
  const manifestText = await readProjectFile(directoryHandle, 'forge-project.json');
  if (manifestText) {
    try { manifest = JSON.parse(manifestText); }
    catch { missing.push('valid forge-project.json'); }
  }
  const entry = String(manifest?.entry || (String(stack).toLowerCase() === 'web' ? 'index.html' : '')).trim();
  if (!entry || !files.has(entry)) missing.push(entry ? `entry ${entry}` : 'manifest entry');
  const declaredAssets = Array.isArray(manifest?.assets)
    ? manifest.assets.map(asset => typeof asset === 'string'
      ? asset
      : asset?.path ?? asset?.src ?? asset?.file ?? asset?.href ?? '').map(String).filter(Boolean)
    : [];
  for (const asset of declaredAssets) {
    if (!files.has(asset)) missing.push(`manifest asset ${asset}`);
  }

  const web = String(stack || 'web').toLowerCase() === 'web';
  const supportingSources = [...files].filter(path => {
    if (['README.md', 'forge-project.json', entry].includes(path) || path.startsWith('lib/')) return false;
    return web ? /\.(?:css|js|mjs)$/i.test(path) : true;
  });
  if (supportingSources.length === 0) missing.push('at least one separate source/style file');
  return { complete: missing.length === 0, missing, entry: entry || null, files: [...files].sort() };
}

// Cheap, stable string hash (djb2) for detecting identical file rewrites.
function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }

/**
 * Detects when a build model is spinning instead of making progress. Pure and
 * stateful-per-instance so it can be unit-tested independently of the model loop.
 *
 * Per turn, `assess(toolCalls, toolResults)` classifies the turn:
 *  - progress   = created a new file, changed a file's content, a successful edit, or report_done
 *  - inspection = a NEW read_file/list_files (legitimate work; not spinning)
 *  - redundant  = write_file of content identical to what's already on disk
 *  - churn      = one path rewritten an implausible number of times (even if content
 *                 differs) with no report_done — the differing-content loop backstop
 * A turn with tool calls but no progress and no new inspection (or that trips churn)
 * is "unproductive"; consecutive unproductive turns raise `stuckStreak`. At
 * `nudgeAfter` it returns action 'nudge' (once); at `stopAfter`, action 'stop'.
 *
 * @returns {{ assess: (calls:Array, results:Array) => { redundant:number, unproductive:boolean, stuckStreak:number, action:('nudge'|'stop'|null) } }}
 */
export function createProgressTracker({ nudgeAfter = 2, stopAfter = 4, churnAfter = stopAfter + 2 } = {}) {
  const fileHashes = new Map();   // path -> content hash (model's on-disk view)
  const seenInspect = new Set();  // read/list signatures already seen
  const pathWrites = new Map();   // path -> times written
  let stuckStreak = 0, nudged = false;

  return {
    assess(toolCalls = [], toolResults = []) {
      let progressed = false, newInspection = false, redundant = 0;
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const res = toolResults[i];
        const args = tc.arguments || {};
        if (tc.name === 'report_done') { progressed = true; continue; }
        if (tc.name === 'write_file') {
          const h = strHash(args.content || '');
          if (!res?.error) pathWrites.set(args.path, (pathWrites.get(args.path) || 0) + 1);
          if (!res?.error && fileHashes.get(args.path) !== h) { fileHashes.set(args.path, h); progressed = true; }
          else redundant++;
        } else if (tc.name === 'edit_file') {
          if (!res?.error) { fileHashes.delete(args.path); progressed = true; }
        } else if (tc.name === 'read_file' || tc.name === 'list_files') {
          const sig = `${tc.name}:${args.path || ''}`;
          if (!seenInspect.has(sig)) { seenInspect.add(sig); newInspection = true; }
        }
      }
      // Backstop for the "keeps rewriting one file with slightly different content,
      // never finishes" loop: an absurd rewrite count on any single path.
      const churn = [...pathWrites.values()].some(n => n >= churnAfter);
      const unproductive = toolCalls.length > 0 && ((!progressed && !newInspection) || churn);
      stuckStreak = unproductive ? stuckStreak + 1 : 0;

      let action = null;
      if (stuckStreak >= stopAfter) action = 'stop';
      else if (stuckStreak >= nudgeAfter && !nudged) { nudged = true; action = 'nudge'; }
      return { redundant, unproductive, stuckStreak, action };
    },
  };
}

// Parse tool-call argument JSON, preserving the raw string and any parse error so
// the trace can show *what the model actually emitted* instead of silently
// collapsing malformed args to `{}` (a common local-model failure mode).
function parseArgs(s) {
  const raw = s ?? '';
  try { return { value: JSON.parse(raw || '{}'), raw, error: null }; }
  catch (firstError) {
    // Tolerate the two most common local-model wrappers without attempting a
    // permissive/eval-like parser: a fenced JSON object and trailing commas.
    const cleaned = String(raw)
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    try { return { value: JSON.parse(cleaned || '{}'), raw, error: null }; }
    catch { return { value: {}, raw, error: firstError.message }; }
  }
}

// Structured deep clone with a JSON fallback (request/response are plain data).
function clone(v) {
  try { return structuredClone(v); }
  catch { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } }
}

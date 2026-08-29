// Refine-tab LLM operations: heal a broken generation, suggest improvements,
// apply user-edited improvement instructions. All three are single
// full-document calls — deliberately lighter than code-morph-lab's agentic
// tool-calling loop.

import { streamChat } from '../../shared/services/model-providers.js';

const HEAL_SYSTEM = `You are an expert web developer fixing a broken single-page HTML document.
You will receive the original prompt the page was generated from, the current HTML, and the runtime errors captured when the page ran in a sandbox.

Rules:
- Fix ONLY what is needed to eliminate the errors. Do not redesign, restyle, or remove features.
- Preserve the document's structure, look, and behaviour everywhere the errors don't require changes.
- Respond with ONLY the complete corrected HTML document, starting with <!DOCTYPE html>.
- No markdown, no code fences, no explanations.`;

const SUGGEST_SYSTEM = `You are an expert web developer reviewing a single-page HTML generation against the prompt it was built from.
Suggest 4 to 6 concrete, high-value improvements. Favour: missing prompt requirements, gameplay/interaction depth, visual polish, and small features that make the page feel finished.

Rules:
- Output ONLY a numbered list, one improvement per line.
- Each line is a single imperative sentence (e.g. "3. Add a particle burst when a row is cleared.").
- Be specific to THIS page — no generic advice like "improve performance".
- No preamble, no closing remarks.`;

const APPLY_SYSTEM = `You are an expert web developer improving an existing single-page HTML document.
You will receive the original prompt, the current HTML, and a list of improvement instructions.

Rules:
- Implement the instructions faithfully. They may have been edited by the user — follow the list you are given, not your own ideas.
- Preserve all existing functionality and style except where the instructions say otherwise.
- Respond with ONLY the complete updated HTML document, starting with <!DOCTYPE html>.
- No markdown, no code fences, no explanations.`;

const AUDIT_SYSTEM = `You are a strict acceptance reviewer for a standalone single-page HTML document.
Evaluate only the supplied checklist against the complete HTML and the compact sandbox evidence. Do not invent new must-pass requirements. Runtime errors and timeouts are authoritative; never mark their host checks as passing.

Return JSON only with this shape:
{"schemaVersion":1,"checks":[{"id":"prompt-01","status":"pass|fail|unknown","evidence":"short concrete evidence"}],"repairTasks":["focused repair task"],"notes":"short summary"}

Rules:
- Include one row for every supplied checklist ID and no other IDs.
- Use pass only when the HTML or evidence supports it.
- Use unknown when generic evidence cannot establish a visual or interaction claim.
- Keep evidence under 500 characters per row and repairTasks to at most four.
- No markdown, code fences, score, overall verdict, or prose outside the JSON object.`;

const REPAIR_AUDIT_SYSTEM = `You are an expert web developer repairing a standalone single-page HTML document against a failed acceptance audit.

Rules:
- Return one complete HTML document beginning with <!DOCTYPE html>.
- Preserve working behaviour and visual identity.
- Change only what the failed or unknown must-checks require.
- Do not remove a feature merely to silence an error.
- Do not claim success in prose. Return HTML only, with no code fences.
- The standalone artefact must not reference repo-relative shared/lib paths.`;

function stripCodeFences(text) {
  let s = text || '';
  s = s.replace(/^\s*```(?:html)?\s*\n?/, '');
  s = s.replace(/\n?```\s*$/, '');
  return s;
}

function buildContext(prompt, htmlContent) {
  const parts = [];
  if (prompt?.trim()) {
    parts.push(`ORIGINAL PROMPT:\n${prompt.trim()}`);
  }
  parts.push(`CURRENT HTML:\n${htmlContent}`);
  return parts;
}

/**
 * Fix the captured runtime errors. Streams the corrected document.
 * onChunk receives the accumulated text so far (not deltas).
 */
export async function healHtml({ providerId, modelId, prompt, html, errors, onChunk, params }) {
  const parts = buildContext(prompt, html);
  parts.push(`RUNTIME ERRORS CAPTURED IN SANDBOX:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`);
  parts.push('Fix these errors and return the complete corrected HTML document.');

  let accumulated = '';
  const result = await streamChat({
    providerId,
    modelId,
    systemPrompt: HEAL_SYSTEM,
    userPrompt: parts.join('\n\n'),
    appTitle: 'Prompt Gallery',
    params,
    onChunk: (text) => {
      accumulated = text || '';
      onChunk?.(stripCodeFences(accumulated));
    },
  });
  return stripCodeFences(typeof result === 'string' && result ? result : accumulated);
}

/**
 * Ask for a numbered list of improvement ideas. Streams the list so the UI can
 * fill the editor live. onChunk receives the accumulated text so far (not deltas).
 */
export async function suggestImprovements({ providerId, modelId, prompt, html, onChunk }) {
  const parts = buildContext(prompt, html);
  parts.push('Suggest improvements for this page as a numbered list.');
  let accumulated = '';
  const result = await streamChat({
    providerId,
    modelId,
    systemPrompt: SUGGEST_SYSTEM,
    userPrompt: parts.join('\n\n'),
    appTitle: 'Prompt Gallery',
    onChunk: (text) => {
      accumulated = text || '';
      onChunk?.(accumulated);
    },
  });
  return ((typeof result === 'string' && result ? result : accumulated) || '').trim();
}

/**
 * Apply (possibly user-edited) improvement instructions. Streams the
 * updated document. onChunk receives accumulated text.
 */
export async function applyImprovements({ providerId, modelId, prompt, html, instructions, onChunk }) {
  const parts = buildContext(prompt, html);
  parts.push(`IMPROVEMENT INSTRUCTIONS:\n${instructions.trim()}`);
  parts.push('Implement these improvements and return the complete updated HTML document.');

  let accumulated = '';
  const result = await streamChat({
    providerId,
    modelId,
    systemPrompt: APPLY_SYSTEM,
    userPrompt: parts.join('\n\n'),
    appTitle: 'Prompt Gallery',
    onChunk: (text) => {
      accumulated = text || '';
      onChunk?.(stripCodeFences(accumulated));
    },
  });
  return stripCodeFences(typeof result === 'string' && result ? result : accumulated);
}

function compactSandbox(status) {
  if (!status) return { ok: false, timedOut: false, errors: [], warnings: [], evidence: {} };
  return {
    ok: !!status.ok,
    timedOut: !!status.timedOut,
    duration: Number(status.duration) || 0,
    errors: (status.errors || []).slice(0, 20).map(error => String(error).slice(0, 1000)),
    warnings: (status.warnings || []).slice(0, 20).map(warning => String(warning).slice(0, 1000)),
    evidence: status.evidence || {},
  };
}

/** Fresh acceptance-auditor call. Parsing and host verdicts live in acceptance.js. */
export async function auditHtml({ providerId, modelId, prompt, notes, checklist, html, sandbox, onStats, params }) {
  const userPrompt = [
    `ORIGINAL PROMPT:\n${String(prompt || '').trim()}`,
    notes ? `WATCH FOR:\n${String(notes).trim()}` : '',
    `ACCEPTANCE CHECKLIST:\n${JSON.stringify(checklist)}`,
    `SANDBOX STATUS AND EVIDENCE:\n${JSON.stringify(compactSandbox(sandbox))}`,
    `CURRENT COMPLETE HTML:\n${html}`,
    'Audit the document and return the required JSON object only.',
  ].filter(Boolean).join('\n\n');
  return streamChat({
    providerId,
    modelId,
    systemPrompt: AUDIT_SYSTEM,
    userPrompt,
    appTitle: 'Prompt Gallery',
    onStats,
    params,
  });
}

/** Fresh focused repair call. Streams accumulated corrected HTML. */
export async function repairAgainstAudit({
  providerId, modelId, prompt, html, sandbox, failedChecks, repairTasks, onChunk, onStats, params,
}) {
  const errors = sandbox?.timedOut
    ? ['Execution timed out — possible infinite loop or blocked load']
    : (sandbox?.errors || []);
  const userPrompt = [
    `ORIGINAL PROMPT:\n${String(prompt || '').trim()}`,
    `CURRENT HTML:\n${html}`,
    errors.length ? `SANDBOX ERRORS:\n${errors.map((error, i) => `${i + 1}. ${error}`).join('\n')}` : '',
    `FAILED OR UNKNOWN MUST CHECKS:\n${JSON.stringify(failedChecks || [])}`,
    (repairTasks || []).length ? `AUDITOR REPAIR TASKS:\n${repairTasks.map((task, i) => `${i + 1}. ${task}`).join('\n')}` : '',
    'Repair only these requirements and return the complete corrected HTML document.',
  ].filter(Boolean).join('\n\n');
  let accumulated = '';
  const result = await streamChat({
    providerId,
    modelId,
    systemPrompt: REPAIR_AUDIT_SYSTEM,
    userPrompt,
    appTitle: 'Prompt Gallery',
    onStats,
    params,
    onChunk: text => {
      accumulated = text || '';
      onChunk?.(stripCodeFences(accumulated));
    },
  });
  return stripCodeFences(typeof result === 'string' && result ? result : accumulated);
}

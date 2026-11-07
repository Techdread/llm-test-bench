export const PROMPT_GALLERY_AGENT_OUTPUT = 'index.html';

// Laid over the shared coding-agent defaults. Hard prompts outlast any fixed
// limit: high-effort Opus has thought for eight minutes before its first file
// write, and a big build can stay silent for longer than the 3-minute idle
// watchdog while it plans. So a run has no total time limit AND no idle
// timeout — the user's Stop (which cancels the run on the bridge) is the only
// bound. Image budgets are open-ended because the agent screenshots its own
// page to check it, and that self-check was killing runs that had already
// written index.html. Infinity = no limit (sent to the bridge as null); 0 = no
// time limit.
export const PROMPT_GALLERY_AGENT_BUDGET_OVERRIDES = Object.freeze({
  maxAgentSeconds: 0,
  idleTimeoutSeconds: 0,
  maxImages: Infinity,
  maxImagePixels: Infinity,
});

// A CLI agent chosen as an ordinary model (Generate, Refine, batch runs) runs
// through the provider layer, whose own defaults are 15 minutes total and 3
// minutes idle. Prompt Gallery lifts both; Stop aborts the call, which cancels
// the run on the bridge.
export const PROMPT_GALLERY_CHAT_AGENT_BUDGETS = Object.freeze({
  maxAgentSeconds: 0,
  idleTimeoutSeconds: 0,
});

export function buildPromptGalleryAgentTask(prompt) {
  const request = String(prompt || '').trim();
  if (!request) throw new Error('A prompt is required');
  return `You are creating one standalone browser artefact for Prompt Gallery.

USER REQUEST
${request}

REQUIRED RESULT
- Write the complete result to ${PROMPT_GALLERY_AGENT_OUTPUT} in the current project directory.
- It must be a complete HTML document beginning with <!DOCTYPE html>.
- Keep CSS and JavaScript inline so the file remains portable outside this repository.
- Do not reference shared/lib or any other repository-relative runtime path.
- If an external dependency is genuinely needed, use an explicit public URL; otherwise prefer a self-contained file.
- Make the result polished, responsive, and directly usable in a sandboxed iframe.
- Do not merely describe the solution in chat. Inspect the written file before finishing.`;
}

export const PROMPT_GALLERY_AGENT_OUTPUT = 'index.html';

// Laid over the shared coding-agent defaults. Their 15-minute ceiling is
// shorter than a high-effort Opus run on a big prompt — thinking alone has run
// eight minutes before the first file write — so a run has no total time limit
// and Cancel is the stop. The idle watchdog stays: Claude reports thinking
// progress every second or two, so three silent minutes still means a hung
// CLI. Image budgets are open-ended because the agent screenshots its own page
// to check it, and that self-check was killing runs that had already written
// index.html. Infinity = no limit (sent to the bridge as null).
export const PROMPT_GALLERY_AGENT_BUDGET_OVERRIDES = Object.freeze({
  maxAgentSeconds: 0,
  maxImages: Infinity,
  maxImagePixels: Infinity,
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

export const PROMPT_GALLERY_AGENT_OUTPUT = 'index.html';

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

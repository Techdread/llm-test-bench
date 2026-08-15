export const SVG_BENCHMARK_AGENT_OUTPUT = 'output.svg';

export function buildSvgBenchmarkAgentTask(prompt, { hasReference = false } = {}) {
  const request = String(prompt || '').trim();
  if (!request && !hasReference) throw new Error('A prompt or reference image is required');
  return `You are creating a standalone SVG submission for SVG Benchmark.

USER REQUEST
${request || 'Reproduce the supplied reference image as accurately as possible.'}
${hasReference ? '\nREFERENCE\nA reference image is available as reference.png in the current project directory. Inspect it and match its composition, colours, shapes, and proportions.' : ''}

REQUIRED RESULT
- Write only the finished artwork to ${SVG_BENCHMARK_AGENT_OUTPUT} in the current project directory.
- The file must be valid XML SVG markup whose root element is <svg> and includes a viewBox.
- Use clean SVG elements; do not wrap the SVG in HTML or Markdown fences.
- Keep the asset standalone and portable. Do not reference shared/lib or repository-relative files.
- Inspect the written SVG for malformed markup before finishing.
- Do not merely describe the solution in chat.`;
}

import { streamChat } from '../../../shared/services/model-providers.js';

const SYSTEM_PROMPT = `You are an expert creative coder writing p5.js sketches.
Output ONLY a JavaScript snippet defining a function with this exact signature:

  function sketch(p, ctx) { ... }

Where:
- p is a p5 instance (use instance methods like p.background, p.line, p.random, p.frameCount).
- ctx.seed is an integer; call p.randomSeed(ctx.seed) and p.noiseSeed(ctx.seed) inside p.setup.
- ctx.params is an object of tunable values supplied by the app's parameter panel.

Parameters (important — this is how the app builds the control panel):
- Declare every control by reading it as: ctx.params.NAME ?? DEFAULT
- DEFAULT must be a plain literal (80, 0.35, true, "left") — never an expression,
  a variable, or another ctx.params lookup. The app parses these literals out of
  your code to build the sliders, so it must be able to read them.
- Give 3 to 6 parameters, named for what they control in THIS sketch
  (wingSpeed, nectarFlow, trailLength — not generic count/radius/a/b).
- Read each one exactly once, near the top of p.draw or p.setup, into a local
  const with the same name. Use that local everywhere else.
- Every parameter must visibly change the output across its plausible range.

Rules:
- Do NOT include markdown, code fences, prose, or imports.
- Do NOT use globals like setup() or draw() — define them as p.setup and p.draw on the instance.
- Keep canvas size <= 600x600 unless the prompt asks otherwise.
- Make the sketch animate (have a non-trivial p.draw).`;

export async function generateSketch({ prompt, providerId, modelId, onChunk, params, onStats }) {
  return streamChat({
    providerId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    appTitle: 'p5 Sketch Gallery',
    onChunk,
    params,
    onStats,
  });
}

export function stripCodeFences(text) {
  let s = String(text || '');
  s = s.replace(/^\s*```(?:js|javascript)?\s*\n?/i, '');
  s = s.replace(/\n?```\s*$/, '');
  return s;
}

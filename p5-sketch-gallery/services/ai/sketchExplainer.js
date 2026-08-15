import { streamChat } from '../../../shared/services/model-providers.js';

const SYSTEM_PROMPT = `You explain p5.js sketches to the author of the sketch.
The user message contains the sketch source code in JS. Reference variables, helpers,
and functions BY NAME from that code. Avoid generic creative-coding lectures.

Format your reply as concise Markdown:
- One paragraph: what the sketch produces visually.
- Bullet list: key local variables / params (named) and what each one controls.
- Bullet list: ideas for parameter ranges to try.

Do not echo the entire source back. Be specific to this sketch.`;

export async function explainSketch({ code, providerId, modelId, onChunk }) {
  return streamChat({
    providerId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: '```javascript\n' + (code || '') + '\n```',
    appTitle: 'p5 Sketch Gallery',
    onChunk,
  });
}

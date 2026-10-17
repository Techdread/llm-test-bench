// Generic streaming tool-call loop, tool-set-agnostic, cancellable.
// Callers provide:
//   - toolSet: { [name]: { schema, execute(args, ctx): Promise<any> } }
//   - chatCompletion(messages, openaiTools, { signal }): { message }
//   - options: { maxSteps, systemPrompt, userPrompt, onStep(step), signal, ctx }
// Emits each step synchronously via onStep before the next round-trip.

function validateArgs(args, schema) {
  const errors = [];
  const s = schema || {};
  if (Array.isArray(s.required)) {
    for (const k of s.required) if (args[k] === undefined || args[k] === null) errors.push(`missing: ${k}`);
  }
  if (s.properties) {
    for (const [k, prop] of Object.entries(s.properties)) {
      const v = args[k];
      if (v === undefined || v === null) continue;
      if (prop.type === 'string' && typeof v !== 'string') errors.push(`${k} must be string`);
      if (prop.type === 'number' && typeof v !== 'number') errors.push(`${k} must be number`);
      if (prop.type === 'boolean' && typeof v !== 'boolean') errors.push(`${k} must be boolean`);
    }
  }
  return errors;
}

export function toOpenAITools(toolSet) {
  return Object.entries(toolSet).map(([name, def]) => ({
    type: 'function',
    function: { name, description: def.description || '', parameters: def.schema || { type: 'object' } },
  }));
}

export async function runToolLoop({
  toolSet,
  chatCompletion,
  systemPrompt,
  userPrompt,
  maxSteps = 20,
  onStep,
  signal,
  ctx,
}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (userPrompt) messages.push({ role: 'user', content: userPrompt });
  const openaiTools = toOpenAITools(toolSet);
  const steps = [];

  for (let i = 0; i < maxSteps; i++) {
    if (signal?.aborted) throw new Error('aborted');
    const { message } = await chatCompletion(messages, openaiTools, { signal });
    messages.push(message);
    const calls = message.tool_calls || [];
    if (!calls.length) {
      const step = { n: i + 1, type: 'final', content: message.content || '' };
      steps.push(step); onStep?.(step);
      return { steps, messages };
    }
    for (const tc of calls) {
      if (signal?.aborted) throw new Error('aborted');
      const name = tc.function.name;
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); }
      catch (e) {
        const step = { n: i + 1, type: 'tool', tool: name, input: tc.function.arguments, output: { ok: false, error: `bad JSON: ${e.message}` } };
        steps.push(step); onStep?.(step);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: step.output.error });
        continue;
      }
      const def = toolSet[name];
      if (!def) {
        const step = { n: i + 1, type: 'tool', tool: name, input, output: { ok: false, error: `unknown tool: ${name}` } };
        steps.push(step); onStep?.(step);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: step.output.error });
        continue;
      }
      const errs = validateArgs(input, def.schema);
      if (errs.length) {
        const step = { n: i + 1, type: 'tool', tool: name, input, output: { ok: false, error: errs.join('; ') } };
        steps.push(step); onStep?.(step);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: step.output.error });
        continue;
      }
      let output;
      const startedAt = new Date().toISOString();
      const t0 = performance.now();
      try { output = { ok: true, value: await def.execute(input, ctx, { signal }) }; }
      catch (e) { output = { ok: false, error: e?.message || String(e) }; }
      const step = { n: i + 1, type: 'tool', tool: name, input, output, startedAt, durationMs: Math.round(performance.now() - t0), toolCallId: tc.id };
      steps.push(step); onStep?.(step);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: output.ok ? (typeof output.value === 'string' ? output.value : JSON.stringify(output.value)) : output.error });
      if (name === 'finish') return { steps, messages, finishedBy: 'finish', finishInput: input };
    }
  }
  return { steps, messages, finishedBy: 'maxSteps' };
}

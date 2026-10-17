import * as modelProviders from '../../shared/services/model-providers.js';

const APP_TITLE = 'C Machine Lab';

export const GENERATE_SYSTEM_PROMPT = `You generate small single-file C teaching programs for C Machine Lab.
Use only this supported subset: int, char, void, pointers, one-dimensional arrays, string literals, local/global variables, assignments, arithmetic, comparisons, logical operators, if/else, while, for, functions with value parameters, return, printf, puts, putchar, strlen, strcpy, strcmp, memcpy, malloc/free, fopen/fclose/fgetc/fputc/fread/fwrite/fprintf/rewind.
Avoid macros, structs, typedef, casts, multi-file includes, C++, system calls, network, threads, and undefined behavior unless the user explicitly asks for a bug lesson.
Keep examples deterministic and small. Prefer printf for visible output. For file I/O, use virtual files named notes.txt, input.txt, words.txt, or report.txt.
Return only C code, no markdown fences. Include a short comment near main that states the lesson goal.`;

export function buildExplainPrompt({ source, selectedLine, compiled, machine, recentEvents, focus = 'current instruction' }) {
  const currentInstruction = machine?.currentInstruction || null;
  const currentFrame = machine?.callStack?.[machine.callStack.length - 1] || null;
  const facts = {
    focus,
    selectedLine,
    currentInstruction: currentInstruction ? currentInstruction.text : '',
    registers: machine?.registers || null,
    flags: machine?.flags || null,
    currentStackFrame: currentFrame ? {
      functionName: currentFrame.functionName,
      fp: currentFrame.fp,
      sp: currentFrame.sp,
      variables: currentFrame.variables?.map(v => ({
        name: v.name,
        kind: v.kind,
        type: v.type?.display,
        address: v.address,
        value: v.value,
      })),
    } : null,
    heapBlocks: machine?.heap?.blocks || [],
    fileHandles: machine?.files?.handles || [],
    interruptEvent: machine?.lastEvent?.interruptEvent || null,
    recentStepEvents: (recentEvents || []).slice(-8).map(e => ({
      step: e.step,
      instruction: e.instruction?.text,
      registerDiffs: e.registerDiffs,
      memoryReads: e.memoryReads,
      memoryWrites: e.memoryWrites,
      heapEvents: e.heapEvents,
      fileEvents: e.fileEvents,
      interruptEvent: e.interruptEvent,
      stdoutDelta: e.stdoutDelta,
      explanationFacts: e.explanationFacts,
    })),
    diagnostics: compiled?.diagnostics || [],
  };

  return `Explain the current C Machine Lab state to a learner.
Use the machine facts. Be concrete about source line, instruction, registers, stack/heap/file state, and any interrupt.
Avoid claiming this is x86/ARM/WASM; it is a teaching CPU.

Source:
\`\`\`c
${source}
\`\`\`

Machine facts:
\`\`\`json
${JSON.stringify(facts, null, 2)}
\`\`\``;
}

export function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```(?:c|cpp)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function generateTeachingProgram({ providerId, modelId, topic, lesson, onChunk }) {
  const userPrompt = `Generate a C Machine Lab teaching program about: ${topic || lesson?.topic || 'C execution'}.
Current lesson reference: ${lesson ? `${lesson.title} - ${lesson.lessonGoals.join('; ')}` : 'none'}.
The program should be easy to step through and should expose at least one visible machine concept.`;

  return modelProviders.streamChat({
    providerId,
    modelId,
    systemPrompt: GENERATE_SYSTEM_PROMPT,
    userPrompt,
    appTitle: APP_TITLE,
    onChunk: partial => onChunk?.(stripCodeFences(partial)),
  });
}

export async function explainMachineState({ providerId, modelId, context, onChunk }) {
  return modelProviders.streamChat({
    providerId,
    modelId,
    systemPrompt: 'You are a precise C execution tutor. Explain only from the supplied C Machine Lab trace facts.',
    userPrompt: buildExplainPrompt(context),
    appTitle: APP_TITLE,
    onChunk,
  });
}

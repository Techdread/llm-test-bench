import { cloneRegisters, cloneFlags, diffRegisters } from './registers.js';

export function beginStepEvent(machine, instruction) {
  return {
    step: machine.stepCount + 1,
    pcBefore: machine.registers.PC,
    pcAfter: machine.registers.PC,
    instruction,
    sourceMap: instruction ? {
      instructionId: instruction.id,
      sourceLine: instruction.sourceLine,
      sourceColumn: instruction.sourceColumn,
      astNodeId: instruction.astNodeId,
      explanationHint: instruction.explanationHint,
    } : null,
    registerDiffs: [],
    memoryReads: [],
    memoryWrites: [],
    stackDiffs: [],
    heapEvents: [],
    fileEvents: [],
    interruptEvent: null,
    stdoutDelta: '',
    stderrDelta: '',
    explanationFacts: [],
    beforeRegisters: cloneRegisters(machine.registers),
    beforeFlags: cloneFlags(machine.flags),
    beforeStdout: machine.stdout,
    beforeStderr: machine.stderr,
  };
}

export function finishStepEvent(machine, event) {
  event.pcAfter = machine.registers.PC;
  event.registerDiffs = diffRegisters(event.beforeRegisters, machine.registers);
  event.flagDiffs = Object.keys(machine.flags)
    .filter(key => event.beforeFlags[key] !== machine.flags[key])
    .map(flag => ({ flag, before: event.beforeFlags[flag], after: machine.flags[flag] }));
  event.stdoutDelta = machine.stdout.slice(event.beforeStdout.length);
  event.stderrDelta = machine.stderr.slice(event.beforeStderr.length);
  delete event.beforeRegisters;
  delete event.beforeFlags;
  delete event.beforeStdout;
  delete event.beforeStderr;
  return event;
}

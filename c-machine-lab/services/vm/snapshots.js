export function makeSnapshot(machine) {
  return {
    step: machine.stepCount,
    registers: { ...machine.registers },
    flags: { ...machine.flags },
    memory: Array.from(machine.memory.bytes),
    callStack: machine.callStack.map(frame => ({
      ...frame,
      variables: frame.variables.map(v => ({ ...v })),
    })),
    heap: {
      blocks: machine.heap.blocks.map(block => ({ ...block })),
    },
    files: {
      files: machine.files.listFiles(),
      handles: machine.files.handles.map(handle => ({ ...handle })),
    },
    stdout: machine.stdout,
    stderr: machine.stderr,
  };
}

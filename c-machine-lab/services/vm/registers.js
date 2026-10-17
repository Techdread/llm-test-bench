export function createRegisters(config) {
  return {
    PC: 0,
    SP: config.segments.stack.end + 1,
    FP: config.segments.stack.end + 1,
    IR: '',
    R0: 0,
    R1: 0,
    R2: 0,
    R3: 0,
    R4: 0,
    R5: 0,
    R6: 0,
    R7: 0,
  };
}

export function createFlags() {
  return { Z: false, N: false, C: false, V: false };
}

export function cloneRegisters(registers) {
  return Object.fromEntries(Object.entries(registers).map(([key, value]) => [key, value]));
}

export function cloneFlags(flags) {
  return { Z: !!flags.Z, N: !!flags.N, C: !!flags.C, V: !!flags.V };
}

export function diffRegisters(before, after) {
  const diffs = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) diffs.push({ register: key, before: before[key], after: after[key] });
  }
  return diffs;
}

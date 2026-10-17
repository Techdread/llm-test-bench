export function frameVariableValue(memory, variable) {
  if (variable.type?.arrayLength) {
    if (variable.type.base === 'char') return memory.readCString(variable.address, variable.size);
    return `array @ ${hex(variable.address)}`;
  }
  const size = variable.type?.base === 'char' && !variable.type?.pointerDepth ? 1 : 4;
  return memory.readValue(variable.address, size);
}

export function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(4, '0')}`;
}

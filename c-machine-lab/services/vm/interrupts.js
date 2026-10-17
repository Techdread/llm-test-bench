import { vectorInfo } from './instructionSet.js';

export function handleInterrupt(machine, vector, instruction, event) {
  const meta = instruction.meta || {};
  const info = vectorInfo(vector);
  const interruptEvent = {
    vector,
    name: info.name,
    arguments: {},
    affectedRegisters: [],
    affectedMemory: [],
    runtimeHandlerExplanation: info.description,
    returnPoint: machine.registers.PC + 1,
    call: meta.call || info.name,
    ok: true,
  };

  try {
    if (vector === 0x10) handleStdout(machine, meta, interruptEvent);
    else if (vector === 0x20) handleMalloc(machine, interruptEvent, event);
    else if (vector === 0x21) handleFree(machine, interruptEvent, event);
    else if (vector === 0x30) handleFopen(machine, interruptEvent, event);
    else if (vector === 0x31) handleFclose(machine, interruptEvent, event);
    else if (vector === 0x32) handleFread(machine, interruptEvent, event);
    else if (vector === 0x33) handleFwrite(machine, meta, interruptEvent, event);
    else if (vector === 0x34) handleFgetc(machine, interruptEvent, event);
    else if (vector === 0x35) handleFputc(machine, interruptEvent, event);
    else if (vector === 0x36) handleRewind(machine, interruptEvent, event);
    else if (vector === 0x50) handleStrlen(machine, interruptEvent);
    else if (vector === 0x51) handleStrcpy(machine, interruptEvent, event);
    else if (vector === 0x52) handleStrcmp(machine, interruptEvent);
    else if (vector === 0x53) handleMemcpy(machine, interruptEvent, event);
    else trap(machine, `unsupported interrupt ${hex(vector)}`, interruptEvent);
  } catch (err) {
    trap(machine, err.message || String(err), interruptEvent);
  }

  event.interruptEvent = interruptEvent;
  event.explanationFacts.push(`INT ${hex(vector)} (${interruptEvent.name}) handled ${interruptEvent.call}.`);
}

function handleStdout(machine, meta, interruptEvent) {
  const call = meta.call;
  if (call === 'putchar') {
    const code = machine.registers.R0 & 0xff;
    interruptEvent.arguments.charCode = code;
    machine.appendStdout(String.fromCharCode(code));
    return;
  }
  if (call === 'puts') {
    const address = machine.registers.R0;
    const text = machine.memory.readCString(address);
    interruptEvent.arguments.address = address;
    interruptEvent.arguments.text = text;
    machine.appendStdout(`${text}\n`);
    return;
  }
  const formatAddress = machine.registers.R0;
  const format = machine.memory.readCString(formatAddress);
  const values = [];
  for (let i = 0; i < (meta.argCount || 0); i += 1) values.push(machine.registers[`R${i + 1}`] | 0);
  const output = formatText(machine, format, values);
  interruptEvent.arguments.format = format;
  interruptEvent.arguments.values = values;
  machine.appendStdout(output);
}

function handleMalloc(machine, interruptEvent, event) {
  const size = machine.registers.R0 | 0;
  const result = machine.heap.allocate(size);
  interruptEvent.arguments.size = size;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  machine.registers.R0 = result.address | 0;
  interruptEvent.affectedRegisters.push({ register: 'R0', value: result.address });
  event.heapEvents.push({ type: 'malloc', address: result.address, size, blockId: result.block.id });
}

function handleFree(machine, interruptEvent, event) {
  const address = machine.registers.R0 | 0;
  const result = machine.heap.free(address, machine.stepCount + 1);
  interruptEvent.arguments.address = address;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  event.heapEvents.push({ type: 'free', address, blockId: result.block.id });
}

function handleFopen(machine, interruptEvent, event) {
  const filename = machine.memory.readCString(machine.registers.R0);
  const mode = machine.memory.readCString(machine.registers.R1);
  const result = machine.files.open(filename, mode);
  interruptEvent.arguments.filename = filename;
  interruptEvent.arguments.mode = mode;
  machine.registers.R0 = result.handle?.id || 0;
  interruptEvent.affectedRegisters.push({ register: 'R0', value: machine.registers.R0 });
  if (!result.ok) {
    interruptEvent.ok = false;
    interruptEvent.runtimeHandlerExplanation = result.error;
  }
  event.fileEvents.push({ type: 'fopen', filename, mode, handle: machine.registers.R0, ok: result.ok, error: result.error || '' });
}

function handleFclose(machine, interruptEvent, event) {
  const handleId = machine.registers.R0 | 0;
  const result = machine.files.close(handleId);
  interruptEvent.arguments.handle = handleId;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  event.fileEvents.push({ type: 'fclose', handle: handleId, filename: result.handle.filename });
}

function handleFgetc(machine, interruptEvent, event) {
  const handleId = machine.registers.R0 | 0;
  const result = machine.files.readChar(handleId);
  interruptEvent.arguments.handle = handleId;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  machine.registers.R0 = result.value | 0;
  interruptEvent.affectedRegisters.push({ register: 'R0', value: machine.registers.R0 });
  event.fileEvents.push({
    type: 'fgetc',
    handle: handleId,
    value: result.value,
    char: result.value >= 0 ? String.fromCharCode(result.value) : 'EOF',
    offset: result.handle?.offset,
    filename: result.handle?.filename,
  });
}

function handleFputc(machine, interruptEvent, event) {
  const value = machine.registers.R0 & 0xff;
  const handleId = machine.registers.R1 | 0;
  const result = machine.files.writeChar(handleId, value);
  interruptEvent.arguments.handle = handleId;
  interruptEvent.arguments.value = value;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  event.fileEvents.push({ type: 'fputc', handle: handleId, value, char: result.value, offset: result.handle.offset, filename: result.handle.filename });
}

function handleFread(machine, interruptEvent, event) {
  const ptr = machine.registers.R0 | 0;
  const size = machine.registers.R1 | 0;
  const count = machine.registers.R2 | 0;
  const handleId = machine.registers.R3 | 0;
  let read = 0;
  for (let i = 0; i < size * count; i += 1) {
    const result = machine.files.readChar(handleId);
    if (!result.ok) return trap(machine, result.error, interruptEvent);
    if (result.value < 0) break;
    machine.writeMemory(ptr + i, result.value, 1, event, 'fread buffer write');
    read += 1;
  }
  machine.registers.R0 = size ? Math.floor(read / size) : 0;
  interruptEvent.arguments = { ptr, size, count, handle: handleId };
  event.fileEvents.push({ type: 'fread', handle: handleId, bytes: read, ptr });
}

function handleFwrite(machine, meta, interruptEvent, event) {
  if (meta.call === 'fprintf') {
    const handleId = machine.registers.R0 | 0;
    const format = machine.memory.readCString(machine.registers.R1);
    const values = [];
    for (let i = 0; i < (meta.argCount || 0); i += 1) values.push(machine.registers[`R${i + 2}`] | 0);
    const text = formatText(machine, format, values);
    const result = machine.files.writeString(handleId, text);
    interruptEvent.arguments = { handle: handleId, format, values };
    if (!result.ok) return trap(machine, result.error, interruptEvent);
    event.fileEvents.push({ type: 'fprintf', handle: handleId, bytes: result.bytes, text, offset: result.handle.offset, filename: result.handle.filename });
    return;
  }
  const ptr = machine.registers.R0 | 0;
  const size = machine.registers.R1 | 0;
  const count = machine.registers.R2 | 0;
  const handleId = machine.registers.R3 | 0;
  const bytes = [];
  for (let i = 0; i < size * count; i += 1) bytes.push(machine.memory.readByte(ptr + i));
  const text = String.fromCharCode(...bytes);
  const result = machine.files.writeString(handleId, text);
  interruptEvent.arguments = { ptr, size, count, handle: handleId };
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  machine.registers.R0 = count;
  event.fileEvents.push({ type: 'fwrite', handle: handleId, bytes: bytes.length, text, offset: result.handle.offset, filename: result.handle.filename });
}

function handleRewind(machine, interruptEvent, event) {
  const handleId = machine.registers.R0 | 0;
  const result = machine.files.rewind(handleId);
  interruptEvent.arguments.handle = handleId;
  if (!result.ok) return trap(machine, result.error, interruptEvent);
  event.fileEvents.push({ type: 'rewind', handle: handleId, filename: result.handle.filename, offset: 0 });
}

function handleStrlen(machine, interruptEvent) {
  const ptr = machine.registers.R0 | 0;
  const text = machine.memory.readCString(ptr);
  interruptEvent.arguments.address = ptr;
  interruptEvent.arguments.string = text;
  machine.registers.R0 = text.length;
  interruptEvent.affectedRegisters.push({ register: 'R0', value: text.length });
}

function handleStrcpy(machine, interruptEvent, event) {
  const dest = machine.registers.R0 | 0;
  const src = machine.registers.R1 | 0;
  const text = machine.memory.readCString(src);
  const bytesWritten = machine.writeCString(dest, text, event, 'strcpy bytes');
  interruptEvent.arguments = { dest, src, text };
  interruptEvent.affectedMemory.push({ address: dest, bytes: bytesWritten });
}

function handleStrcmp(machine, interruptEvent) {
  const a = machine.memory.readCString(machine.registers.R0);
  const b = machine.memory.readCString(machine.registers.R1);
  machine.registers.R0 = a === b ? 0 : a < b ? -1 : 1;
  interruptEvent.arguments = { a, b };
  interruptEvent.affectedRegisters.push({ register: 'R0', value: machine.registers.R0 });
}

function handleMemcpy(machine, interruptEvent, event) {
  const dest = machine.registers.R0 | 0;
  const src = machine.registers.R1 | 0;
  const count = machine.registers.R2 | 0;
  const bytes = machine.memory.readBytes(src, count);
  for (let i = 0; i < bytes.length; i += 1) machine.writeMemory(dest + i, bytes[i], 1, event, 'memcpy byte');
  machine.registers.R0 = dest;
  interruptEvent.arguments = { dest, src, count };
  interruptEvent.affectedMemory.push({ address: dest, bytes: count });
}

function trap(machine, message, interruptEvent = null) {
  const event = interruptEvent || {};
  event.vector = 0xff;
  event.name = 'runtime error';
  event.ok = false;
  event.runtimeHandlerExplanation = message;
  machine.stderr += `Runtime trap: ${message}\n`;
  machine.halted = true;
  return event;
}

function formatText(machine, format, values) {
  let index = 0;
  return String(format).replace(/%[%dicsx]/g, (token) => {
    if (token === '%%') return '%';
    const value = values[index++] | 0;
    if (token === '%d' || token === '%i') return String(value);
    if (token === '%c') return String.fromCharCode(value & 0xff);
    if (token === '%x') return (value >>> 0).toString(16);
    if (token === '%s') return machine.memory.readCString(value);
    return token;
  });
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(value <= 0xff ? 2 : 4, '0')}`;
}

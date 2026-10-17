import { runAlu, comparisonFromFlags } from './alu.js';
import { handleInterrupt } from './interrupts.js';

export function executeInstruction(machine, instruction, event) {
  if (!instruction) {
    machine.halted = true;
    return;
  }

  machine.registers.IR = instruction.text;
  const op = instruction.op;

  if (op === 'LABEL') {
    machine.registers.PC += 1;
    event.explanationFacts.push(`Reached label ${instruction.args[0]}.`);
    return;
  }

  if (op === 'HALT') {
    machine.halted = true;
    machine.registers.PC += 1;
    const leaks = machine.heap.blocks.filter(block => !block.free);
    if (leaks.length) {
      machine.stderr += `Heap warning: ${leaks.length} allocation(s) still live at HALT.\n`;
      event.heapEvents.push(...leaks.map(block => ({ type: 'leak', blockId: block.id, address: block.payload, size: block.requestedSize })));
    }
    event.explanationFacts.push('HALT stops the teaching VM.');
    return;
  }

  if (op === 'MOV') {
    machine.registers[instruction.args[0]] = valueForMov(machine, instruction) | 0;
    machine.registers.PC += 1;
    return;
  }

  if (op === 'LEA') {
    machine.registers[instruction.args[0]] = machine.resolveAddress(instruction.args[1]) | 0;
    machine.registers.PC += 1;
    event.explanationFacts.push('LEA writes an address, not the value stored at that address.');
    return;
  }

  if (op === 'LOAD') {
    const dest = instruction.args[0];
    const address = machine.resolveAddress(instruction.args[1]);
    const size = instruction.meta?.size || instruction.args[1]?.size || 4;
    const valid = machine.heap.validateAccess(address, size, 'read');
    if (!valid.ok) return machine.trap(valid.error, event);
    machine.registers[dest] = machine.readMemory(address, size, event, 'LOAD') | 0;
    machine.registers.PC += 1;
    return;
  }

  if (op === 'STORE') {
    const target = instruction.args[0];
    const address = machine.resolveAddress(target);
    if (instruction.meta?.kind === 'initString') {
      machine.writeCString(address, instruction.meta.value, event, 'local string initializer', instruction.meta.maxBytes);
      machine.registers.PC += 1;
      return;
    }
    const size = instruction.meta?.size || target?.size || 4;
    const value = machine.valueOf(instruction.args[1]);
    const valid = machine.heap.validateAccess(address, size, 'write');
    if (!valid.ok) return machine.trap(valid.error, event);
    machine.writeMemory(address, value, size, event, 'STORE');
    machine.registers.PC += 1;
    return;
  }

  if (['ADD', 'SUB', 'MUL', 'DIV', 'MOD'].includes(op)) {
    const a = machine.valueOf(instruction.args[1]);
    const b = machine.valueOf(instruction.args[2]);
    if ((op === 'DIV' || op === 'MOD') && b === 0) return machine.trap('division by zero', event);
    const alu = runAlu(op, a, b);
    machine.lastAlu = alu;
    machine.flags = alu.flags;
    machine.registers[instruction.args[0]] = alu.result | 0;
    machine.registers.PC += 1;
    event.explanationFacts.push(`${op} used the ALU and updated Z/N/C/V flags.`);
    return;
  }

  if (op === 'CMP') {
    const a = machine.valueOf(instruction.args[0]);
    const b = machine.valueOf(instruction.args[1]);
    const alu = runAlu('CMP', a, b);
    machine.lastAlu = alu;
    machine.flags = alu.flags;
    machine.registers.PC += 1;
    return;
  }

  if (op === 'JMP') {
    machine.registers.PC = machine.labels.get(instruction.args[0]) ?? machine.registers.PC + 1;
    return;
  }

  if (['JZ', 'JNZ', 'JL', 'JLE', 'JG', 'JGE'].includes(op)) {
    const taken = branchTaken(op, machine.flags);
    machine.registers.PC = taken ? (machine.labels.get(instruction.args[0]) ?? machine.registers.PC + 1) : machine.registers.PC + 1;
    event.explanationFacts.push(`${op} was ${taken ? 'taken' : 'not taken'} from flags Z=${machine.flags.Z} N=${machine.flags.N} V=${machine.flags.V}.`);
    return;
  }

  if (op === 'CALL') {
    const callee = instruction.meta?.callee || instruction.args[0];
    const argCount = instruction.meta?.argCount || 0;
    const args = Array.from({ length: argCount }, (_, i) => machine.registers[`R${i}`] | 0);
    const returnPc = machine.registers.PC + 1;
    machine.createFrame(callee, returnPc, args, event);
    machine.registers.PC = machine.labels.get(callee) ?? returnPc;
    return;
  }

  if (op === 'RET') {
    machine.returnFromFrame(event);
    return;
  }

  if (op === 'INT') {
    const vector = machine.valueOf(instruction.args[0]);
    handleInterrupt(machine, vector, instruction, event);
    if (!machine.halted) machine.registers.PC += 1;
    return;
  }

  machine.trap(`unsupported instruction ${op}`, event);
}

function valueForMov(machine, instruction) {
  const meta = instruction.meta || {};
  if (meta.kind === 'comparisonResult') return comparisonFromFlags(machine.flags, meta.operator) ? 1 : 0;
  if (meta.kind === 'logicalNot') return machine.flags.Z ? 1 : 0;
  if (meta.kind === 'logicalResult') {
    const left = machine.registers[meta.left] | 0;
    const right = machine.registers[meta.right] | 0;
    return meta.operator === '&&' ? (left && right ? 1 : 0) : (left || right ? 1 : 0);
  }
  return machine.valueOf(instruction.args[1]);
}

function branchTaken(op, flags) {
  if (op === 'JZ') return flags.Z;
  if (op === 'JNZ') return !flags.Z;
  if (op === 'JL') return flags.N !== flags.V;
  if (op === 'JLE') return flags.Z || flags.N !== flags.V;
  if (op === 'JG') return !flags.Z && flags.N === flags.V;
  if (op === 'JGE') return flags.N === flags.V;
  return false;
}

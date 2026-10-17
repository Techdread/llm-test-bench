import { TeachingMemory, hex } from './memory.js';
import { createRegisters, createFlags, cloneRegisters } from './registers.js';
import { TeachingHeap } from './heap.js';
import { VirtualFileSystem } from './files.js';
import { executeInstruction } from './executor.js';
import { beginStepEvent, finishStepEvent } from './trace.js';
import { makeSnapshot } from './snapshots.js';
import { frameVariableValue } from './stack.js';

export class TeachingMachine {
  constructor(compiled, config, virtualFiles = []) {
    this.compiled = compiled;
    this.config = config;
    this.memory = new TeachingMemory(config);
    this.heap = new TeachingHeap(config);
    this.files = new VirtualFileSystem(virtualFiles, config);
    this.registers = createRegisters(config);
    this.flags = createFlags();
    this.callStack = [];
    this.stdout = '';
    this.stderr = '';
    this.trace = [];
    this.snapshots = [];
    this.stepCount = 0;
    this.halted = false;
    this.lastAlu = null;
    this.lastEvent = null;
    this.labels = new Map();
    this.functionMap = new Map();
    this.currentInstruction = null;

    this.buildLabels();
    this.initializeMemory();
    this.createFrame('main', -1, [], null);
    this.registers.PC = this.labels.get('main') ?? 0;
    this.currentInstruction = this.compiled.assembly[this.registers.PC] || null;
  }

  buildLabels() {
    this.compiled.assembly.forEach((instruction, index) => {
      if (instruction.op === 'LABEL') this.labels.set(instruction.meta?.label || instruction.args[0], index);
    });
    for (const fn of this.compiled.symbols.functions || []) this.functionMap.set(fn.name, fn);
  }

  initializeMemory() {
    for (const literal of this.compiled.memoryImage?.stringLiterals || []) {
      this.memory.writeBytes(literal.address, literal.bytes);
    }
    for (const global of this.compiled.memoryImage?.globals || []) {
      if (typeof global.init === 'string') this.memory.writeCString(global.address, global.init, global.size);
      else this.memory.writeValue(global.address, global.init == null ? 0 : global.init, global.type?.base === 'char' && !global.type?.pointerDepth ? 1 : 4);
    }
  }

  step() {
    if (this.halted) return null;
    const instruction = this.compiled.assembly[this.registers.PC];
    this.currentInstruction = instruction || null;
    const event = beginStepEvent(this, instruction);
    try {
      executeInstruction(this, instruction, event);
    } catch (err) {
      this.trap(err.message || String(err), event);
    }
    this.refreshFrameValues();
    this.stepCount += 1;
    const finished = finishStepEvent(this, event);
    this.trace.push(finished);
    if (this.trace.length > this.config.traceRetentionLimit) this.trace.shift();
    if (this.stepCount % this.config.snapshotInterval === 0) this.snapshots.push(this.snapshot());
    this.lastEvent = finished;
    this.currentInstruction = this.compiled.assembly[this.registers.PC] || null;
    return finished;
  }

  run(maxSteps = this.config.maxStepsBeforeAutoPause) {
    const events = [];
    for (let i = 0; i < maxSteps && !this.halted; i += 1) {
      const event = this.step();
      if (event) events.push(event);
    }
    return events;
  }

  createFrame(functionName, returnAddress, args = [], event = null) {
    const info = this.functionMap.get(functionName);
    if (!info) {
      this.trap(`unknown function "${functionName}"`, event);
      return null;
    }
    const previousFP = this.registers.FP;
    const top = this.registers.SP;
    const fp = top - 8;
    const sp = top - info.frameSize;
    if (sp < this.config.segments.stack.start) {
      this.trap(`stack overflow while entering ${functionName}`, event);
      return null;
    }
    const frame = {
      id: `${functionName}-${this.callStack.length + 1}-${this.stepCount}`,
      functionName,
      top,
      fp,
      sp,
      savedFP: previousFP,
      returnAddress,
      savedRegisters: {
        R1: this.registers.R1,
        R2: this.registers.R2,
        R3: this.registers.R3,
        R4: this.registers.R4,
        R5: this.registers.R5,
        R6: this.registers.R6,
        R7: this.registers.R7,
      },
      addressRange: { start: sp, end: top },
      variables: info.variables.map((variable, index) => ({
        ...variable,
        address: fp - (variable.addressOffset || variable.offset),
        value: 0,
        initialized: variable.kind === 'param',
        paramIndex: variable.kind === 'param' ? index : null,
      })),
    };
    this.registers.SP = sp;
    this.registers.FP = fp;
    this.memory.writeInt(fp + 4, previousFP | 0);
    this.memory.writeInt(fp, returnAddress | 0);
    for (const variable of frame.variables) {
      if (variable.kind === 'param') {
        const paramIndex = info.params.findIndex(param => param.name === variable.name);
        this.memory.writeValue(variable.address, args[paramIndex] || 0, 4);
      } else {
        const size = variable.type?.arrayLength ? variable.size : variable.type?.base === 'char' && !variable.type?.pointerDepth ? 1 : 4;
        for (let i = 0; i < size; i += 1) this.memory.writeByte(variable.address + i, 0);
      }
    }
    this.callStack.push(frame);
    this.refreshFrameValues();
    event?.stackDiffs.push({ type: 'push-frame', functionName, fp, sp, returnAddress });
    return frame;
  }

  returnFromFrame(event) {
    const frame = this.callStack.pop();
    if (!frame) {
      this.halted = true;
      return;
    }
    const returnAddress = frame.returnAddress;
    const returnValue = this.registers.R0;
    this.registers.SP = frame.top;
    this.registers.FP = frame.savedFP;
    for (const [register, value] of Object.entries(frame.savedRegisters || {})) {
      this.registers[register] = value;
    }
    this.registers.R0 = returnValue;
    event?.stackDiffs.push({ type: 'pop-frame', functionName: frame.functionName, returnAddress });
    if (returnAddress < 0) {
      this.halted = true;
      this.registers.PC += 1;
    } else {
      this.registers.PC = returnAddress;
    }
    this.refreshFrameValues();
  }

  currentFrame() {
    return this.callStack[this.callStack.length - 1] || null;
  }

  resolveAddress(operand) {
    if (!operand) return 0;
    if (operand.kind === 'immediate') return operand.value | 0;
    if (operand.kind === 'absolute') return operand.address | 0;
    if (operand.kind === 'global') return operand.address | 0;
    if (operand.kind === 'registerAddress') return this.registers[operand.register] | 0;
    if (operand.kind === 'local') {
      const frame = this.currentFrame();
      const variable = frame?.variables.find(item => item.name === operand.name);
      return variable?.address || 0;
    }
    return Number(operand) | 0;
  }

  valueOf(operand) {
    if (typeof operand === 'string') {
      if (operand in this.registers) return this.registers[operand] | 0;
      return 0;
    }
    if (operand?.kind === 'immediate') return operand.value | 0;
    if (operand?.kind === 'string') return 0;
    return Number(operand) | 0;
  }

  readMemory(address, size, event, reason) {
    const value = this.memory.readValue(address, size);
    event?.memoryReads.push({ address, size, value, segment: this.memory.segmentOf(address), reason });
    return value;
  }

  writeMemory(address, value, size, event, reason) {
    this.memory.writeValue(address, value, size);
    event?.memoryWrites.push({ address, size, value: value | 0, segment: this.memory.segmentOf(address), reason });
  }

  writeCString(address, value, event, reason, maxBytes = Infinity) {
    const bytesWritten = this.memory.writeCString(address, value, maxBytes);
    event?.memoryWrites.push({ address, size: bytesWritten, value: String(value), segment: this.memory.segmentOf(address), reason });
    return bytesWritten;
  }

  appendStdout(text) {
    this.stdout = `${this.stdout}${text}`.slice(0, this.config.maxStdoutLength);
  }

  trap(message, event = null) {
    this.stderr += `Runtime trap: ${message}\n`;
    this.halted = true;
    if (event) {
      event.interruptEvent = {
        vector: 0xff,
        name: 'runtime error',
        arguments: {},
        affectedRegisters: [],
        affectedMemory: [],
        runtimeHandlerExplanation: message,
        returnPoint: this.registers.PC,
        ok: false,
      };
      event.explanationFacts.push(`Runtime trap: ${message}`);
    }
  }

  refreshFrameValues() {
    for (const frame of this.callStack) {
      for (const variable of frame.variables) {
        try {
          variable.value = frameVariableValue(this.memory, variable);
          variable.pointerInfo = (variable.type?.pointerDepth || variable.type?.base === 'FILE') && typeof variable.value === 'number'
            ? this.heap.describePointer(variable.value)
            : null;
        } catch {
          variable.value = '?';
        }
      }
    }
  }

  inspectAddress(address) {
    const addr = Number(address) | 0;
    const pointer = this.heap.describePointer(addr);
    return {
      address: addr,
      hex: hex(addr),
      segment: this.memory.segmentOf(addr),
      pointer,
      bytes: this.memory.inBounds(addr, 1) ? this.memory.dump(addr, 32) : [],
      intValue: this.memory.inBounds(addr, 4) ? this.memory.readInt(addr) : null,
      charString: this.memory.inBounds(addr, 1) ? this.memory.readCString(addr, 64) : '',
    };
  }

  snapshot() {
    return makeSnapshot(this);
  }

  cloneRegisters() {
    return cloneRegisters(this.registers);
  }
}

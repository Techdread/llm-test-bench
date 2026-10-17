import { makeSourceMapEntry } from './sourceMap.js';

const TEXT_BASE = 0x0000;
const WORD_SIZE = 4;
const LIBRARY_CALLS = new Set([
  'printf', 'puts', 'putchar',
  'strlen', 'strcpy', 'strcmp', 'memcpy',
  'malloc', 'free',
  'fopen', 'fclose', 'fgetc', 'fputc', 'fread', 'fwrite', 'fprintf', 'rewind',
]);

export function lowerToAssembly(ast, semantic, config) {
  const ctx = {
    ast,
    semantic,
    config,
    instructions: [],
    diagnostics: [],
    instructionSeq: 0,
    labelSeq: 0,
    dataCursor: config.segments.data.start,
    stringLiterals: [],
    stringMap: new Map(),
    globals: [],
    functions: [],
    functionMap: new Map(),
    globalMap: new Map(),
    loopStack: [],
  };

  lowerGlobals(ctx);
  prepareFunctions(ctx);

  for (const fn of ast.declarations.filter(d => d.kind === 'FunctionDeclaration')) {
    lowerFunction(ctx, fn);
  }

  emit(ctx, 'HALT', [], null, {
    text: 'HALT',
    hint: 'Program image has no more functions to execute.',
  });

  const assembly = ctx.instructions.map((inst, index) => ({
    ...inst,
    address: TEXT_BASE + index * WORD_SIZE,
  }));

  return {
    assembly,
    sourceMap: assembly.map(makeSourceMapEntry),
    symbols: {
      globals: ctx.globals,
      functions: ctx.functions,
      stringLiterals: ctx.stringLiterals,
    },
    memoryImage: {
      globals: ctx.globals,
      stringLiterals: ctx.stringLiterals,
      dataEnd: ctx.dataCursor,
    },
    diagnostics: ctx.diagnostics,
  };
}

function lowerGlobals(ctx) {
  for (const decl of ctx.ast.declarations || []) {
    if (decl.kind !== 'GlobalDeclaration') continue;
    for (const item of decl.declarations) {
      const size = typeSize(item.type);
      const symbol = {
        name: item.name,
        kind: 'global',
        type: item.type,
        size,
        address: align(ctx.dataCursor, Math.min(size, 4)),
        init: literalInitializer(item.init),
      };
      ctx.dataCursor = align(symbol.address + size, 4);
      ctx.globals.push(symbol);
      ctx.globalMap.set(item.name, symbol);
    }
  }
}

function prepareFunctions(ctx) {
  for (const fn of ctx.ast.declarations || []) {
    if (fn.kind !== 'FunctionDeclaration') continue;
    const variables = [];
    let offset = 4;
    for (const param of fn.params || []) {
      const symbol = {
        name: param.name,
        kind: 'param',
        type: param.type,
        size: typeSize(param.type),
        offset,
        slotSize: align(typeSize(param.type), 4),
        addressOffset: offset,
      };
      offset += symbol.slotSize;
      variables.push(symbol);
    }
    collectLocals(fn.body, variables);
    for (const local of variables.filter(v => v.kind === 'local')) {
      local.slotSize = align(local.size, 4);
      local.offset = offset;
      local.addressOffset = offset + local.slotSize - 4;
      offset += local.slotSize;
    }
    const info = {
      name: fn.name,
      entryLabel: fn.name,
      returnType: fn.returnType,
      params: variables.filter(v => v.kind === 'param'),
      locals: variables.filter(v => v.kind === 'local'),
      variables,
      frameSize: align(offset + 8, 4),
    };
    ctx.functions.push(info);
    ctx.functionMap.set(fn.name, info);
  }
}

function collectLocals(stmt, variables) {
  if (!stmt) return;
  if (stmt.kind === 'BlockStatement') {
    for (const child of stmt.statements || []) collectLocals(child, variables);
    return;
  }
  if (stmt.kind === 'VariableDeclaration') {
    for (const decl of stmt.declarations || []) {
      variables.push({
        name: decl.name,
        kind: 'local',
        type: decl.type,
        size: typeSize(decl.type),
        init: decl.init,
      });
    }
    return;
  }
  if (stmt.kind === 'IfStatement') {
    collectLocals(stmt.consequent, variables);
    collectLocals(stmt.alternate, variables);
    return;
  }
  if (stmt.kind === 'WhileStatement' || stmt.kind === 'ForStatement') {
    collectLocals(stmt.init, variables);
    collectLocals(stmt.body, variables);
  }
}

function lowerFunction(ctx, fn) {
  const functionInfo = ctx.functionMap.get(fn.name);
  const previousFunctionInfo = ctx.functionInfo;
  const previousScope = ctx.scope;
  ctx.functionInfo = functionInfo;
  ctx.scope = new Map(ctx.globalMap);
  for (const variable of functionInfo.variables) ctx.scope.set(variable.name, variable);

  emit(ctx, 'LABEL', [fn.name], fn, {
    text: `${fn.name}:`,
    hint: `Function ${fn.name} starts here.`,
    meta: { label: fn.name, functionName: fn.name },
  });
  lowerStatement(ctx, fn.body);
  if (!endsWithReturn(fn.body)) {
    emit(ctx, 'MOV', ['R0', imm(0)], fn, { hint: `Default return value for ${fn.name}.` });
    emit(ctx, 'RET', [], fn, { hint: `Return from ${fn.name}.` });
  }
  ctx.functionInfo = previousFunctionInfo;
  ctx.scope = previousScope;
}

function lowerStatement(ctx, stmt) {
  if (!stmt) return;
  if (stmt.kind === 'BlockStatement') {
    for (const child of stmt.statements || []) lowerStatement(ctx, child);
    return;
  }
  if (stmt.kind === 'VariableDeclaration') {
    for (const decl of stmt.declarations || []) lowerLocalDeclaration(ctx, decl);
    return;
  }
  if (stmt.kind === 'ExpressionStatement') {
    compileExpression(ctx, stmt.expression, 'R0');
    return;
  }
  if (stmt.kind === 'ReturnStatement') {
    if (stmt.argument) compileExpression(ctx, stmt.argument, 'R0');
    else emit(ctx, 'MOV', ['R0', imm(0)], stmt, { hint: 'A void return writes 0 to R0 in the teaching VM.' });
    emit(ctx, 'RET', [], stmt, {
      hint: 'RET pops the current stack frame and jumps back to the saved return address.',
    });
    return;
  }
  if (stmt.kind === 'IfStatement') return lowerIf(ctx, stmt);
  if (stmt.kind === 'WhileStatement') return lowerWhile(ctx, stmt);
  if (stmt.kind === 'ForStatement') return lowerFor(ctx, stmt);
  if (stmt.kind === 'BreakStatement') {
    const loop = ctx.loopStack[ctx.loopStack.length - 1];
    emit(ctx, 'JMP', [loop?.breakLabel || 'missing_break_target'], stmt, { hint: 'break jumps to the loop exit label.' });
    return;
  }
  if (stmt.kind === 'ContinueStatement') {
    const loop = ctx.loopStack[ctx.loopStack.length - 1];
    emit(ctx, 'JMP', [loop?.continueLabel || 'missing_continue_target'], stmt, { hint: 'continue jumps to the loop update/condition label.' });
  }
}

function lowerLocalDeclaration(ctx, decl) {
  const symbol = ctx.scope.get(decl.name);
  if (!symbol) return;
  if (decl.type.arrayLength && decl.init?.valueType === 'string') {
    emit(ctx, 'STORE', [addrOf(symbol), stringOperand(decl.init.value)], decl, {
      text: `STORE ${formatAddress(addrOf(symbol))}, "${escapeDisplay(decl.init.value)}\\0"`,
      hint: `Initialize local char array ${decl.name} with a null-terminated string.`,
      meta: { kind: 'initString', target: addrOf(symbol), value: decl.init.value, maxBytes: symbol.size },
    });
    return;
  }
  if (decl.init) {
    compileExpression(ctx, decl.init, 'R0');
  } else {
    emit(ctx, 'MOV', ['R0', imm(0)], decl, { hint: `Initialize ${decl.name} to 0 for deterministic teaching traces.` });
  }
  emit(ctx, 'STORE', [addrOf(symbol), 'R0'], decl, {
    hint: `Write ${decl.name} to its stack slot.`,
    meta: { size: decl.type.base === 'char' && !decl.type.pointerDepth ? 1 : 4 },
  });
}

function lowerIf(ctx, stmt) {
  const elseLabel = freshLabel(ctx, 'else');
  const endLabel = freshLabel(ctx, 'endif');
  compileExpression(ctx, stmt.test, 'R0');
  emit(ctx, 'CMP', ['R0', imm(0)], stmt.test, { hint: 'Compare the if condition with zero.' });
  emit(ctx, 'JZ', [elseLabel], stmt, { hint: 'Jump to else when the condition is zero.' });
  lowerStatement(ctx, stmt.consequent);
  emit(ctx, 'JMP', [endLabel], stmt, { hint: 'Skip the else branch after the if branch runs.' });
  emit(ctx, 'LABEL', [elseLabel], stmt, { text: `${elseLabel}:`, meta: { label: elseLabel }, hint: 'Else branch label.' });
  if (stmt.alternate) lowerStatement(ctx, stmt.alternate);
  emit(ctx, 'LABEL', [endLabel], stmt, { text: `${endLabel}:`, meta: { label: endLabel }, hint: 'End of if statement.' });
}

function lowerWhile(ctx, stmt) {
  const startLabel = freshLabel(ctx, 'while');
  const endLabel = freshLabel(ctx, 'endwhile');
  emit(ctx, 'LABEL', [startLabel], stmt, { text: `${startLabel}:`, meta: { label: startLabel }, hint: 'Loop condition label.' });
  compileExpression(ctx, stmt.test, 'R0');
  emit(ctx, 'CMP', ['R0', imm(0)], stmt.test, { hint: 'Compare while condition with zero.' });
  emit(ctx, 'JZ', [endLabel], stmt, { hint: 'Exit while loop when the condition is zero.' });
  ctx.loopStack.push({ breakLabel: endLabel, continueLabel: startLabel });
  lowerStatement(ctx, stmt.body);
  ctx.loopStack.pop();
  emit(ctx, 'JMP', [startLabel], stmt, { hint: 'Jump back to the while condition.' });
  emit(ctx, 'LABEL', [endLabel], stmt, { text: `${endLabel}:`, meta: { label: endLabel }, hint: 'End of while loop.' });
}

function lowerFor(ctx, stmt) {
  if (stmt.init) lowerStatement(ctx, stmt.init);
  const conditionLabel = freshLabel(ctx, 'for');
  const updateLabel = freshLabel(ctx, 'for_update');
  const endLabel = freshLabel(ctx, 'endfor');
  emit(ctx, 'LABEL', [conditionLabel], stmt, { text: `${conditionLabel}:`, meta: { label: conditionLabel }, hint: 'for-loop condition label.' });
  if (stmt.test) {
    compileExpression(ctx, stmt.test, 'R0');
    emit(ctx, 'CMP', ['R0', imm(0)], stmt.test, { hint: 'Compare for-loop condition with zero.' });
    emit(ctx, 'JZ', [endLabel], stmt, { hint: 'Exit for-loop when the condition is zero.' });
  }
  ctx.loopStack.push({ breakLabel: endLabel, continueLabel: updateLabel });
  lowerStatement(ctx, stmt.body);
  ctx.loopStack.pop();
  emit(ctx, 'LABEL', [updateLabel], stmt, { text: `${updateLabel}:`, meta: { label: updateLabel }, hint: 'for-loop update label.' });
  if (stmt.update) compileExpression(ctx, stmt.update, 'R0');
  emit(ctx, 'JMP', [conditionLabel], stmt, { hint: 'Jump back to the for-loop condition.' });
  emit(ctx, 'LABEL', [endLabel], stmt, { text: `${endLabel}:`, meta: { label: endLabel }, hint: 'End of for-loop.' });
}

function compileExpression(ctx, expr, target = 'R0') {
  if (!expr) {
    emit(ctx, 'MOV', [target, imm(0)], null, { hint: 'Empty expression evaluates to 0.' });
    return target;
  }
  if (expr.kind === 'Literal') {
    if (expr.valueType === 'string') {
      const address = internString(ctx, expr.value, expr);
      emit(ctx, 'MOV', [target, imm(address)], expr, {
        hint: 'Load the address of a null-terminated string literal.',
      });
    } else {
      emit(ctx, 'MOV', [target, imm(toInt32(expr.value))], expr, { hint: `Load literal ${expr.value}.` });
    }
    return target;
  }
  if (expr.kind === 'Identifier') {
    if (expr.name === 'NULL') {
      emit(ctx, 'MOV', [target, imm(0)], expr, { hint: 'NULL is address 0 in the teaching VM.' });
      return target;
    }
    if (expr.name === 'EOF') {
      emit(ctx, 'MOV', [target, imm(-1)], expr, { hint: 'EOF is represented as -1.' });
      return target;
    }
    const symbol = ctx.scope.get(expr.name);
    if (symbol?.type?.arrayLength) {
      emit(ctx, 'LEA', [target, addrOf(symbol)], expr, {
        hint: `Array ${expr.name} decays to the address of its first element.`,
      });
    } else {
      emit(ctx, 'LOAD', [target, addrOf(symbol)], expr, {
        hint: `Read ${expr.name} from ${symbol?.kind === 'global' ? 'global memory' : 'the current stack frame'}.`,
        meta: { size: symbol?.type?.base === 'char' && !symbol?.type?.pointerDepth ? 1 : 4 },
      });
    }
    return target;
  }
  if (expr.kind === 'UnaryExpression') return compileUnary(ctx, expr, target);
  if (expr.kind === 'BinaryExpression') return compileBinary(ctx, expr, target);
  if (expr.kind === 'AssignmentExpression') return compileAssignment(ctx, expr, target);
  if (expr.kind === 'SubscriptExpression') {
    const addressReg = compileAddress(ctx, expr, 'R6');
    emit(ctx, 'LOAD', [target, regAddress(addressReg)], expr, {
      hint: 'Read through the computed array/pointer address.',
      meta: { size: elementSize(inferType(ctx, expr)) },
    });
    return target;
  }
  if (expr.kind === 'CallExpression') return compileCall(ctx, expr, target);
  emit(ctx, 'MOV', [target, imm(0)], expr, { hint: `Unsupported expression ${expr.kind} lowered to 0.` });
  return target;
}

function compileUnary(ctx, expr, target) {
  if (expr.operator === '&') {
    const addressReg = compileAddress(ctx, expr.argument, target);
    return addressReg;
  }
  if (expr.operator === '*') {
    const ptrReg = compileExpression(ctx, expr.argument, target);
    emit(ctx, 'LOAD', [target, regAddress(ptrReg)], expr, {
      hint: 'Dereference a pointer by loading from the address stored in the register.',
      meta: { size: elementSize(inferType(ctx, expr)) },
    });
    return target;
  }
  if (expr.operator === '-') {
    compileExpression(ctx, expr.argument, target);
    emit(ctx, 'SUB', [target, imm(0), target], expr, { hint: 'Unary minus subtracts the value from zero.' });
    return target;
  }
  if (expr.operator === '!') {
    compileExpression(ctx, expr.argument, target);
    emit(ctx, 'CMP', [target, imm(0)], expr, { hint: 'Logical not compares the value with zero.' });
    emit(ctx, 'MOV', [target, imm(0)], expr, {
      text: `MOV ${target}, !FLAGS.Z`,
      hint: 'Write 1 when the previous comparison was equal to zero, else 0.',
      meta: { kind: 'logicalNot' },
    });
    return target;
  }
  return compileExpression(ctx, expr.argument, target);
}

function compileBinary(ctx, expr, target) {
  const comparisonOps = new Set(['==', '!=', '<', '<=', '>', '>=']);
  const logicalOps = new Set(['&&', '||']);
  const rightHasCall = containsCall(expr.right);
  const leftReg = rightHasCall && target === 'R0' ? 'R4' : target;
  const rightReg = leftReg === target ? nextRegister(target) : 'R5';
  compileExpression(ctx, expr.left, leftReg);
  compileExpression(ctx, expr.right, rightReg);

  if (comparisonOps.has(expr.operator)) {
    emit(ctx, 'CMP', [leftReg, rightReg], expr, {
      hint: `Compare operands for ${expr.operator}.`,
    });
    emit(ctx, 'MOV', [target, imm(0)], expr, {
      text: `MOV ${target}, FLAGS(${expr.operator})`,
      hint: `Materialize comparison ${expr.operator} as 0 or 1.`,
      meta: { kind: 'comparisonResult', operator: expr.operator },
    });
    return target;
  }

  if (logicalOps.has(expr.operator)) {
    emit(ctx, 'MOV', [target, imm(0)], expr, {
      text: `MOV ${target}, ${leftReg} ${expr.operator} ${rightReg}`,
      hint: `Materialize logical ${expr.operator} as 0 or 1.`,
      meta: { kind: 'logicalResult', operator: expr.operator, left: leftReg, right: rightReg },
    });
    return target;
  }

  const opMap = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD' };
  emit(ctx, opMap[expr.operator] || 'ADD', [target, leftReg, rightReg], expr, {
    hint: `ALU ${expr.operator} operation writes its result and updates flags.`,
  });
  return target;
}

function compileAssignment(ctx, expr, target) {
  compileExpression(ctx, expr.right, target);
  const addressReg = compileAddress(ctx, expr.left, 'R6');
  emit(ctx, 'STORE', [regAddress(addressReg), target], expr, {
    hint: 'Assignment stores the value into the computed target address.',
    meta: { size: elementSize(inferType(ctx, expr.left)) },
  });
  return target;
}

function compileCall(ctx, expr, target) {
  const callee = expr.callee?.name;
  if (!callee) {
    emit(ctx, 'MOV', [target, imm(0)], expr, { hint: 'Unsupported indirect function call in this teaching subset.' });
    return target;
  }
  if (LIBRARY_CALLS.has(callee)) return compileLibraryCall(ctx, expr, target, callee);

  const args = expr.arguments || [];
  args.forEach((arg, index) => compileExpression(ctx, arg, `R${index}`));
  emit(ctx, 'CALL', [callee], expr, {
    hint: `CALL ${callee} creates a new stack frame and jumps to the function label.`,
    meta: { callee, argCount: args.length },
  });
  if (target !== 'R0') {
    emit(ctx, 'MOV', [target, 'R0'], expr, { hint: `Move ${callee}'s return value into ${target}.` });
  }
  return target;
}

function compileLibraryCall(ctx, expr, target, callee) {
  const args = expr.arguments || [];
  const emitInt = (vector, call, hint, meta = {}) => {
    emit(ctx, 'INT', [imm(vector)], expr, {
      text: `INT ${hex(vector)}  ; ${call}`,
      hint,
      meta: { call, ...meta },
    });
    if (target !== 'R0' && returnsValue(call)) emit(ctx, 'MOV', [target, 'R0'], expr, { hint: `Move ${call} return value to ${target}.` });
    return target;
  };

  if (callee === 'printf') {
    args.forEach((arg, index) => compileExpression(ctx, arg, `R${index}`));
    return emitInt(0x10, 'printf', 'Runtime stdout trap formats the string and appends to VM stdout.', { argCount: Math.max(0, args.length - 1) });
  }
  if (callee === 'puts') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x10, 'puts', 'Runtime stdout trap writes a string followed by a newline.', { argCount: 1 });
  }
  if (callee === 'putchar') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x10, 'putchar', 'Runtime stdout trap writes one character.', { argCount: 1 });
  }
  if (callee === 'malloc') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x20, 'malloc', 'Runtime heap trap allocates a block and returns its address in R0.', { argCount: 1 });
  }
  if (callee === 'free') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x21, 'free', 'Runtime heap trap marks a heap block free or reports an invalid free.', { argCount: 1 });
  }
  if (callee === 'fopen') {
    compileExpression(ctx, args[0], 'R0');
    compileExpression(ctx, args[1], 'R1');
    return emitInt(0x30, 'fopen', 'Runtime file trap opens a virtual file and returns a handle.', { argCount: 2 });
  }
  if (callee === 'fclose') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x31, 'fclose', 'Runtime file trap closes a virtual handle.', { argCount: 1 });
  }
  if (callee === 'fread') {
    args.forEach((arg, index) => compileExpression(ctx, arg, `R${index}`));
    return emitInt(0x32, 'fread', 'Runtime file trap reads bytes into a VM buffer.', { argCount: args.length });
  }
  if (callee === 'fwrite' || callee === 'fprintf') {
    args.forEach((arg, index) => compileExpression(ctx, arg, `R${index}`));
    return emitInt(0x33, callee, 'Runtime file trap writes bytes or formatted text into a virtual file.', { argCount: args.length - 2 });
  }
  if (callee === 'fgetc') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x34, 'fgetc', 'Runtime file trap reads one byte and advances the handle offset.', { argCount: 1 });
  }
  if (callee === 'fputc') {
    compileExpression(ctx, args[0], 'R0');
    compileExpression(ctx, args[1], 'R1');
    return emitInt(0x35, 'fputc', 'Runtime file trap writes one byte and advances the handle offset.', { argCount: 2 });
  }
  if (callee === 'rewind') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x36, 'rewind', 'Runtime file trap resets the handle offset to zero.', { argCount: 1 });
  }
  if (callee === 'strlen') {
    compileExpression(ctx, args[0], 'R0');
    return emitInt(0x50, 'strlen', 'Runtime string helper counts bytes until a null terminator.', { argCount: 1 });
  }
  if (callee === 'strcpy') {
    compileExpression(ctx, args[0], 'R0');
    compileExpression(ctx, args[1], 'R1');
    return emitInt(0x51, 'strcpy', 'Runtime string helper copies bytes including the null terminator.', { argCount: 2 });
  }
  if (callee === 'strcmp') {
    compileExpression(ctx, args[0], 'R0');
    compileExpression(ctx, args[1], 'R1');
    return emitInt(0x52, 'strcmp', 'Runtime string helper compares two null-terminated strings.', { argCount: 2 });
  }
  if (callee === 'memcpy') {
    args.forEach((arg, index) => compileExpression(ctx, arg, `R${index}`));
    return emitInt(0x53, 'memcpy', 'Runtime memory helper copies raw bytes.', { argCount: 3 });
  }
  return target;
}

function compileAddress(ctx, expr, target = 'R6') {
  if (!expr) {
    emit(ctx, 'MOV', [target, imm(0)], expr, { hint: 'Missing address expression resolved to null.' });
    return target;
  }
  if (expr.kind === 'Identifier') {
    const symbol = ctx.scope.get(expr.name);
    emit(ctx, 'LEA', [target, addrOf(symbol)], expr, {
      hint: `Compute the address of ${expr.name}.`,
    });
    return target;
  }
  if (expr.kind === 'UnaryExpression' && expr.operator === '*') {
    compileExpression(ctx, expr.argument, target);
    return target;
  }
  if (expr.kind === 'SubscriptExpression') {
    compileBaseAddress(ctx, expr.object, target);
    const indexReg = target === 'R6' ? 'R5' : 'R6';
    compileExpression(ctx, expr.index, indexReg);
    const scale = elementSize(inferType(ctx, expr));
    if (scale > 1) emit(ctx, 'MUL', [indexReg, indexReg, imm(scale)], expr, { hint: `Scale array index by element size ${scale}.` });
    emit(ctx, 'ADD', [target, target, indexReg], expr, {
      hint: 'Array indexing computes base address plus scaled index.',
    });
    return target;
  }
  compileExpression(ctx, expr, target);
  return target;
}

function compileBaseAddress(ctx, expr, target) {
  if (expr.kind === 'Identifier') {
    const symbol = ctx.scope.get(expr.name);
    if (symbol?.type?.arrayLength) emit(ctx, 'LEA', [target, addrOf(symbol)], expr, { hint: `Address of array ${expr.name}.` });
    else emit(ctx, 'LOAD', [target, addrOf(symbol)], expr, { hint: `Load pointer value ${expr.name}.` });
    return target;
  }
  return compileExpression(ctx, expr, target);
}

function inferType(ctx, expr) {
  if (!expr) return { base: 'int', pointerDepth: 0 };
  if (expr.kind === 'Identifier') return ctx.scope.get(expr.name)?.type || { base: 'int', pointerDepth: 0 };
  if (expr.kind === 'UnaryExpression' && expr.operator === '*') {
    const base = inferType(ctx, expr.argument);
    return { ...base, pointerDepth: Math.max(0, (base.pointerDepth || 0) - 1), arrayLength: null };
  }
  if (expr.kind === 'UnaryExpression' && expr.operator === '&') {
    const base = inferType(ctx, expr.argument);
    return { ...base, pointerDepth: (base.pointerDepth || 0) + 1, arrayLength: null };
  }
  if (expr.kind === 'SubscriptExpression') {
    const base = inferType(ctx, expr.object);
    return { ...base, pointerDepth: Math.max(0, (base.pointerDepth || 0) - 1), arrayLength: null };
  }
  if (expr.kind === 'Literal' && expr.valueType === 'string') return { base: 'char', pointerDepth: 1 };
  return { base: 'int', pointerDepth: 0 };
}

function containsCall(expr) {
  if (!expr) return false;
  if (expr.kind === 'CallExpression') return true;
  return containsCall(expr.left) || containsCall(expr.right) || containsCall(expr.argument) || containsCall(expr.object) || containsCall(expr.index)
    || (expr.arguments || []).some(containsCall);
}

function endsWithReturn(stmt) {
  if (!stmt) return false;
  if (stmt.kind === 'ReturnStatement') return true;
  if (stmt.kind === 'BlockStatement') return endsWithReturn((stmt.statements || [])[stmt.statements.length - 1]);
  return false;
}

function emit(ctx, op, args, astNode, options = {}) {
  const id = `I${String(++ctx.instructionSeq).padStart(4, '0')}`;
  const inst = {
    id,
    op,
    args,
    text: options.text || formatInstruction(op, args),
    sourceLine: astNode?.loc?.line || astNode?.line || 1,
    sourceColumn: astNode?.loc?.column || astNode?.column || 1,
    astNodeId: astNode?.id || '',
    explanationHint: options.hint || '',
    meta: options.meta || {},
  };
  ctx.instructions.push(inst);
  return inst;
}

function freshLabel(ctx, prefix) {
  ctx.labelSeq += 1;
  return `${prefix}_${ctx.labelSeq}`;
}

function internString(ctx, value, expr) {
  if (ctx.stringMap.has(value)) return ctx.stringMap.get(value).address;
  const bytes = [...value].map(ch => ch.charCodeAt(0) & 0xff).concat(0);
  const address = align(ctx.dataCursor, 1);
  const symbol = {
    name: `.str${ctx.stringLiterals.length}`,
    kind: 'string',
    type: { base: 'char', pointerDepth: 0, arrayLength: bytes.length, display: `char[${bytes.length}]` },
    address,
    size: bytes.length,
    value,
    bytes,
    sourceLine: expr?.loc?.line || 1,
  };
  ctx.stringLiterals.push(symbol);
  ctx.stringMap.set(value, symbol);
  ctx.dataCursor = align(address + bytes.length, 4);
  return address;
}

function addrOf(symbol) {
  if (!symbol) return { kind: 'absolute', address: 0, label: 'missing' };
  if (symbol.kind === 'global') return { kind: 'global', name: symbol.name, address: symbol.address, size: symbol.size };
  return { kind: 'local', name: symbol.name, offset: symbol.addressOffset || symbol.offset, size: symbol.size };
}

function imm(value) {
  return { kind: 'immediate', value: toInt32(value) };
}

function stringOperand(value) {
  return { kind: 'string', value };
}

function regAddress(register) {
  return { kind: 'registerAddress', register };
}

function typeSize(type) {
  if (!type) return 4;
  const base = type.pointerDepth > 0 || type.base === 'FILE' ? 4 : type.base === 'char' ? 1 : 4;
  if (type.arrayLength) return base * type.arrayLength;
  return base;
}

function elementSize(type) {
  if (!type) return 4;
  if (type.pointerDepth > 0) return type.base === 'char' ? 1 : 4;
  return type.base === 'char' ? 1 : 4;
}

function literalInitializer(expr) {
  if (!expr) return null;
  if (expr.kind === 'Literal') return expr.value;
  return null;
}

function returnsValue(call) {
  return !['printf', 'puts', 'putchar', 'free', 'fclose', 'fputc', 'fprintf', 'rewind'].includes(call);
}

function align(value, boundary = 4) {
  return Math.ceil(value / boundary) * boundary;
}

function nextRegister(register) {
  const n = Number(register.replace('R', ''));
  return `R${Math.min(7, n + 1)}`;
}

function formatInstruction(op, args) {
  if (op === 'LABEL') return `${args[0]}:`;
  return `${op} ${args.map(formatArg).join(', ')}`.trim();
}

function formatArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg?.kind === 'immediate') return Number.isInteger(arg.value) ? `#${arg.value}` : `#${String(arg.value)}`;
  if (arg?.kind === 'local' || arg?.kind === 'global' || arg?.kind === 'absolute' || arg?.kind === 'registerAddress') return formatAddress(arg);
  if (arg?.kind === 'string') return `"${escapeDisplay(arg.value)}"`;
  return String(arg);
}

function formatAddress(arg) {
  if (!arg) return '[?]';
  if (arg.kind === 'local') return `[FP-${arg.offset}]`;
  if (arg.kind === 'global') return `[${hex(arg.address)}:${arg.name}]`;
  if (arg.kind === 'absolute') return `[${hex(arg.address)}]`;
  if (arg.kind === 'registerAddress') return `[${arg.register}]`;
  return '[?]';
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(value <= 0xff ? 2 : 4, '0')}`;
}

function escapeDisplay(value) {
  return String(value).replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\0/g, '\\0').replace(/"/g, '\\"');
}

function toInt32(value) {
  return Number(value) | 0;
}

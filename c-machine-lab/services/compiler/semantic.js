import { diagnostic, warning } from './diagnostics.js';

const LIBRARY_FUNCTIONS = new Set([
  'printf', 'puts', 'putchar',
  'strlen', 'strcpy', 'strcmp', 'memcpy',
  'malloc', 'free',
  'fopen', 'fclose', 'fgetc', 'fputc', 'fread', 'fwrite', 'fprintf', 'rewind',
]);

export function analyze(ast) {
  const diagnostics = [];
  const functions = new Map();
  const globals = new Map();

  for (const decl of ast.declarations || []) {
    if (decl.kind === 'FunctionDeclaration') {
      if (functions.has(decl.name)) diagnostics.push(diagnostic(`function "${decl.name}" is already declared`, decl.loc));
      functions.set(decl.name, decl);
    } else if (decl.kind === 'GlobalDeclaration') {
      for (const item of decl.declarations) {
        if (globals.has(item.name)) diagnostics.push(diagnostic(`global "${item.name}" is already declared`, item.loc));
        globals.set(item.name, item);
      }
    }
  }

  if (!functions.has('main')) {
    diagnostics.push(diagnostic('program needs an int main() function to run in the VM', { line: 1, column: 1 }));
  }

  for (const fn of functions.values()) {
    const scope = new Map(globals);
    for (const param of fn.params) scope.set(param.name, param);
    checkBlock(fn.body, scope, functions, diagnostics);
  }

  return {
    diagnostics,
    functions,
    globals,
    libraryFunctions: LIBRARY_FUNCTIONS,
  };
}

function checkBlock(block, scope, functions, diagnostics) {
  const localScope = new Map(scope);
  for (const stmt of block?.statements || []) checkStatement(stmt, localScope, functions, diagnostics);
}

function checkStatement(stmt, scope, functions, diagnostics) {
  if (!stmt) return;
  if (stmt.kind === 'BlockStatement') return checkBlock(stmt, scope, functions, diagnostics);
  if (stmt.kind === 'VariableDeclaration') {
    for (const decl of stmt.declarations) {
      if (scope.has(decl.name)) diagnostics.push(warning(`"${decl.name}" shadows an earlier symbol`, decl.loc, 'CML-SHADOW'));
      scope.set(decl.name, decl);
      checkExpression(decl.init, scope, functions, diagnostics);
    }
    return;
  }
  if (stmt.kind === 'ExpressionStatement') return checkExpression(stmt.expression, scope, functions, diagnostics);
  if (stmt.kind === 'ReturnStatement') return checkExpression(stmt.argument, scope, functions, diagnostics);
  if (stmt.kind === 'IfStatement') {
    checkExpression(stmt.test, scope, functions, diagnostics);
    checkStatement(stmt.consequent, new Map(scope), functions, diagnostics);
    checkStatement(stmt.alternate, new Map(scope), functions, diagnostics);
    return;
  }
  if (stmt.kind === 'WhileStatement') {
    checkExpression(stmt.test, scope, functions, diagnostics);
    checkStatement(stmt.body, new Map(scope), functions, diagnostics);
    return;
  }
  if (stmt.kind === 'ForStatement') {
    const loopScope = new Map(scope);
    checkStatement(stmt.init, loopScope, functions, diagnostics);
    checkExpression(stmt.test, loopScope, functions, diagnostics);
    checkExpression(stmt.update, loopScope, functions, diagnostics);
    checkStatement(stmt.body, loopScope, functions, diagnostics);
  }
}

function checkExpression(expr, scope, functions, diagnostics) {
  if (!expr) return;
  if (expr.kind === 'Identifier') {
    if (expr.name === 'NULL' || expr.name === 'EOF') return;
    if (!scope.has(expr.name) && !functions.has(expr.name) && !LIBRARY_FUNCTIONS.has(expr.name)) {
      diagnostics.push(diagnostic(`unknown symbol "${expr.name}"`, expr.loc));
    }
    return;
  }
  if (expr.kind === 'BinaryExpression' || expr.kind === 'AssignmentExpression') {
    checkExpression(expr.left, scope, functions, diagnostics);
    checkExpression(expr.right, scope, functions, diagnostics);
    return;
  }
  if (expr.kind === 'UnaryExpression') return checkExpression(expr.argument, scope, functions, diagnostics);
  if (expr.kind === 'SubscriptExpression') {
    checkExpression(expr.object, scope, functions, diagnostics);
    checkExpression(expr.index, scope, functions, diagnostics);
    return;
  }
  if (expr.kind === 'CallExpression') {
    checkExpression(expr.callee, scope, functions, diagnostics);
    for (const arg of expr.arguments || []) checkExpression(arg, scope, functions, diagnostics);
  }
}

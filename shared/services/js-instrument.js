// Shared JS instrumentation — parses JS with Acorn and inserts `__trace(varName, value, loc)`
// calls at assignments, variable declarations, updates, and at loop iteration
// boundaries. The transformed source can then be executed via `new Function(...)`
// with a caller-supplied `__trace` implementation, producing a trace stream
// shaped like `{ t, var, value, line }`.
//
// This module is consumed by the Algorithm Visualizer (spec 42). The design is
// intentionally conservative: instead of mutating the AST, we collect textual
// insertions keyed by character offset and splice them into the original source
// in reverse order. That keeps line numbers and any associated source map-like
// information aligned with the input.

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const HELPER_NAME = '__trace';
const ITER_HELPER = '__iter';
const WRITER_HELPER = '__ss.registerWriter';

const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice',
  'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'add', 'delete', 'clear',
]);

/**
 * Transform `source` (a JavaScript program string) into an instrumented variant.
 * Returns { code, helperName, iterHelper, stats } or throws if the source cannot
 * be parsed.
 */
export function instrument(source, options = {}) {
  const helperName = options.helperName || HELPER_NAME;
  const iterHelper = options.iterHelper || ITER_HELPER;
  const withWriters = !!options.withWriters;
  const writerHelper = options.writerHelper || WRITER_HELPER;

  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });

  // Collect insertions: { pos, text, priority } — applied in reverse pos order
  // so earlier positions remain valid. When two inserts share a position,
  // higher priority goes physically later (so priority=2 appears *after*
  // priority=1 text).
  const inserts = [];
  const stats = { assignments: 0, declarations: 0, updates: 0, loops: 0, writers: 0 };
  const writers = [];

  walk.ancestor(ast, {
    // Declarations — emit one trace per declarator after the whole statement.
    VariableDeclaration(node, ancestors) {
      // Skip declarations that sit inside a for-header (ForStatement.init,
      // ForOfStatement.left, ForInStatement.left). Appending a statement there
      // would produce `for (let i = 0 <TRACE>; ...)` — a parse error.
      const parent = ancestors[ancestors.length - 2];
      if (parent && (
        parent.type === 'ForStatement' ||
        parent.type === 'ForOfStatement' ||
        parent.type === 'ForInStatement'
      )) return;
      const traces = [];
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier' && d.init) {
          traces.push(makeTraceCall(helperName, d.id.name, d.id.name, node.loc.start.line));
          stats.declarations++;
        }
      }
      if (traces.length) {
        inserts.push({ pos: node.end, text: '\n' + traces.join('\n') + '\n', priority: 1 });
      }
      // Writer registry — only top-level (program-scope) bindings, only `let`/`var`.
      if (withWriters && node.kind !== 'const') {
        const programParent = ancestors[0];
        const isTopLevel = programParent && programParent.type === 'Program' && parent === programParent;
        if (isTopLevel) {
          for (const d of node.declarations) {
            if (d.id.type === 'Identifier') {
              const name = d.id.name;
              writers.push(name);
              const reg = `try{if(typeof ${writerHelper.split('.')[0]}!=='undefined')${writerHelper}(${JSON.stringify(name)},function(__v){${name}=__v;${makeTraceCall(helperName, name, name, node.loc.start.line)}});}catch(__e__){}`;
              inserts.push({ pos: node.end, text: '\n' + reg, priority: 1 });
              stats.writers++;
            }
          }
        }
      }
    },
    ExpressionStatement(node, ancestors) {
      const expr = node.expression;
      if (expr.type === 'AssignmentExpression') {
        const trace = assignmentTrace(expr, helperName, node.loc.start.line);
        if (trace) {
          inserts.push({ pos: node.end, text: '\n' + trace, priority: 1 });
          stats.assignments++;
        }
      } else if (expr.type === 'UpdateExpression' && expr.argument.type === 'Identifier') {
        inserts.push({
          pos: node.end,
          text: '\n' + makeTraceCall(helperName, expr.argument.name, expr.argument.name, node.loc.start.line),
          priority: 1,
        });
        stats.updates++;
      } else if (expr.type === 'CallExpression') {
        // Mutating method call on an identifier — e.g. `queue.push(x)`.
        const callee = expr.callee;
        if (callee?.type === 'MemberExpression' &&
            callee.object?.type === 'Identifier' &&
            callee.property?.type === 'Identifier' &&
            MUTATING_METHODS.has(callee.property.name)) {
          inserts.push({
            pos: node.end,
            text: '\n' + makeTraceCall(helperName, callee.object.name, callee.object.name, node.loc.start.line),
            priority: 1,
          });
          stats.assignments++;
        }
      } else if (expr.type === 'SequenceExpression') {
        // Swaps / chained assignments inside a single statement.
        for (const sub of expr.expressions) {
          if (sub.type === 'AssignmentExpression') {
            const trace = assignmentTrace(sub, helperName, node.loc.start.line);
            if (trace) {
              inserts.push({ pos: node.end, text: '\n' + trace, priority: 1 });
              stats.assignments++;
            }
          }
        }
      }
    },
    // ForStatement / WhileStatement / DoWhileStatement — prepend an iteration trace
    // inside the body. We wrap the body into a BlockStatement if it isn't one,
    // by inserting text at the body.start.
    ForStatement: forLikeHandler,
    WhileStatement: forLikeHandler,
    DoWhileStatement: forLikeHandler,
    ForInStatement: forLikeHandler,
    ForOfStatement: forLikeHandler,
  });

  function forLikeHandler(node) {
    const body = node.body;
    if (!body) return;
    stats.loops++;
    const line = node.loc.start.line;
    const iterCall = `${iterHelper}(${JSON.stringify(node.type)}, ${line});`;
    if (body.type === 'BlockStatement') {
      // Insert right after the '{'.
      const openBracePos = body.start + 1;
      inserts.push({ pos: openBracePos, text: '\n' + iterCall, priority: 2 });
      // Also, for a for(... ; ...; update) loop, trace the update variable at
      // the end of each iteration if the update is a simple identifier update.
      if (node.type === 'ForStatement' && node.update) {
        const u = node.update;
        if (u.type === 'UpdateExpression' && u.argument.type === 'Identifier') {
          inserts.push({
            pos: body.end - 1,
            text: makeTraceCall(helperName, u.argument.name, u.argument.name, line) + '\n',
            priority: 2,
          });
        }
      }
    } else {
      // Wrap a single-statement body in a block.
      inserts.push({ pos: body.start, text: '{ ' + iterCall + ' ', priority: 3 });
      inserts.push({ pos: body.end, text: ' }', priority: 3 });
    }
    // For-of / for-in: trace the loop variable.
    if ((node.type === 'ForOfStatement' || node.type === 'ForInStatement')) {
      const left = node.left;
      let name = null;
      if (left.type === 'VariableDeclaration' && left.declarations[0]?.id.type === 'Identifier') {
        name = left.declarations[0].id.name;
      } else if (left.type === 'Identifier') {
        name = left.name;
      }
      if (name && body.type === 'BlockStatement') {
        inserts.push({
          pos: body.start + 1,
          text: '\n' + makeTraceCall(helperName, name, name, line),
          priority: 2,
        });
      }
    }
  }

  // Apply insertions in reverse position order.
  inserts.sort((a, b) => b.pos - a.pos || b.priority - a.priority);
  let out = source;
  for (const ins of inserts) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }
  return { code: out, helperName, iterHelper, stats, writers };
}

function makeTraceCall(helper, label, exprText, line) {
  const safeLabel = JSON.stringify(label);
  return `try{${helper}(${safeLabel}, ${exprText}, ${line});}catch(__e__){}`;
}

// Build a trace call for an AssignmentExpression. Handles:
//   a = v           → trace("a", a)
//   a.b = v         → trace("a", a)
//   a[i] = v        → trace("a", a)
// Compound assignments (`+=`, `-=`, etc.) are treated the same as `=` since
// the left side still ends up with the new value.
function assignmentTrace(expr, helper, line) {
  const target = expr.left;
  if (!target) return null;
  if (target.type === 'Identifier') {
    return makeTraceCall(helper, target.name, target.name, line);
  }
  if (target.type === 'MemberExpression' && target.object && target.object.type === 'Identifier') {
    return makeTraceCall(helper, target.object.name, target.object.name, line);
  }
  return null;
}

/**
 * Execute instrumented `code` inside a fresh Function, collecting trace events.
 * Returns { events, error, stats } where events is a chronological list of
 * `{ t, var, value, line }` or `{ t, kind: 'iter', line }` entries.
 */
export function runInstrumented(code, { maxEvents = 50000, helperName = HELPER_NAME, iterHelper = ITER_HELPER, timeoutMs = 10000 } = {}) {
  const events = [];
  let t = 0;
  let overrun = false;
  const start = performance.now();

  function trace(name, value, line) {
    if (overrun) return;
    if (events.length >= maxEvents) { overrun = true; return; }
    if (performance.now() - start > timeoutMs) { overrun = true; return; }
    events.push({ t: t++, var: name, value: cloneForTrace(value), line });
  }
  function iter(kind, line) {
    if (overrun) return;
    if (events.length >= maxEvents) { overrun = true; return; }
    events.push({ t: t++, kind: 'iter', loopKind: kind, line });
  }

  try {
    // Wrap in an IIFE to allow top-level return/await (await disabled — sync only).
    const fn = new Function(helperName, iterHelper, `"use strict";\n${code}\n`);
    fn(trace, iter);
  } catch (err) {
    return { events, error: err && err.message ? err.message : String(err), overrun, stats: { events: events.length } };
  }
  return { events, error: null, overrun, stats: { events: events.length } };
}

// Deep-clone a value for trace capture. Functions/DOM nodes become descriptors;
// large objects are truncated. Strings keep their length. The goal is a cheap
// immutable snapshot that the visualiser can safely render.
export function cloneForTrace(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return value;
  if (t === 'bigint') return { __bigint: value.toString() };
  if (t === 'function') return { __fn: value.name || '(anon)' };
  if (t === 'symbol') return { __sym: value.toString() };
  if (depth > 4) return { __truncated: true };
  if (Array.isArray(value)) {
    if (seen.has(value)) return { __circular: true };
    seen.add(value);
    if (value.length > 1024) return { __array: value.slice(0, 1024).map(v => cloneForTrace(v, depth + 1, seen)), __truncated: value.length };
    return value.map(v => cloneForTrace(v, depth + 1, seen));
  }
  if (t === 'object') {
    if (seen.has(value)) return { __circular: true };
    seen.add(value);
    if (value instanceof Map) {
      const out = {};
      let i = 0;
      for (const [k, v] of value.entries()) {
        if (i++ > 256) { out.__truncated = true; break; }
        out[String(k)] = cloneForTrace(v, depth + 1, seen);
      }
      return { __map: out };
    }
    if (value instanceof Set) {
      const arr = [];
      let i = 0;
      for (const v of value.values()) {
        if (i++ > 1024) break;
        arr.push(cloneForTrace(v, depth + 1, seen));
      }
      return { __set: arr };
    }
    const out = {};
    let i = 0;
    for (const key of Object.keys(value)) {
      if (i++ > 64) { out.__truncated = true; break; }
      out[key] = cloneForTrace(value[key], depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

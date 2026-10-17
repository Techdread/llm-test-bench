// JS/TS parser — Acorn for JS, a tolerant TS-aware pass for TypeScript.
//
// TypeScript syntax (types, generics, as-casts, decorators, enums) is stripped
// to a best-effort approximation and then parsed as JS. This is syntactic
// only — no type checks. Lines/columns are preserved so source↔AST linking
// still works on the original text.

import * as acorn from 'acorn';
import * as acornLoose from 'acorn-loose';

const BASE_OPTS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
  ranges: true,
  allowHashBang: true,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
};

export function parse(source, language = 'js') {
  const opts = { ...BASE_OPTS };
  let text = source;
  let tsStripped = false;
  if (language === 'ts' || language === 'tsx') {
    text = stripTypescript(source);
    tsStripped = true;
    if (language === 'tsx') opts.ecmaVersion = 'latest';
  }
  try {
    const ast = acorn.parse(text, opts);
    return { ast, error: null, loose: false, tsStripped };
  } catch (err) {
    try {
      const ast = acornLoose.parse(text, opts);
      return {
        ast,
        error: { message: err.message, line: err.loc?.line, column: err.loc?.column, pos: err.pos },
        loose: true,
        tsStripped,
      };
    } catch (err2) {
      return { ast: null, error: { message: err2.message || String(err2) }, loose: false, tsStripped };
    }
  }
}

// Very lightweight TypeScript-to-JS stripping. Replaces type annotations and
// constructs with whitespace of the same length so character offsets line up
// with the original source. Covers most common cases. Not a real TS compiler.
export function stripTypescript(src) {
  let out = src;

  // 1) Drop `as <Type>` and `satisfies <Type>` expressions.
  out = out.replace(/\b(as|satisfies)\s+([A-Za-z_$][\w$.<>[\]|&,\s'"]*)/g, (m) => ' '.repeat(m.length));

  // 2) Drop `<Generic>` type arguments on call/new (heuristic: `foo<T>(`).
  out = out.replace(/([A-Za-z_$][\w$]*)<[^<>]*?>(?=\s*\()/g, (m, name) => name + ' '.repeat(m.length - name.length));

  // 3) Strip `: Type` annotations on parameters, locals, return types.
  //    Heuristic: walk the string, drop from `:` to the first terminator when in a type context.
  out = stripColonTypes(out);

  // 4) Remove `<T>` generic parameter lists on functions/classes: `function foo<T>(`, `class Foo<T>`, `interface X<T>`.
  out = out.replace(/(function\s+\*?\s*[A-Za-z_$][\w$]*)\s*<[^<>]*>/g, (m, head) => head + ' '.repeat(m.length - head.length));
  out = out.replace(/((?:class|interface)\s+[A-Za-z_$][\w$]*)\s*<[^<>]*>/g, (m, head) => head + ' '.repeat(m.length - head.length));

  // 5) Drop `public|private|protected|readonly|override` modifiers.
  out = out.replace(/\b(public|private|protected|readonly|override|declare)\b/g, (m) => ' '.repeat(m.length));

  // 6) Drop entire `interface X { … }` and `type X = …;` declarations (preserve length).
  out = blankOutDeclarations(out);

  // 7) Drop `implements X, Y` on classes.
  out = out.replace(/\bimplements\b[^{]*?(?=\{)/g, (m) => ' '.repeat(m.length));

  // 8) Drop `?:` → `:` for optional params/properties.
  out = out.replace(/\?\s*:/g, '  ');

  // 9) Non-null assertion `!` in expressions → space. Heuristic.
  out = out.replace(/([A-Za-z_$\]\)\]])!([.\(;,\)\]\s])/g, '$1 $2');

  return out;
}

function stripColonTypes(src) {
  const out = src.split('');
  let depth = 0;
  let inStr = null;
  let inTmpl = 0;
  let inCmt = null;
  let i = 0;
  while (i < out.length) {
    const c = out[i];
    const c2 = out[i + 1];
    // String + comment handling
    if (inCmt === 'line') { if (c === '\n') inCmt = null; i++; continue; }
    if (inCmt === 'block') {
      if (c === '*' && c2 === '/') { inCmt = null; i += 2; continue; }
      i++; continue;
    }
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (inTmpl > 0) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') inTmpl--;
      i++; continue;
    }
    if (c === '/' && c2 === '/') { inCmt = 'line'; i += 2; continue; }
    if (c === '/' && c2 === '*') { inCmt = 'block'; i += 2; continue; }
    if (c === '"' || c === "'") { inStr = c; i++; continue; }
    if (c === '`') { inTmpl++; i++; continue; }

    if (c === ':' && depth === 0) {
      // Look back to see if this is a type annotation context (param list, var decl).
      // If the nearest non-whitespace char is `?`, `)`, `]`, an ident, we assume annotation.
      const start = i;
      let j = i + 1;
      // Skip whitespace.
      while (j < out.length && /\s/.test(out[j])) j++;
      // Blank out until terminator.
      let typeDepth = 0;
      while (j < out.length) {
        const ch = out[j];
        if (ch === '<' || ch === '(' || ch === '[' || ch === '{') typeDepth++;
        else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') {
          if (typeDepth === 0) break;
          typeDepth--;
        } else if (typeDepth === 0 && (ch === ',' || ch === ';' || ch === '=' || ch === '\n')) break;
        j++;
      }
      for (let k = start; k < j; k++) {
        if (out[k] !== '\n') out[k] = ' ';
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

function blankOutDeclarations(src) {
  let out = src;
  // interface X … { … }
  out = out.replace(/\binterface\s+[A-Za-z_$][\w$<>,\s]*\{[\s\S]*?\n\}/g, (m) => m.replace(/[^\n]/g, ' '));
  // type X = … ;
  out = out.replace(/\btype\s+[A-Za-z_$][\w$<>,=\s]*=[\s\S]*?;/g, (m) => m.replace(/[^\n]/g, ' '));
  return out;
}

// ── Tree model ────────────────────────────────────────────────────────────
// Convert an Acorn AST into a lightweight tree that's easy to render:
//   { id, kind, label, range, loc, node, children: [{ field, nodes: [...] }] }
// Also returns a flat id→entry map for fast lookup.

export function buildTree(ast, source) {
  if (!ast) return { root: null, byId: new Map(), byRange: [] };
  const byId = new Map();
  const byRange = [];
  let idCounter = 0;

  function walk(node, field) {
    if (!node || typeof node !== 'object' || !node.type) return null;
    const id = String(idCounter++);
    const entry = {
      id,
      kind: node.type,
      label: summariseNode(node, source),
      range: node.range || (node.start != null && node.end != null ? [node.start, node.end] : null),
      loc: node.loc || null,
      node,
      children: [],
      field,
    };
    byId.set(id, entry);
    if (entry.range) byRange.push(entry);

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
      const val = node[key];
      if (!val) continue;
      if (Array.isArray(val)) {
        const kids = [];
        for (const item of val) {
          const sub = walk(item, key);
          if (sub) kids.push(sub);
        }
        if (kids.length) entry.children.push({ field: key, nodes: kids });
      } else if (typeof val === 'object' && val.type) {
        const sub = walk(val, key);
        if (sub) entry.children.push({ field: key, nodes: [sub] });
      }
    }
    return entry;
  }

  const root = walk(ast, null);
  // Sort by range length (outer before inner) for picking-by-offset.
  byRange.sort((a, b) => (a.range[1] - a.range[0]) - (b.range[1] - b.range[0]));
  return { root, byId, byRange };
}

function summariseNode(n, src) {
  if (!n) return '';
  switch (n.type) {
    case 'Identifier': return n.name;
    case 'Literal': return typeof n.value === 'string' ? JSON.stringify(n.value) : String(n.raw ?? n.value);
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return n.id?.name ? `fn ${n.id.name}` : 'fn';
    case 'VariableDeclaration':
      return `${n.kind} ${(n.declarations || []).map(d => d.id?.name).filter(Boolean).join(', ')}`;
    case 'ClassDeclaration':
    case 'ClassExpression':
      return n.id?.name ? `class ${n.id.name}` : 'class';
    case 'ImportDeclaration': return `from ${n.source?.raw || ''}`;
    case 'ExportNamedDeclaration': return 'export';
    case 'CallExpression': return 'call';
    case 'MemberExpression': return `.${n.property?.name || ''}`;
    case 'BinaryExpression':
    case 'LogicalExpression': return n.operator;
    default: return '';
  }
}

// ── Selection mapping ─────────────────────────────────────────────────────

/** Find the innermost AST node whose range contains `offset`. */
export function findNodeAtOffset(tree, offset) {
  if (!tree || !tree.byRange) return null;
  let best = null;
  for (const entry of tree.byRange) {
    if (entry.range[0] <= offset && offset < entry.range[1]) {
      if (!best || (entry.range[1] - entry.range[0]) < (best.range[1] - best.range[0])) {
        best = entry;
      }
    }
  }
  return best;
}

/** Convert `{ start, end }` offsets into Ace line/col range. */
export function offsetsToLineCol(source, start, end) {
  let line = 0, col = 0, startLC = null;
  for (let i = 0; i <= source.length; i++) {
    if (i === start) startLC = { line, col };
    if (i === end) return { start: startLC || { line, col }, end: { line, col } };
    if (source[i] === '\n') { line++; col = 0; } else { col++; }
  }
  return { start: startLC || { line: 0, col: 0 }, end: { line, col } };
}

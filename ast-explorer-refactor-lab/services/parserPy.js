// Python parser — lazy-loads Pyodide on demand and uses the stdlib `ast`
// module to parse source into a JSON-serialisable tree.
//
// Pyodide is ~10 MB so we only bring it up the first time Python is selected.

import {
  loadPyodide as sharedLoadPyodide,
  getPyodide as sharedGetPyodide,
} from '../../shared/services/pyodide-runtime.js';

const PYODIDE_VERSION = '0.25.1';
let astHelperInstalled = false;

export function isPyodideReady() { return sharedGetPyodide() !== null; }

export async function ensurePyodide(onProgress) {
  const py = await sharedLoadPyodide({ version: PYODIDE_VERSION, onStatus: onProgress });
  if (!astHelperInstalled) {
    onProgress?.('Bootstrapping ast helper…');
    await py.runPythonAsync(AST_HELPER);
    astHelperInstalled = true;
  }
  return py;
}

const AST_HELPER = `
import ast, json

def _pos(node, src_lines):
    if not hasattr(node, 'lineno'):
        return None, None
    start = _to_offset(src_lines, node.lineno, node.col_offset)
    end_line = getattr(node, 'end_lineno', None)
    end_col = getattr(node, 'end_col_offset', None)
    end = _to_offset(src_lines, end_line, end_col) if end_line is not None else start
    return start, end

def _to_offset(lines, line, col):
    if line is None: return None
    # lines is a prefix-sum list of char offsets to start of each 1-indexed line.
    return lines[line - 1] + col if line - 1 < len(lines) else None

def _prefix_sums(src):
    out = [0]
    acc = 0
    for ch in src:
        acc += 1
        if ch == '\\n':
            out.append(acc)
    return out

def _summarise(node):
    t = type(node).__name__
    if t == 'Name': return node.id
    if t == 'Constant':
        v = node.value
        if isinstance(v, str): return json.dumps(v)
        return repr(v)
    if t == 'FunctionDef' or t == 'AsyncFunctionDef': return 'fn ' + node.name
    if t == 'ClassDef': return 'class ' + node.name
    if t == 'ImportFrom': return 'from ' + (node.module or '.')
    if t == 'Import': return ','.join(a.name for a in node.names)
    if t == 'arg': return node.arg
    if t == 'Attribute': return '.' + node.attr
    if t == 'Call': return 'call'
    if t == 'BinOp': return type(node.op).__name__
    if t == 'Compare': return 'compare'
    return ''

def ast_to_json(src):
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return json.dumps({ 'error': { 'message': str(e), 'line': e.lineno, 'column': e.offset } })
    lines = _prefix_sums(src)

    def convert(node, field=None):
        if not isinstance(node, ast.AST):
            return None
        start, end = _pos(node, lines)
        obj = { 'type': type(node).__name__, 'field': field, 'label': _summarise(node), 'start': start, 'end': end, 'children': [] }
        for name, value in ast.iter_fields(node):
            if isinstance(value, list):
                kids = [c for c in (convert(v, name) for v in value) if c is not None]
                if kids:
                    obj['children'].append({ 'field': name, 'nodes': kids })
            elif isinstance(value, ast.AST):
                kid = convert(value, name)
                if kid:
                    obj['children'].append({ 'field': name, 'nodes': [kid] })
            else:
                # Only show scalar fields on leaf-ish nodes for brevity.
                if name in ('id', 'name', 'arg', 'attr'):
                    obj.setdefault('attrs', {})[name] = value
                elif name == 'value' and type(node).__name__ == 'Constant':
                    obj.setdefault('attrs', {})['value'] = value if isinstance(value, (int, float, bool)) or value is None else str(value)
        return obj

    root = convert(tree, None)
    return json.dumps({ 'root': root })
`;

export async function parse(source) {
  try {
    const py = await ensurePyodide();
    py.globals.set('__ast_src', source);
    const json = await py.runPythonAsync('ast_to_json(__ast_src)');
    const data = JSON.parse(json);
    if (data.error) return { ast: null, error: data.error, loose: false, tsStripped: false };
    return { ast: data.root, error: null, loose: false, tsStripped: false };
  } catch (err) {
    return { ast: null, error: { message: err.message || String(err) }, loose: false, tsStripped: false };
  }
}

// Turn the Python-side tree into the same shape as the JS one (entry/byId/byRange).
export function buildTree(rootRaw) {
  if (!rootRaw) return { root: null, byId: new Map(), byRange: [] };
  const byId = new Map();
  const byRange = [];
  let idCounter = 0;

  function walk(n, field) {
    if (!n) return null;
    const id = String(idCounter++);
    const range = (n.start != null && n.end != null) ? [n.start, n.end] : null;
    const entry = {
      id,
      kind: n.type,
      label: n.label || '',
      range,
      loc: null,
      node: { type: n.type, ...n.attrs, start: n.start, end: n.end },
      field: field || n.field,
      children: (n.children || []).map(group => ({
        field: group.field,
        nodes: group.nodes.map(k => walk(k, group.field)).filter(Boolean),
      })).filter(g => g.nodes.length > 0),
    };
    byId.set(id, entry);
    if (entry.range) byRange.push(entry);
    return entry;
  }

  const root = walk(rootRaw, null);
  byRange.sort((a, b) => (a.range[1] - a.range[0]) - (b.range[1] - b.range[0]));
  return { root, byId, byRange };
}

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

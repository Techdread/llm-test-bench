// generationContext — what a model is told about the notebook when it writes a cell.
//
// Two gaps made prompt-built notebooks unreliable. The HTML-cell contract never
// mentioned the `nb` bridge, so a model asked for "a live view of the controls"
// could not know nb.get / nb.onChange exist in the iframe. And the model only
// saw the last few cells' source, never the values in `nb`, so "draw nb.sprite"
// meant guessing the data's shape. Both are filled in here, shared by the
// OpenRouter-style path and the CLI-agent path.

/** How an HTML cell talks to the notebook. */
export const HTML_NB_BRIDGE_GUIDE = [
  'The iframe has a global `nb` object linked to the notebook:',
  '`nb.get(key, fallback)` reads a notebook variable, `nb.set(key, value)` writes one,',
  'and `nb.onChange(fn)` calls fn whenever any variable changes, including when the user moves a UI control.',
  'To make a live view, draw from nb.get inside a function, call it once, and pass it to nb.onChange.',
  'Never call nb.set inside an onChange handler (it loops).',
  'The iframe is sandboxed: downloads, the clipboard, pop-ups and localStorage are blocked, so keep data in nb.',
  'Give html and body margin 0 and a background colour (the frame shows white otherwise), and set your own text colours so the cell reads well in light and dark themes.',
  'It may be shown on a phone, as narrow as 340 pixels: let columns wrap, give canvases max-width: 100% and height: auto (and map pointer positions through getBoundingClientRect), and size full-frame 3D views from window.innerWidth and innerHeight with a resize handler.',
].join(' ');

/** What a JavaScript cell's return value does. */
export const JS_RETURN_GUIDE = 'Whatever the cell `return`s is shown: return an HTML string to render a card or table '
  + '(it renders in its own sandboxed frame, so set your own colours), or a Vega-Lite spec object to draw an interactive chart. '
  + 'The cell runs as the body of a function, so write `return { ... }`: a bare object or value on its own is not shown, and a bare `{` is a syntax error. '
  + '`nb.get` returns a copy, so `nb.set` a changed value again to share it.';

/** How a Lua cell reaches the notebook (services/luaNb.js). */
export const LUA_NB_GUIDE = 'Lua cells share nb both ways: nb.get(key, default) returns a copy as plain Lua tables '
  + '(JSON lists become sequences that count from 1, objects become tables with string keys, null becomes nil), '
  + 'nb.set(key, value) shares numbers, text, booleans and tables (a sequence becomes a list), and nb.has(key) and nb.keys() also work.';

/** What a SQL cell runs against (services/sqlCell.js). */
export const SQL_GUIDE = 'SQL cells run SQLite in the browser. Every nb value that is a list of objects is a table of the same name '
  + '(its keys are the columns; nested values are stored as JSON text), and a list of plain values is a table with one column called value. '
  + 'Tables made by earlier SQL cells are still there. Each statement that returns rows is shown as a table. '
  + 'To save the last result to nb as a list of objects, add a comment line exactly like: -- save as: key_name. '
  + 'SQLite features such as window functions, strftime and json_extract work.';

/** The UI-cell options beyond the basic control list. */
export const UI_CONTROL_GUIDE = 'Also available: a "readout" control that displays a bound value; '
  + 'buttons with "action": "increment" (adds 1 to bind), "toggle" (flips bind), or a "set" object of fixed values; '
  + 'sliders and numbers take min, max and step, and sliders may add "prefix", "suffix" or "precision". '
  + 'Each control may give x, y, width and height in pixels; when they are omitted, controls are laid out three to a row.';

/** How C cells are compiled (xcc, to WebAssembly) and reach the notebook (<nb.h>). */
export const C_GUIDE = 'C cells are compiled to WebAssembly by xcc: C11 with structs, pointers, malloc and the standard library '
  + '(stdio.h, stdlib.h, string.h, math.h, time.h, ctype.h, stdint.h). long is 32 bits there, so use long long for big integers. '
  + 'To read and share notebook variables, #include <nb.h>: nb_get_number(key, fallback), nb_get_int(key, fallback), '
  + 'nb_get_string(key, buf, size), nb_get_doubles(key, out, max) and nb_get_ints(key, out, max) (these return the full length, or -1), '
  + 'nb_get_json(key, buf, size) and nb_has(key); then nb_set_number, nb_set_int, nb_set_string, nb_set_doubles(key, values, count), '
  + 'nb_set_ints and nb_set_json(key, json). Reads see nb as it was when the cell started; writes are shared when it ends.';

function shapeOf(value) {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty list';
    const first = value[0];
    const item = Array.isArray(first) ? 'list'
      : first && typeof first === 'object' ? 'object'
        : typeof first === 'string' ? 'text' : typeof first;
    const keys = item === 'object' ? ` (keys ${Object.keys(first).slice(0, 8).join(', ')})` : '';
    return `list of ${value.length} ${item}${value.length === 1 ? '' : 's'}${keys}`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `object with keys ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}`;
  }
  if (typeof value === 'string') return 'text';
  return typeof value;
}

function preview(value, max) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A short listing of the notebook's current variables for a generation prompt,
 * or '' when there are none.
 */
export function describeNotebookVariables(values, { maxKeys = 30, maxPreview = 160 } = {}) {
  const entries = Object.entries(values || {});
  if (entries.length === 0) return '';
  const lines = entries.slice(0, maxKeys).map(([key, value]) => `- ${key} (${shapeOf(value)}): ${preview(value, maxPreview)}`);
  if (entries.length > maxKeys) lines.push(`- …and ${entries.length - maxKeys} more`);
  return `Notebook variables in nb right now (read them with nb.get / nb["key"]; previews are truncated):\n${lines.join('\n')}`;
}

// ── Cell prompts (moved from openrouter.js so they can be built and tested without a browser) ──

const KIND_GUIDANCE = {
  md: 'Respond with Markdown only. No code fences around the outer Markdown.',
  js: 'Respond with a single JavaScript snippet. Use top-level await if needed. You may call `nb.set(key, value)` and `nb.get(key)` to share values between cells. Use `console.log` for output. ' + JS_RETURN_GUIDE,
  py: 'Respond with a single Python snippet runnable in Pyodide. matplotlib/numpy are available via `await micropip.install("numpy")` style setup only if needed (numpy/matplotlib are preloaded). Use `nb["key"] = value` / `nb["key"]` to share values with other cells. Print results you want to see.',
  c: 'Respond with a complete single-file C program with a main() function. Use printf/puts for output. ' + C_GUIDE,
  rust: 'Respond with a complete single-file Rust program with fn main(). Use println! for output and only the Rust standard library. This runs through remote Rust Playground execution. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  lua: 'Respond with a complete single-file Lua 5.4 program. Use print for output. It runs offline via the Wasmoon WebAssembly runtime (standard Lua only — no LuaJIT, no external rocks). ' + LUA_NB_GUIDE,
  java: 'Respond with a complete single-file Java program: one public class containing `public static void main(String[] args)`. It compiles with real OpenJDK (javac) and runs in a Debian VM. Use System.out.println for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  go: 'Respond with a complete single-file Go program in `package main` with `func main()`. It builds with the real Go toolchain in a Debian VM (standard library only, no external modules). Use the fmt package for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  scala: 'Respond with a complete single-file Scala 2.11-compatible program with `object Main { def main(args: Array[String]): Unit = ... }` or `object Main extends App`. It runs with real scalac in the browser-hosted Debian VM. Use println for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  clojure: 'Respond with a complete single-file Clojure program (Clojure 1.11, core library only — no deps.edn/Leiningen). It runs on the JVM in a Debian VM. Use (println ...) for output. To set a notebook variable, print a line exactly like: __NB_SET__ {"key":"answer","value":42}',
  html: 'Respond with a complete HTML fragment that will render inside a sandboxed iframe. Inline all CSS/JS. Do not include <html> or <head> tags. ' + HTML_NB_BRIDGE_GUIDE,
  ui: 'Respond with a single JSON object for a Notebook Lab UI cell. Shape: {"title":"...","description":"...","controls":[...]}. Supported control types: label, text, textarea, number, checkbox, select, radio, slider, color, date, button. Bind input controls with a "bind" key so they write to notebook variables. Include defaults for bound inputs. Select/radio options may be strings or {"label","value"} objects. ' + UI_CONTROL_GUIDE + ' No commentary, no code fences.',
  chart: 'Respond with a single Vega-Lite JSON spec (starting with `{`). No commentary, no code fences.',
  sql: 'Respond with SQLite SQL only, no commentary and no code fences; use -- comments to explain each step. ' + SQL_GUIDE,
};

/** The system prompt for writing one cell of `kind`. */
export function cellSystemPrompt(kind) {
  const base = 'You are an expert notebook assistant. Return ONLY the cell contents, with no prose, no commentary, and no markdown code fences around the whole output.';
  return `${base}\n\nCell kind: ${kind}\n${KIND_GUIDANCE[kind] || ''}`;
}

function priorCellsContext(contextCells = []) {
  if (!contextCells.length) return '';
  const trimmed = contextCells.slice(-4).map((c, i) => {
    const src = (c.source || '').slice(0, 600);
    const out = (c.lastOutputText || '').slice(0, 300);
    return `### Prior cell ${i + 1} [${c.kind}]\n${src}${out ? `\nOutput:\n${out}` : ''}`;
  }).join('\n\n');
  return `\n\nPrior notebook context (truncated):\n${trimmed}\n`;
}

// Plenty for any hand-sized cell; a pasted dataset is cut rather than flooding the prompt.
const MAX_CURRENT_SOURCE = 20000;

/**
 * The cell's existing code, when a prompt rewrites a cell that already has some.
 * Without it the model saw only the cells above, so "make the bars green" on a
 * hand-written cell threw the cell away and wrote a new one from scratch.
 */
export function currentCellText(source) {
  const text = String(source || '');
  if (!text.trim()) return '';
  const cut = text.length > MAX_CURRENT_SOURCE ? `${text.slice(0, MAX_CURRENT_SOURCE)}\n… (cut)` : text;
  return 'The cell already contains the code below. If the task asks for a change, edit this code and keep '
    + 'everything the task does not mention, including its comments and layout. If the task asks for something '
    + `different, replace it. Either way, return the complete new cell.\n<<<CURRENT CELL\n${cut}\nCURRENT CELL>>>`;
}

/** The user prompt for writing one cell: recent cells, nb values, any web research, the cell's own code, then the task. */
export function cellUserPrompt({ prompt, contextCells, variables, searchContext, currentSource } = {}) {
  const variablesText = describeNotebookVariables(variables);
  const variablesBlock = variablesText ? `\n\n${variablesText}\n` : '';
  const searchBlock = searchContext ? `\n\n${searchContext}\n` : '';
  const current = currentCellText(currentSource);
  const currentBlock = current ? `\n\n${current}\n` : '';
  return `${priorCellsContext(contextCells)}${variablesBlock}${searchBlock}${currentBlock}\nTask: ${prompt}`;
}

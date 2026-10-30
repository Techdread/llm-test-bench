# Notebook Lab

A notebook in your browser whose cells can be Markdown, JavaScript, Python, C, Lua, Clojure, SQL, HTML, live controls or charts. Values flow between cells through a shared `nb` object, and any cell can be written for you by a model. Everything runs on your own computer; nothing you type is sent anywhere unless you use the AI features or run a cell that fetches from the web.

This is the web edition. The full Notebook Lab also runs Java, Go, Scala and Rust; those cells need software that cannot be served from a website, so they are not offered here.

## Getting started

1. Click **📖 Library** in the toolbar and pick a **Tutorial** or an **Example**. *01 Notebook Basics* is a good first stop.
2. Click **Run all** in the toolbar, or the **▶ Run** icon on a cell header (**Shift+Enter** inside the editor).
3. Change something and run it again. Click the **`+`** buttons between cells to add a cell of any kind.
4. **Clear all** hides every output without changing the code or the shared `nb` variables.

Your notebook is kept for this browser tab, so reloading restores it. **💾 Save** writes it to a folder you choose on your computer.

## Folding cells & hiding code

- **Fold cell**: the chevron on the left of a cell header collapses it to a one-line preview.
- **Hide code, keep output**: the **`</>`** button on any cell with an output hides the editor but keeps the result. HTML and Chart cells do this automatically after a clean run. Your choice is saved with the notebook, and Export folds that code behind a **Show code** link.

Folding only changes the view; it never edits the notebook.

## Cell kinds

| Kind     | What it does |
|----------|--------------|
| **MD**   | Markdown. Double-click to edit, press *Done* (or Shift+Enter) to render. |
| **JS**   | JavaScript. `console.log` output is captured, top-level `await` works, and whatever you `return` is shown. Return a Vega-Lite spec to draw a chart, or a string of HTML to render it. |
| **Py**   | Python 3.12 via Pyodide (WebAssembly). NumPy, pandas, Matplotlib and SymPy are included and load the first time a cell imports them. The first Python run takes a few seconds while the runtime starts. |
| **C**    | Single-file C programs, compiled in your browser to WebAssembly: structs, pointers, `malloc` and the standard library, at close to native speed. `printf` for output; `#include <nb.h>` to read and share `nb`. |
| **Lua**  | Lua 5.4 programs via WebAssembly. Use `print` for output. Reads and writes `nb`. |
| **Clojure** | Clojure in your browser via Scittle (ClojureScript). `println` for output, reads and writes `nb`. No Java libraries; `format` and `printf` behave as in Java. |
| **SQL**  | SQLite queries. Every list of rows in `nb` is a table, and a `-- save as: key` comment saves the result to `nb`. |
| **HTML** | Renders into a sandboxed frame. Inline CSS and JavaScript work, and the frame gets its own `nb` object (below). |
| **UI**   | Controls (text, number, slider, checkbox, select, radio, colour, date, button, label and readout) bound to `nb` variables, laid out with a visual designer. |
| **Chart**| A [Vega-Lite](https://vega.github.io/vega-lite/) JSON spec, rendered as an interactive chart. |

## Sharing values between cells: the `nb` object

- **JS:** `nb.set('result', 42)`, `nb.get('result')`, `nb.keys()`, `nb.has('x')`.
  `nb.get` and `nb.set` trade copies: changing a list you got from `nb.get` changes nothing shared until you `nb.set` it back.
- **Python:** `nb["result"] = 42`, `nb["result"]`, `nb.keys()`, `nb.get("x")`.
- **Lua:** `nb.set('result', 42)`, `nb.get('result', default)`, `nb.keys()`, `nb.has('x')`. Values arrive as plain Lua tables (lists count from 1).
- **Clojure:** `(nb/set :result 42)`, `(nb/get :result default)`, `(nb/keys)`, `(nb/has? :x)`. Values arrive as Clojure data with keyword keys.
- **SQL:** a list of rows in `nb` is a table of the same name. Add `-- save as: key` to save the last result to `nb.key`. Tables you create stay until you open another notebook.
- **C:** `#include <nb.h>`, then `nb_get_number("key", fallback)`, `nb_get_doubles(key, out, max)`, `nb_set_number("key", value)` and friends (tutorial 08 lists them). Printing a marker line also sets a variable:

```text
__NB_SET__ {"key":"answer","value":42}
```

Values must be JSON-serialisable: numbers, strings, arrays and plain objects. The **Variables** sidebar shows what is currently set.

**UI cells** bind both ways. A control with `"bind": "growth_rate"` writes `growth_rate` when you change it, and updates itself when another cell changes it. In design mode, drag controls to move them, drag the corner handle to resize, use the arrow keys to nudge (Shift+arrows to resize), and **Tidy** to pack them on a grid. Add controls from **Form Editor** in the right sidebar.

- A `slider` or `number` is clamped to its `min`/`max`; a `checkbox` stores a real boolean.
- A `select` or `radio` whose options are all numbers stores a number.
- `"precision"`, `"prefix"` and `"suffix"` format a slider or readout without changing the stored value.
- A `button` can `"increment"`, `"toggle"`, or `"set"` one or several variables.

## HTML cells and `nb`

Inside an HTML cell:

- `nb.get(key, default)`, `nb.has(key)`, `nb.keys()`, `nb.all()` read notebook state.
- `nb.onChange(cb)` calls `cb(values)` whenever a variable changes, so a drawing can update live without re-running the cell.
- `nb.set(key, value)` writes back to the notebook, for example a game publishing its score.

```js
function draw(state) { /* redraw from state.myData */ }
nb.onChange(draw);
draw(nb.all());
```

HTML cells can load the libraries this site serves, for example
`<script src="/shared/lib/three/0.128.0/build/three.min.js"></script>`. See the 3D Visualisation examples.

## AI cells

You don't have to write code: describe what you want and a model writes the cell. Tutorials **AI 1** and **AI 2** in the Library show how.

Pick a model in the toolbar first. Use **🔑** for an OpenRouter key, or the server icon to connect a model running on your own computer (LM Studio or any OpenAI-compatible server). The site's **Settings** page explains both.

- **⚡ Generate new cell** (at the bottom) writes a new cell from a description. The model sees the cells above and the current values in `nb`. The wand in a cell header reopens a cell's saved prompt so you can change it and regenerate. On a cell that already has code, the model sees that code too, so you can ask for a change (*"make the bars green"*) and it edits the cell rather than starting again.
- **🛠 AI Fix** lights up when a cell fails, or when a Chart or UI cell has invalid JSON. The model receives the source, the error, recent output and the values in `nb`, and replaces the cell. Run it again to check; repaired code is never run automatically.
- **💬 Explain** adds a Markdown cell explaining the one above it.

### Generate a complete notebook

**Generate notebook** (the wand in the toolbar) turns one request into a connected sequence of cells.

1. Describe the whole investigation: data, calculations, visuals, interaction and explanation.
2. Leave **Languages** on **Auto**, or choose which languages it may use.
3. Choose a **Visual output**: a Vega-Lite chart, a Matplotlib plot, an interactive HTML visual, a network graph, none, or Auto.
4. Choose **Create a new notebook** or **Append** to the current one. When appending, the model sees the current cells and the values in `nb`, so the new cells can build on them.
5. Click **Generate draft**. Every cell is checked against your choices before you see the plan.
6. Review it, then open or append it. Nothing in your notebook changes until you do.

Generation is strict on purpose: unknown cell kinds, malformed JSON, invalid charts or controls, languages you did not allow, and missing visuals are all rejected. If a model keeps failing, try a stronger one.

## Saving & export

- **💾 Save** writes the notebook to `notebook-lab/notebooks/<id>.json` in a folder you choose. The browser asks for permission the first time.
- **📖 Library** lists your saved notebooks, the **Tutorials**, and the **Examples** (data structures, search, OOP, simulations, games, 3D, live APIs and an Interactive Controls gallery). Tutorials and examples open as a copy, so the original is never changed.
- **⬇ Export** downloads one standalone HTML file that works offline. Charts, Markdown and HTML that cells returned are rendered into it, and UI controls still drive the HTML cells inside it.
- **Record** captures a video of the tab, downloadable as MP4 or WebM.

## Tips

- Python keeps its imports and variables between cells; JavaScript cells start fresh each run, so use `nb.set` to keep values.
- Matplotlib figures appear as images automatically.
- A few tutorials and the **API** examples fetch live data from public services. Your browser makes those requests only when you run the cell.

## Keyboard

| Key | Action |
|-----|--------|
| Shift+Enter (in a cell editor) | Run cell |
| Ctrl+Enter / Cmd+Enter (in a cell editor) | Run cell |
| Arrow keys (UI designer, control selected) | Nudge control; Shift+arrows resize |
| Escape (in a dialog) | Close the dialog |

## Troubleshooting

- **Python is slow to start**: the first run loads the Python runtime (a few seconds), and a package's first import loads that package.
- **"not included in the web edition"**: that Python package is not served by this site. NumPy, pandas, Matplotlib and SymPy are.
- **A Java, Go, Scala or Rust cell will not run**: those languages need the full Notebook Lab.
- **`nb["x"]` raises `KeyError`**: set the key in an earlier cell first, or use `nb.get("x", default)`.
- **Chart is blank**: check the JSON starts with `{` and has no trailing commas.
- **AI buttons are disabled**: choose a model in the toolbar first.

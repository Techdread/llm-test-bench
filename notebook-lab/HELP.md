# Notebook Lab

A browser-based notebook with Markdown, JavaScript, Python, C, Rust, Lua, Java, Go, Scala, Clojure, HTML, UI, and Chart cells. Each cell can be hand-written or AI-generated, and values flow between supported cells through a shared `nb` object.

## Getting started

1. Click the **`+`** buttons between cells to insert a new cell of any kind.
2. Type or paste into the editor.
3. Click the **▶ Run** icon on the cell header (or press **Shift+Enter** inside the editor) to execute it.
4. **Run all** at the top of the toolbar runs every cell in order.
5. **Clear all**, immediately beside Run all, hides every cell output and error
   without changing cell source or shared `nb` variables. Running a cell again
   restores its output.

Your in-progress notebook is auto-saved for this browser tab. Reloading the tab
restores it, while opening Notebook Lab in a new tab starts a separate blank
workspace. Click **💾 Save** to persist it to disk (requires picking a data root
folder).

## Folding cells & hiding code

Long notebooks stay navigable with two independent collapse controls in each cell header:

- **Fold cell** — the **chevron on the left** of the header collapses the whole cell to a single-line preview so you can scan the cells above and below. Click the chevron (or the preview strip) to expand it again.
- **Hide code, keep output** — the **`</>` button** (on every cell with an output: HTML, Chart, JS, Python, C, Lua and the rest) hides just the source editor while leaving the rendered visualisation or output on screen. HTML and Chart cells collapse their code **automatically after a successful run**, so the result leads; toggle the `</>` button once and that cell keeps whatever you chose. The choice is **saved with the notebook**, and **Export** folds that cell's code behind a **Show code** link, so a report leads with its results.

Both are view-only — folding never changes or saves the notebook.

## Cell kinds

| Kind     | What it does |
|----------|--------------|
| **MD**   | Markdown. Double-click to edit, press *Done* (or Shift+Enter) to render. |
| **JS**   | JavaScript. `console.log` captures output. Top-level `await` is supported. Last expression value is shown — **return a string of HTML and it renders as HTML** (see below). |
| **Py**   | Python via Pyodide. NumPy, pandas, Matplotlib and SymPy ship locally; other locked packages such as SciPy download into the data-root cache automatically on first import. Pyodide loads on first run — the initial load can take 10–30 s. |
| **C**    | Single-file C11 programs, compiled in your browser by xcc (WebAssembly): structs, pointers, `malloc` and the standard library, at close to native speed. `printf` for output; `#include <nb.h>` to read and share `nb`. A program still running after 10 seconds is stopped. |
| **Rust** | Small single-file Rust programs via the public Rust Playground API. Use `println!` for output. Requires network access. |
| **Lua**  | Small single-file Lua 5.4 programs via Wasmoon (WebAssembly). Use `print` for output. Two-way `nb`. Runs fully offline. |
| **SQL**  | SQLite queries via sql.js (WebAssembly). Lists of rows in `nb` are tables; `-- save as: key` saves a result. See *SQL cells* below. |
| **Java** | Single-file Java via real OpenJDK (`javac`/`java`) in a Debian VM (v86). One public class with `main`. The VM boots on first run (~30 s) and compiles are slow under emulation. |
| **Go**   | Single-file Go via the real `go` toolchain in the Debian VM. `package main` + `func main()`, standard library only. |
| **Scala** | Single-file Scala 2.11 via real `scalac` in the Debian VM. |
| **Clojure** | Clojure in your browser via Scittle (ClojureScript, the version of Clojure that runs on JavaScript): starts at once, works offline, two-way `nb`. No Java libraries; `format` and `printf` behave as in Java. A program still running after 10 seconds is stopped. Real Clojure 1.11 on the JVM can be picked in the Runtime Center. |
| **HTML** | Renders source into a sandboxed iframe. Inline CSS/JS supported. The preview defaults to a full-HD viewport and stores per-cell viewport/scale changes for saved notebooks and HTML export. |
| **UI**   | Form-edited controls: text, textarea, number, slider, checkbox, select, radio, color, date, button, plus **label** (static caption) and **readout** (live value display). Controls bind to `nb` variables and can still be edited as raw JSON. |
| **Chart**| Paste a [Vega-Lite](https://vega.github.io/vega-lite/) JSON spec to render a chart. |

## Returning HTML from a code cell

A JS (or Python) cell whose value is a string of markup renders as HTML rather
than printing the source:

```js
return `
<style>.grid td { padding: 6px 10px; border-bottom: 1px solid #334155 }</style>
<table class="grid">${rows}</table>`;
```

- Leading whitespace is fine — the usual `` return ` `` template literal starts
  with a newline and still counts as HTML.
- The markup renders in its **own sandboxed frame**, so a `<style>` block styles
  only that output and can never reach the rest of the notebook. Scripts inside
  it run; the notebook's `nb` bridge is not available there (use an HTML cell
  when you need it).
- The frame sizes itself to the content, so the output box hugs the render.
- **Source** on the output toggles back to the raw markup, and `console.log`
  output is always shown as text — only the returned value is rendered.

## Sharing values between cells — the `nb` object

- **JS:**  `nb.set('result', 42)`,  `nb.get('result')`,  `nb.keys()`,  `nb.has('x')`.
  `nb.get` and `nb.set` trade copies: changing a list you got from `nb.get` changes nothing shared until you `nb.set` it back.
- **Python:**  `nb["result"] = 42`,  `nb["result"]`,  `nb.keys()`,  `nb.get("x")`.
- **C:**  `#include <nb.h>`, then `nb_get_number("key", fallback)`, `nb_get_int`, `nb_get_string(key, buf, size)`, `nb_get_doubles(key, out, max)` and `nb_get_ints` to read, a matching `nb_set_…` for each to share, and `nb_get_json` / `nb_set_json` for anything else. C sees `nb` as it was when the cell started; its changes are shared when it finishes.
- **Lua:**  `nb.set('result', 42)`,  `nb.get('result', default)`,  `nb.keys()`,  `nb.has('x')`. Values arrive as plain Lua tables: lists count from 1, and `null` becomes `nil`. A table that is a sequence goes back as a list.
- **Clojure:**  `(nb/set :result 42)`,  `(nb/get :result default)`,  `(nb/keys)`,  `(nb/has? :x)`. Values arrive as Clojure data with keyword keys; maps go back as objects and keywords as text.

Values must be JSON-serialisable (numbers, strings, arrays, plain objects). The **Variables** sidebar shows the current contents.

UI cells use two-way bindings. Add controls from the right sidebar under **Form Editor**, then use the design/input toggle in the UI cell header. In design mode, click controls on the grid-like surface to edit their details, drag controls to position them, drag their lower-right handle to resize them, and drag the cell surface handle to resize the form. Select a control and **use the arrow keys to nudge it** (Shift+arrows to resize), **Duplicate** to copy it, and the **Tidy** button to grid-pack every control and grow the surface to fit. A `title`/`description` on the cell renders as a header band above the controls. In input mode, the controls behave normally for typing and changing values. A control with `"bind": "growth_rate"` writes to `nb.get('growth_rate')` when the user changes it, and updates itself if another cell changes that variable. Current variable values are saved in the notebook's `state` field, so reopened notebooks keep the latest UI values. Use the code button in a UI cell header if you need to edit the underlying JSON directly.

Control values are **typed and formatted** for you:

- A `slider`/`number` clamps to its `min`/`max`. A `checkbox` binds a real boolean.
- A `select` or `radio` whose options are **all numeric binds a number** (e.g. `5`, not `"5"`); override with `"valueType": "string"` or `"number"`.
- `slider` and `readout` format their display with `"precision"` (decimal places), `"prefix"` and `"suffix"` — the stored value stays the raw number.
- A `button` can `"action": "increment"` (counter), `"toggle"` (boolean), or the default `"set"` (writes its `value`, or a fresh timestamp if none). Use `"set": { … }` to write several variables at once (e.g. a Reset button).

For Rust and the Linux-VM languages, direct `nb` bindings are not available. To set a notebook variable from stdout, print a marker line:

```text
__NB_SET__ {"key":"answer","value":42}
```

## SQL cells

A SQL cell runs SQLite in your browser (sql.js, WebAssembly), against one database that lasts while the page is open:

- **`nb` values are tables.** Before each SQL cell runs, every list of rows in `nb` (a list of objects, like `nb.basket`) becomes a table of the same name: its keys are the columns, and nested values are stored as JSON text. A list of plain values becomes a table with one column called `value`.
- **Your own tables stay.** Tables made with `CREATE TABLE` are still there for the next SQL cell. A table named after an `nb` value is rebuilt from `nb` each run, so don't reuse those names for your own.
- **Results show as tables.** Every statement that returns rows gets its own table (the first 500 rows are shown).
- **Save a result to `nb`.** Add a comment line `-- save as: key` and the last result is saved as `nb.key`, a list of rows, which any later cell can use, including another SQL cell, where it's a table too.

Opening another notebook starts a fresh database.

## HTML cells and `nb`

HTML cells get their own `nb` object inside the sandboxed iframe:

- `nb.get(key, default)`, `nb.has(key)`, `nb.keys()`, `nb.all()` — read notebook state.
- `nb.onChange(cb)` — `cb(values)` fires whenever any notebook variable changes, so a visualisation can redraw itself live (no re-running the cell).
- `nb.set(key, value)` — write a JSON-serialisable value back to the notebook (e.g. a game publishing its score).

The idiomatic pattern for a live visualisation:

```js
function draw(state) { /* rebuild the scene from state.myData */ }
nb.onChange(draw);
draw(nb.all());
```

HTML cells can also load vendored libraries with root-relative URLs, e.g.
`<script src="/shared/lib/three/0.128.0/build/three.min.js"></script>` — see the 3D Visualisation examples.

## Runtime backends (Python / Rust / C / Clojure)

The **⚙ Runtime Center** shows every currently open Notebook Lab tab, the
notebook loaded in each, cell/output/variable counts, an estimate of retained
notebook data, and whether Pyodide, Vega views, HTML frames, or the Debian VM
are active. Every browser tab has its own JavaScript heap; another tab shown in
the list is another live runtime, not shared notebook memory.

Use **Hard reset this tab** to open a blank notebook and reload the page. That
reload is deliberate: it is the reliable way to release WebAssembly heaps,
workers, chart views, sandboxed frames, and the Debian VM. **Reset all tabs**
does the same for every Notebook Lab tab currently reporting in the Runtime
Center. Neither action deletes notebooks saved to disk.

The same dialog also selects language backends. Four languages can run in
more than one place; the choice is global and persists across sessions.

### Python package cache

Python imports are resolved against the exact package lockfile for the bundled
Pyodide version. Notebook Lab checks its locally vendored artifacts first, then
`notebook-lab/cache/pyodide/<version>/packages` in your selected Data Root. If
an artifact is missing and **Auto-download imports** is enabled, the matching
Pyodide distribution artifact is downloaded through `serve.py`'s narrowly
allow-listed same-origin package route, SHA-256 verified, saved there, and
loaded without changing your cell source. A direct CDN fallback remains for
other static servers, although browser security policies may block binary wheel
downloads on that route.

The Runtime Center can pre-download the common scientific stack, verify every
cached file, refresh it from the pinned distribution, or delete it. Cache
folders are versioned so a future Pyodide upgrade cannot accidentally reuse
incompatible wheels. Deleting files does not unload packages already in memory;
use **Hard reset this tab** when you also want to release the active runtime.

| Cell | Default (WASM / remote) | Alternative (Debian Linux in v86) |
|------|-------------------------|-----------------------------------|
| **Py**   | Pyodide — version-locked package cache, two-way `nb`, last value + figure capture. | Real `python3` 3.11. Stdlib only. Emit-only `nb` (writes turn into `__NB_SET__`; reads raise). |
| **Rust** | Rust Playground (remote API, needs internet, no stdin). | Real `rustc`, offline. Compiles take tens of seconds under emulation. |
| **C**    | xcc — a real C compiler built for WebAssembly: fast, offline, two-way `nb` through `<nb.h>`. (JSCPP, the older interpreter, can still be picked.) | Real `gcc` / `g++` — full C99/C++17 with proper diagnostics. |
| **Clojure** | Scittle — ClojureScript interpreted in the browser: instant, offline, two-way `nb`, no Java interop. | Real Clojure 1.11 on OpenJDK — Java libraries, about a minute a cell. The same `nb/get` and `nb/set`: reads see `nb` as it was when the cell started, and whole numbers arrive as integers, so `(/ 3 2)` is the ratio `3/2`. Code is saved as `.cljc`, so `#?(:clj … :cljs …)` lets one cell suit both. |

All Debian backends share **one** v86 guest. The first cell that needs it boots Debian (~30 s); after that every Debian-backed language reuses the same VM instantly.

## AI cells

### Generate a complete notebook

Click **Generate notebook** (the purple wand in the top toolbar) to turn one
prompt into a connected sequence of cells. The selected model can combine
Markdown explanations, Python calculations, JavaScript, interactive Vega-Lite,
HTML, UI controls, and the compiled-language cells where they genuinely help.

1. Describe the complete investigation, including the data, calculations,
   visualisations, interaction, citations, and explanation you want.
2. Leave **Languages** on **Auto**, or select the executable languages the
   notebook may use. Markdown, Controls, and Vega-Lite remain available as
   support cell types. A visual choice can add its required renderer—for
   example, **Python / Matplotlib plot** permits Python and **Interactive HTML
   visual** permits HTML.
3. Choose a **Visual output**: Auto, none, Vega-Lite chart, Python/Matplotlib
   plot, interactive HTML visual, or network graph. Notebook Lab validates the
   returned draft against this choice instead of trusting prompt wording alone.
4. Choose **Create a new notebook** or **Append**. Append is useful for a
   follow-up such as adding Kepler's third law to an existing Solar System
   notebook; the model receives bounded context from the current cells and the
   current values in `nb`, so the new cells can build on them.
5. Enable **Search web for current sources** when the work needs current or
   authoritative facts. This requires a Brave Search key in Settings.
6. Click **Generate draft**. The model response streams in, then Notebook Lab
   validates every cell before showing its plan and structured source list.
7. Review the cell sequence, constraint badges, and warnings, then explicitly open or append it.
   Nothing in the editor changes before this confirmation.

Generated cells carry the prompt, provider/model, source hash, search flag,
generation id, selected languages/visual output, and CLI run id where applicable.
A new id is allocated for every new generated notebook; it is not saved to disk
until you click **Save**.

Notebook generation is deliberately strict: unsupported cell types, malformed
JSON, invalid UI controls, invalid Vega-Lite chart cells, unselected languages,
and missing or unwanted visual output are rejected. If a model struggles to
return the structured notebook, try a stronger model or a CLI coding agent. For
dynamic charts based on Python results, the generator is instructed to use a
JavaScript cell that reads `nb` and returns a Vega-Lite spec.

### Generate or explain one cell

New here? Tutorials **AI 1** and **AI 2** in the Library show how to build a whole notebook from prompts, without writing code.

- **⚡ Generate new cell** button at the bottom inserts a fresh AI-generated cell. You can also click the wand icon in any cell's header to regenerate that cell. The prompt is saved with the cell, so the wand reopens it for **Replace cell** or **Generate copy**.
- **Ask for a change:** when the wand opens on a cell that already has code, the model sees that code and is told to change just what you ask, so *"make the bars green"* edits the cell instead of starting it again. This works on cells you wrote yourself, too. (Switching the cell to another kind starts it from scratch.)
- **What the model sees:** the last few cells above (source and output), and the **current values in `nb`** (names, shapes and short previews), so a prompt can say *"draw nb.sprite"* and the model knows what that data looks like.
- **🛠 AI Fix** (screwdriver-and-wrench icon) becomes available when a cell has a runtime/compiler error, or when a Chart/UI cell contains invalid JSON. It sends the source, captured diagnostic, recent output, preceding-cell context, and the current `nb` values to the AI selected in the toolbar, then replaces the failing source. Run the cell again to verify the repair; Notebook Lab does not auto-run repaired code because cells may have side effects.
- **💬 Explain** (comment icon) generates a Markdown explanation cell below the current cell.

Pick a model in the toolbar (any OpenRouter-compatible model or a local LM Studio model). The first time you use AI, you'll be prompted for an API key.

Select **Claude Code**, **Codex**, or **Antigravity** in the toolbar executor to
use a CLI agent for either a single cell or a whole notebook. The agent writes
an isolated `cell.*` or validated `notebook.json` deliverable while its real
tool/file/shell activity streams into the dialog. This path uses the agent's
installed login rather than an API key. Run the hub with `python3 serve.py
8080`; durable runs live under `<data-root>/notebook-lab/runs/<run-id>/`.

## Saving & export

- **💾 Save** writes the notebook to `<data-root>/notebook-lab/notebooks/<id>.json`.
- **📖 Library** lists saved notebooks, the bundled **Tutorials**, and the **Examples** library (data structures, search, OOP, simulations, games, 3D visualisation, APIs, and an **Interactive Controls** gallery — with language badges). Tutorials and examples open as a fresh notebook — save to keep your edits without overwriting the original.
- **⬇ Export** produces a standalone HTML file that links to nothing — markdown and Vega charts are rendered at export time and baked in, so the file works from anywhere (Downloads, email, a USB stick) with no network. Markdown, HTML frames, charts, images and saved outputs all render, including HTML a cell returned; code cells are displayed but not re-executed. Code you hid with `</>` is folded behind **Show code**.
- The export opens in **whichever theme the app is wearing**, and carries its own light/dark switch in the top-right corner — the reader's choice is remembered for next time they open the file.
- Exported **UI cells are live controls**, not a JSON dump. They carry the notebook variables as they stood at export time, and drive the HTML cells in the same document over the notebook bridge — so a slider still steers the sketch in the exported file, and an HTML cell's `nb.set()` still moves the controls back.

## External API

Notebook Lab exposes a browser API while the app is open:

```js
await window.NotebookLabAPI.runAndSave({
  notebook: {
    title: 'External Report',
    cells: [
      { kind: 'md', source: '# External Report' },
      { kind: 'js', source: 'console.log("hello")' }
    ]
  }
});
```

Native programs can also submit JSON command files to `<data-root>/notebook-lab/api/inbox/`. Notebook Lab polls that folder while open, runs commands, saves notebooks, and writes results to `api/outbox/` or failures to `api/failed/`.

## Record video

Use **Record** in the toolbar to capture a notebook walkthrough or a live cell
execution. Chrome asks whether to share this tab, another window or a display;
choose 30 or 60 FPS and optionally request supported tab/system audio. Floating
controls provide pause, resume and stop before the recording preview opens.

The recorder defaults to upload-friendly **MP4 · H.264**. You can choose WebM,
and the app falls back to WebM automatically if MP4 encoding is unavailable.

Recordings can be downloaded or saved append-only under
`<root>/notebook-lab/recordings/<recording-id>/`. Saved provenance includes the
notebook id and title, cell count and kinds, and the cell running when the
recording was saved.

## Tips

- Python variables persist between cells (imports, globals) — the Pyodide runtime is kept alive.
- JavaScript cells run in a fresh async function each time; use `nb.set` to persist state.
- C is interpreted in-browser and best suited to small examples.
- Rust uses remote execution through Rust Playground, so it needs network access and may be rate limited.
- Matplotlib figures are auto-captured as inline PNGs.
- Strings that look like base64 data are auto-rendered as images.

## Keyboard

| Key | Action |
|-----|--------|
| Shift+Enter (in cell editor) | Run cell |
| Ctrl+Enter / Cmd+Enter (in cell editor) | Run cell (alias) |
| Arrow keys (UI designer, control selected) | Nudge control; Shift+arrows resize |
| Escape (in a dialog) | Close the dialog |

Dialogs close only via their close button or **Escape** — clicking outside a dialog won't dismiss it, so in-progress input isn't lost by a stray click.

## Troubleshooting

- **Python takes forever to start** — the Pyodide core is loaded from the app's local `shared/lib`; a package's first import may also download its pinned artifacts. Open Runtime Center to download the common stack in advance.
- **Python package setup failed** — choose a Data Root in Hub Settings, check **Auto-download imports** in Runtime Center, and run the cell again. Use **Verify** or **Refresh** if a cached artifact is damaged.
- **Blocked by Safe Browsing** — restart the Hub with `python3 serve.py 8084`, then use **Refresh** or rerun the cell. The same-origin package route avoids Chrome treating `.whl` files as direct downloads; already cached valid files are retained.
- **`nb["x"]` raises `KeyError`** — set the key from another cell first, or use `nb.get("x", default)`.
- **Rust fails before running** — check the Errors and Compile output; remote Rust Playground diagnostics are shown in the cell output.
- **Vega chart blank** — make sure the JSON spec starts with `{` and is valid (no trailing commas).
- **AI button disabled** — set your OpenRouter API key via the 🔑 icon in the toolbar.
- **AI Fix button disabled** — run the cell first. The button activates after Notebook Lab captures an error (or immediately for invalid Chart/UI JSON).

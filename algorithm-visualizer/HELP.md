# Algorithm Visualizer

Paste (or pick) a small algorithm in JavaScript or Python. The app instruments the code, records how its variables change, and replays those changes as an animated visualisation you can step through forwards and back.

## Getting started

1. Pick a **preset** (bubble sort by default) or paste your own snippet in the left pane.
2. Press **Run** to instrument and execute the code. Each variable assignment becomes a trace event.
3. Use the **timeline controls** below the visualisation to play, pause, scrub, or step through the run.
4. (Optional) Press **Detect** to ask the LLM to pick a visualisation kind and map your variables to channels.

If this is your first time:
- **API key** — click the 🔑 in the toolbar to paste an OpenRouter key. Only needed if you want the LLM to detect the visualisation kind. Shared across the hub.
- **Data root** — click the folder icon to pick a directory for saved sessions. Optional.

## The four visualisation kinds

- **Array** — horizontal bars, index labels, and cursor flags for any index variables (`i`, `j`, …). Great for sorts, scans, and sliding-window algorithms.
- **Graph** — force-directed node layout, edges drawn once and cached. Visited and frontier sets are highlighted as the algorithm progresses. Use for BFS, DFS, Dijkstra.
- **Tree** — tidy-tree layout. Accepts both linked `{value, left, right}` structures and array-heap representations. Highlights the `cursor` variable if present.
- **Grid** — 2D DP tables and obstacle grids. Numeric values are mapped through a heat colour scale; binary 0/1 grids render walls explicitly. A cursor cell is drawn if the variable `current = {x, y}` (or `i`/`j`) is present.

## Mapping

Each kind needs to know which variable plays which role (the array, the adjacency dict, the DP table, the cursor). The panel on the right lets you pick those interactively. The **Detect** button uses the LLM to guess a mapping in one shot — falls back to regex heuristics if no model is configured.

## Playback controls

- **Space** toggles play/pause
- **← / →** steps one frame
- **Shift+←/→** jumps 10 frames
- **Home / End** jumps to the start or end of the trace

Speed is a multiplier on the base rate (one frame per ~160 ms).

## How the tracing works

- **JavaScript** — Acorn parses your source, a walker inserts `__trace(name, value, line)` calls after every variable declaration, assignment, and `i++`, plus one `__iter` call per loop iteration. The instrumented code runs inside a sandboxed `new Function`.
- **Python** — Pyodide (lazy-loaded, ~10 MB) is used with `sys.settrace`. Every line event diffs the frame's locals against the previous snapshot; only changed names emit events.

Large inputs may produce more than **50,000** events. When that happens the trace is truncated and a warning is shown — shrink the input to see the full run.

## Presets

The shipping set exercises every renderer:
- **Bubble sort**, **Quicksort** — array bars
- **BFS**, **DFS**, **Dijkstra** — graph
- **Knapsack DP** — grid (2D DP table)
- **A\*** — grid (maze)

Picking a preset clones its source into the editor and sets a known-good mapping. If you edit the source, the preset dropdown clears so you know you're on a custom run.

## Sessions

- **Save** writes `<data-root>/algorithm-visualizer/projects/algo-vis/sessions/<id>.json` with the current source, language, and mapping.
- **Sessions** opens a list; click to load, trash to delete.
- Saving requires a data root — use the folder icon to pick one the first time.

## Tips

- If the visualisation looks "empty" after Run, it usually means the mapping points to a variable name that doesn't exist in the source. Either adjust the mapping or press Detect again.
- Step back restores prior state instantly — we pre-compute all snapshots after a Run, so scrubbing is O(1).
- Trees rendered from `{value, left, right}` need a single root variable. Point the mapping at it.

## Troubleshooting

- **"Parse error"** — your JS source couldn't be parsed by Acorn. Check the console for details.
- **"Trace truncated at 50k events"** — reduce your input size (the presets deliberately ship with small inputs for this reason).
- **Python is slow on first run** — Pyodide needs to download once (~10 MB). Subsequent runs are fast.
- **"Empty response" / "Model response was not valid JSON"** during Detect — some free models ignore the "JSON only" instruction. Switch models or uncheck **LLM** to rely on the heuristic detector.

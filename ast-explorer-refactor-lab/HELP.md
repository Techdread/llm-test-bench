# AST Explorer & Refactor Lab

Paste or load some JavaScript, TypeScript, TSX, or Python — see its abstract syntax tree, jump between source and tree, and ask an LLM to apply common refactors with a diff you can review before accepting.

## Getting started

1. Pick a language in the toolbar (JavaScript is the default).
2. Paste your code into the left pane — parsing is automatic.
3. Click nodes in the AST (middle pane) to highlight them in the source, or click in the source to select the innermost enclosing node.
4. Open the **Refactor** tab on the right, pick a recipe, and press *Run refactor* to get an LLM-proposed diff.

If this is your first time using the app:
- **API key** — click the 🔑 in the toolbar to paste an OpenRouter key (`sk-or-…`). The key lives in your browser's localStorage, shared with the rest of the hub, and is only sent to openrouter.ai.
- **Data root** — click the folder icon to pick a directory where sessions can be saved. This is optional; the app works fine without it.

## The three panes

- **Source** — standard Ace editor. Supports JS/TS/TSX/Python syntax highlighting. Typing re-parses with a short debounce.
- **AST** — virtualised tree of syntax nodes. Expand/collapse chevrons work, or use the ⇑/⇓ buttons in the header to expand/collapse all. Selected nodes stay in view.
- **Node details / Refactor** — two tabs on the right.
  - *Node details* shows the selected node's kind, offsets, source snippet, and a JSON dump of its scalar properties.
  - *Refactor* lists the recipes applicable to the current language.

## Language notes

- **JavaScript** is parsed with Acorn in module mode.
- **TypeScript / TSX** uses a syntactic-only pass: types, generics, `as` casts, decorators, and `interface` / `type` declarations are stripped to whitespace, then the remaining JS is parsed. Offsets line up with the original source. There is **no type checking** — the tree you see won't contain type nodes.
- **Python** uses [Pyodide](https://pyodide.org/)'s stdlib `ast` module. The runtime is ~10 MB and loads lazily the first time you select Python. Later parses are fast.

## Refactor recipes

Each recipe is *data*: a label, description, supported languages, a system prompt, and a user-prompt template with placeholders (`{{source}}`, `{{selection}}`, `{{extra}}`, etc.). The shipped set is:

- **Extract function** — name the new function in the *New function name* field, and the LLM moves the selected block out.
- **Inline variable** — inline the declaration at the cursor.
- **Convert callbacks to async/await** — for JS/TS only.
- **Introduce early returns** — flatten nested conditionals.
- **Rename symbol** — scope-aware rename (the LLM respects binding scope; not a pure text replace).
- **Add TypeScript types** — TS/TSX only. Infers parameter/return types where it's safe; won't use `any`.

The recipe panel shows each recipe's guardrails — rules baked into its prompt (no new imports, preserve behaviour, etc.).

## Diff review

After the model responds, the new source is re-parsed:

- If parsing **succeeds**, all hunks are accepted by default. Use the checkboxes in each hunk header to reject individual changes.
- If parsing **fails**, every hunk is rejected by default and a warning is shown. You can still accept hunks if you understand the risk.

Click *Apply* to merge accepted hunks into the editor. The source re-parses immediately so you can verify the result.

## Tips

- Refactors work on the **current selection** if one is active (a tree node is selected), otherwise on the **whole file**.
- Set a good selection before running Extract Function — the LLM is better at picking names when the block is clearly delimited.
- If a model returns `source unchanged`, the recipe probably didn't apply cleanly. Try giving it a narrower selection, or switch recipes.
- TS warnings in the refactor panel are informational — the LLM still sees the full TypeScript source, only the *AST viewer* is working from the stripped version.

## Keyboard

- Any Ace editor shortcut works in the source pane (Ctrl+F, Ctrl+G, etc.).
- Escape closes the diff overlay, sessions list, API key dialog, and help.

## Sessions

- **Save** — writes `<data-root>/ast-explorer-refactor-lab/projects/sessions/<id>.json` with the name, language, and source. Your name input in the toolbar becomes the session title.
- **Sessions** — lists saved sessions. Click to open; the trash icon deletes.
- Session persistence requires a data root. Use the folder icon in the toolbar to pick one the first time.

## Troubleshooting

- **"OpenRouter API key not set"** — click the 🔑 and paste a key from <https://openrouter.ai/keys>.
- **Python parse stuck on "Loading Pyodide…"** — first load is ~10 MB and a few seconds. Subsequent parses are instant.
- **Diff shows identical old/new** — the model returned an unchanged file; try a narrower selection or a different recipe.
- **New source fails to parse** — the overlay warns you. Reject the bad hunks, or accept only the parts that look right and re-run from the merged result.

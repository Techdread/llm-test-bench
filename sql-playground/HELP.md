# SQL Playground — Help

An in-browser SQLite environment. Databases live entirely in your browser —
either in your data-root folder (via the File System Access API) or in
IndexedDB as a fallback.

## Getting started

1. The app opens with a scratchpad database and a small demo schema.
2. Press **Ctrl+Enter** (or click **Run**) to execute the SQL in the editor.
   If you have text selected, only the selection runs.
3. Use the **left panel** to manage saved databases and snippets.
4. Use the **right panel** to inspect the schema, view the ER diagram, or ask
   the LLM assistant to write SQL for you.

## Databases

- Click **+** in the *Databases* side panel to create a new empty DB.
- Click a database name to load it (unsaved work is prompted before switching).
- Click the **📥 import** icon to open a `.sqlite` / `.db` / `.sqlite3` file.
- Click the **⬇ export** icon next to a DB to download it as a `.sqlite` file.
- **Save** persists the current DB to your data root (or IndexedDB).
- **Save As…** clones it under a new name.
- The name pill in the toolbar is clickable — use it to rename the current DB.

## Editor & results

- Ace-powered SQL editor with syntax highlighting.
- **Run** executes the whole script, or the current selection. All statements
  run; the last result set is shown.
- **Plan** runs `EXPLAIN QUERY PLAN` for the selected statement and renders it
  as a tree.
- The results grid is **virtualised** — 100k-row result sets scroll smoothly.

## Schema & diagram

- **Schema** tab: expandable table tree. Click a column to insert its name
  into the editor; click the 👁 icon to `SELECT * FROM …` that table.
- **Diagram** tab: auto-laid-out ER diagram using foreign-key constraints as
  edges. Based on the shared force-directed graph layout.

## LLM Assistant

The assistant uses the same provider / model selection as the rest of the hub.
Set an API key from the toolbar key icon, and pick a model from the dropdown.

Modes:

- **Suggest query** — natural-language → SQL against the current schema.
- **Draft schema** — a description → a set of `CREATE TABLE` statements.
- **Seed data** — generate `INSERT` statements for the current schema.
- **Explain** — plain-language explanation of the SQL currently in the editor.

Each generated SQL block has **To editor** (replaces the editor contents) and
**Run** (executes against the current DB) buttons.

## CSV import / export

- Toolbar **📄 import CSV** opens a dialog to name a new table. The importer
  infers INTEGER / REAL / TEXT from the sample values. Existing tables with
  the same name are dropped.
- Toolbar **📤 export CSV** downloads the current result set.

## Snippets

- Type a name in the *Snippets* side panel and click 💾 to save the editor
  contents as a reusable snippet under the current DB.
- Click a snippet to load it back into the editor.
- Snippets follow the DB: loading a different DB swaps its snippet list.

## Keyboard

| Action | Binding |
|---|---|
| Run query | `Ctrl+Enter` / `Cmd+Enter` |

## Tips

- You can quote reserved words (like `"order"`) to use them as table names.
- The first time you run a query, sql.js (≈1 MB WASM) is downloaded and cached
  by the browser.
- The demo schema is preloaded into the scratchpad DB so `SELECT` statements
  work immediately.

## Troubleshooting

- **"Failed to load sql.js"** — check your internet connection; the WASM is
  loaded from `cdnjs.cloudflare.com` on first use.
- **"DB not found"** — the database was deleted externally. Create a new DB
  from the toolbar.
- **"Pick a model first"** — open **Settings** (cog), add an OpenRouter API
  key, and pick a model from the dropdown.

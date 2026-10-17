# Code Morph Lab v3

A reimagined iterative code-generation loop — describe what you want, pick a model, and watch the LLM write, run, and self-correct code across multiple iterations. Sessions are persisted to disk for review, forking, and export.

## Getting started

1. Connect a data root when prompted (folder picker on first launch).
2. Configure a model provider via the key / server buttons in the toolbar.
3. On the **Start** screen, type a prompt describing what the code should do.
4. Choose the language (HTML or Python) and max iterations.
5. Press **Generate** to kick off the morph loop.

## Start view

- **Prompt** — describe the desired behaviour in natural language. Be specific.
- **Language** — HTML (rendered in an iframe) or Python (executed via Pyodide).
- **Max iterations** — how many edit → run → fix cycles the LLM may attempt.
- **Import context** — if code was handed off from another app, the original prompt is shown separately from your requested changes, and the imported files are visible in the left-side code editor before you start.
- **Recent sessions** — a list of previously saved sessions; click one to review it.

## Morph view

Once the loop starts you see:

- **Iteration timeline** — each iteration card shows tool calls, files changed, diffs, and run results.
- **Workspace panel** — the current state of all files. During model calls, a `model-stream.md` tab shows streamed assistant text and tool-call arguments while the model is still responding.
- **Output inspector** — console output, error details, and a live HTML preview (HTML mode).

## Sessions

Every morph run is automatically saved to your data root as a session.

- **Review** — open any past session from the Start view to inspect its iterations and final workspace.
- **Fork** — create a new session that starts where a previous one left off, optionally with a refined prompt.
- **Send back** — when a session started from another hub app, return the final files to the source app. Prompt Gallery appends the returned HTML as a new variant in the original prompt folder.
- **Export** — download the full session (goal, iterations, snapshots) as a `.json` file.

## Handoff

Code Morph Lab v3 can receive code or prompts from other apps in the hub via a handoff mechanism. When a handoff is detected on launch, the imported files and prompt are pre-filled on the Start view. Completed imported sessions expose **Send back** so the final result can return to the originating app.

## Tips

- Start simple — a clear, testable goal converges faster than a vague one.
- Use **Fork** to iterate on a partially successful session without starting from scratch.
- Lower max iterations for quick experiments; raise them for complex multi-step goals.
- If the model gets stuck, try a different model or rephrase the prompt.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Escape** | Close any dialog |

## Troubleshooting

- *Welcome gate won't dismiss* — you must connect a data root folder (Chrome / Edge only — File System Access API).
- *Generation produces empty output* — try a more capable model; some free models struggle with tool-call prompts.
- *Python mode errors on first run* — Pyodide loads on demand and may take a few seconds; check the browser console.
- *Fork button missing* — fork is only available on completed (success / failed) sessions, not while running.

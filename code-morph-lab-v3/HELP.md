# Code Morph Lab v3

A reimagined iterative code-generation loop — describe what you want, pick a model, and watch the LLM write, run, and self-correct code across multiple iterations. Sessions are persisted to disk for review, forking, and export.

## Getting started

1. Configure a model provider via the key / server buttons in the toolbar.
2. On the **Start** screen, type a prompt describing what the code should do, or change the demo that is already loaded (below).
3. Choose the language (HTML or Python) and max iterations.
4. Press **Generate & Morph** to kick off the morph loop.

Sessions are saved in the hub's data root. On the public website, until you choose a folder, they are saved in this browser's own storage; the toolbar says **Browser storage**, and clicking it lets you pick a folder instead (Chrome and Edge). Morphs already saved in the browser stay there.

## The demo

If nothing was handed over from another app and you have no morphs yet, the Start screen opens with a demo already loaded: an **ASCII Roguelike** from the Prompt Gallery, written by Qwen3.6 27B running locally. Its original prompt and code are shown, and **Try one** offers four ready-made changes (an archer enemy, a colour theme per floor, a mini-map, stacking potions). Pick one or write your own, choose a model and press **Generate & Morph**. Close the demo with the **×** in the Import panel; **Load the ASCII Roguelike demo** brings it back.

A demo has no app to **Send back** to, so that button does not appear for it.

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

- *Welcome gate won't dismiss* — in the private hub you must connect a data root folder (Chrome / Edge only — File System Access API). The public website saves in browser storage and skips it.
- *Generation produces empty output* — try a more capable model; some free models struggle with tool-call prompts.
- *No CLI agents in the model list* — on purpose. The morph loop gives the model the lab's own tools (read, write, run), and CLI agents such as Claude Code, Codex or Antigravity bring their own and refuse those requests. Use an API model (OpenRouter) or a local one (LM Studio).
- *A run stops after one iteration with an API Error* — the provider refused the request itself (bad key, unknown model, a model without tool support). Retrying could not fix it, so the loop stops instead of using up every iteration.
- *Python mode errors on first run* — Pyodide loads on demand and may take a few seconds; check the browser console.
- *Fork button missing* — fork is only available on completed (success / failed) sessions, not while running.

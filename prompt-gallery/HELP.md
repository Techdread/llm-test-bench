# Prompt Gallery — Help

A searchable library of prompts you can browse, run, save, and refine.

## Prompts tab

- Browse curated starter prompts plus your own saved ones.
- **Search by name or prompt** text, and filter with **tags**.
- Open a prompt to see its full text (Markdown supported), notes, target models,
  and run history.
- **Run** a prompt against your configured provider/model to try it.

## Saving your own

- Add a prompt with a name (e.g. `landing-page-v1`), the prompt body, tags, and
  notes. Your entries live in a user layer; the curated seeds are never
  overwritten.

## Local models

The hosted edition can generate directly through a model running on your own
computer. Open the server/provider button in the toolbar, add an LM Studio or
OpenAI-compatible endpoint, and test it. LM Studio normally uses
`http://localhost:1234` and must have CORS enabled in its Developer server
settings (or be started with `lms server start --cors`).

Chrome or Edge may ask whether this website can access your local network;
choose **Allow**. Once connected, every model reported by the endpoint appears
in the normal model picker and works with Create, Refine, Save suggestions, and
Batch. The browser talks directly to the local server—the hosted site does not
relay prompts or responses.

## CLI agent generation

- Claude Code, Codex, and Antigravity appear in the normal model dropdown under
  their own headings. Pick one and press **Generate** as usual — there is no
  separate button.
- The agent writes a portable `index.html` in a fresh append-only run folder;
  its messages, file edits, and shell commands stream inline while the Create
  preview updates.
- CLI agents use their own installed login and require the hub to be running
  with `python3 serve.py 8080`. Each run is jailed to
  `<data-root>/prompt-gallery/runs/<run-id>/project/` and remains on disk with
  its request, trace, and result metadata.

## Batch Run

- The **Batch** button (top toolbar) runs one model over many prompts in a row.
- The dialog shows the currently-loaded model; if none is selected you must pick
  one before it will start. Tick the prompts to include (all are pre-selected)
  and press **Go**.
- **Core / Advanced** above the prompt list picks which set a batch runs. A
  batch only ever runs the set on screen, so the two are never lumped together.
  **Advanced** has 40 harder briefs; each builds on a core prompt with a
  numbered list of checkable requirements and sharper **Watch for** notes (which
  Verified mode turns into its checklist). Advanced titles end in
  "(Advanced)", so their generations save to their own folders and "has run"
  and skip-existing treat them separately. **Runs** labels Advanced runs, and
  Merge only combines runs from the same set.
- Each generation is auto-saved with `ai-gen` + `batch` tags under the folder
  derived from the prompt's title, so nothing needs naming by hand.
- **Quick** is the default and preserves the original one-call generation flow.
- **Runtime Heal** runs the page in the hidden sandbox and repairs captured
  runtime errors up to 1–3 times. Both the original and healed versions are
  kept.
- **Verified** derives a checklist from the prompt and **Watch
  for** notes, collects bounded sandbox evidence, asks the selected model to
  audit the result in a fresh call, and can make 0–2 focused repair rounds.
  The original and every repair are always saved as separate variants.
- Verified uses extra model calls, tokens, and time. Its pass means the bounded
  checklist and sandbox evidence passed; it is not a guarantee of subjective
  visual quality, playability, or fun. Unsupported or unreadable evidence is
  shown as **Needs review**, not silently treated as a pass.
- Other options apply to every mode: skip prompts already run for the model,
  retry provider failures, add a delay for rate-limited providers, or turn off
  **Show live generation** to avoid retaining and rendering streamed HTML in the
  Batch dialog during large runs.
- A live preview follows the current generation; a summary at the end reports how
  many were generated, healed, verified, warned, skipped, and failed, plus role
  calls and repair rounds. Open **Runs** or a variant's metadata panel to inspect
  checklist rows, evidence, stop reason, token usage, and repair lineage.
- **Judge as you review.** Open a run in **Runs** and rate each generation out
  of 10 with the stars above the preview, or press **1–9** (and **0** for 10)
  while stepping with ← →. The run list shows how many of each run you have
  rated, and every column in a run comparison has its own stars. Ratings made
  before the switch to 10 stars (out of 5) are kept on disk as they were and
  shown doubled, so a 4/5 reads as 8/10.
- In **Runs**, select two or more batches and choose **Merge** to combine them
  into one run. Merge is available only when every selected run used the same
  provider and model; the original run IDs remain recorded in metadata.
- Use the expand button beside a live or saved batch item to open its page in an
  interactive full-screen viewer. The viewer can follow the current generation
  or stay pinned to an earlier result while the rest of the batch continues.

## Refine tab

- Take an existing prompt and **heal/improve** it in a sandbox. Refinements are
  verified before being saved as a new `derivedFrom` variant — the original is
  left untouched, so you can compare versions.

## Gallery tab

- **Projects** is the default view. It groups all generations made from the
  same saved prompt, showing the best-rated preview, model count, variant
  count, and the newest run.
- Open a project to review its original prompt and compare its variants by
  model, rating, timestamp, tags, and refinement status.
- Use **Variants** when you need one chronological list across every project.
- Search includes project names, original prompt text, model names, tags, and
  notes. Filter by model, tag, minimum rating, or a review collection.
- **Unreviewed**, **Favorites**, **Recent**, **Refined**, and **Archived** make
  it easy to return to a useful subset of the work. When verified metadata is
  present, **Verified**, **Needs review**, and **Verification failed** filters
  appear as well.
- Archiving hides a generation from normal browsing without deleting its HTML
  or metadata. Open the Archived collection to restore it.

## Compare tab

- Generations are grouped under the prompt they came from, so the picker reads
  as "this prompt, these models" rather than one long list.
- **Line up models** on a prompt selects up to four of its runs — one per model,
  best rated first — and opens the comparison in a single click.
- **Search** matches prompt text, model, provider, tags, and notes; the model,
  rating, and sort controls narrow it further, and the archive toggle brings
  archived runs back into view.
- The picked tray stays visible while you search, so filtering never loses a
  selection you have already made. Click a chip to drop it.
- Each column is headed with its model, provider, date, and rating, and opens
  full screen from the arrow icon.

## Record video

Use **Record** in the toolbar to capture this tab, another window or a display.
Choose 30 or 60 FPS and optionally request tab/system audio; Chrome always asks
you to choose the capture source. Floating controls provide pause, resume and
stop, followed by an in-app preview.

The default **MP4 · H.264** format is intended for common video-upload services;
WebM remains selectable and is the automatic fallback when MP4 is unavailable.

Recordings can be downloaded immediately or saved append-only under
`<root>/prompt-gallery/recordings/<recording-id>/`. Saved metadata includes the
current route, generation, prompt and model when available.

## Tips

- Tag consistently (e.g. `css-animation`, `no-libraries`) so the gallery stays
  searchable as it grows.
- Use the run stats to see which prompts have worked well for you before.

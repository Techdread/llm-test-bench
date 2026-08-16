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
- Each generation is auto-saved with `ai-gen` + `batch` tags under the folder
  derived from the prompt's title, so nothing needs naming by hand.
- **Self-heal** (off by default) re-runs any page that throws a runtime error
  through the model up to 1–3 times; both the original and the healed version
  are kept. Other options: skip prompts already run for this model, retry on API
  failure, and a delay between prompts for rate-limited providers.
- A live preview follows the current generation; a summary at the end reports how
  many were generated, healed, skipped, and failed, with a jump to the Gallery.

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
  it easy to return to a useful subset of the work.
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

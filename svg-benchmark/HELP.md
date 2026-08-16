# SVG Benchmark

A tool for generating, scoring, and comparing SVG outputs across different AI models. Create prompts, generate SVGs, compare them against reference images, and track results in organised benchmarks.

## Getting started

1. Connect a working directory (folder icon in the toolbar) to save benchmarks to disk — Chrome or Edge required for the File System Access API.
2. Optional: set an API key and pick a model via the key/server icons. Multiple providers are supported (OpenRouter, LM Studio, etc.).
3. Write a prompt describing the SVG you want, then click **Generate**.
4. Optionally paste or drop a reference image, then run **Auto-score** to get a pixel-diff similarity percentage.
5. Click **Save** (or Ctrl+S) to persist the submission inside a benchmark folder.

## Create view

The main workspace is split into three columns:

- **Left** — Prompt input and the Ace code editor showing the raw SVG source.
- **Centre** — Live SVG preview. When a reference image is loaded, the **Diff** overlay (Ctrl+D) composites the SVG over the reference so you can spot differences.
- **Right** — Reference image panel and score panel (auto-score + manual 1–9 rating).

The bottom bar has **GIF** (export the current SVG as a GIF image), **Clear** (reset all fields), and **Save** (persist the current submission).

## Prompts

Open **Prompts** in the main toolbar to browse the same challenge catalogue used
by Batch mode. Search by title, prompt text or technique, then filter by category
and difficulty.

- **Use prompt** fills the Create workspace so you can edit the wording before generating.
- **Generate** fills the prompt and immediately runs it through the selected model.
- **Batch these prompts** opens Batch mode with the complete shared catalogue.
- Cards show how many saved submissions already represent each challenge and
  whether its benchmark has a reference image.

The hosted catalogue includes harvested benchmarks plus curated challenges for
information design, icon consistency, complex geometry, character consistency,
gradients, masks and artistic composition.

## CLI agent generation

Click **CLI agent** in Create to use Claude Code, Codex, Antigravity, or Grok in place
of the selected in-app model. The agent must write a standalone `output.svg`;
the editor and preview update as that file changes. If **Attach reference to
prompt** is enabled, the image is copied into the isolated workspace as
`reference.png` for the agent to inspect.

CLI agents use their own installed login and require
`python3 serve.py 8080`. Runs are path-jailed under
`<data-root>/svg-benchmark/runs/<run-id>/project/`, remain append-only, and save
their request, event trace, output, and provenance for recovery.

## Benchmarks view

Lists all saved benchmarks as cards. Each benchmark groups every submission made for the same prompt.

- Click a card to see all submissions for that benchmark.
- Use **Compare** to view submissions side-by-side with the reference image.
- **Add Submission** loads the benchmark's prompt into the Create view so you can generate with a different model.
- **Morph** sends a benchmark prompt or submission to Code Morph Lab v3. When you use **Send back** there, SVG Benchmark saves the returned SVG as a new submission on the same benchmark.

## Batch Run

The **Batch** button (top toolbar) runs one model over many benchmark prompts in
a row — a fast way to fill out a benchmark for a newly added model.

- The dialog shows the currently-loaded model; pick one if none is selected.
- It lists every benchmark prompt (all ticked by default); untick any you want to
  skip, then press **Go**. Each generated SVG is auto-saved as a submission under
  that benchmark, tagged `ai-gen` + `batch`.
- Benchmarks that have a **reference image** are auto-scored as they run, so a
  batch also produces comparison scores.
- **Auto-fix invalid SVG** (off by default) re-asks the model to repair any output
  that isn't well-formed SVG, up to 1–3 times, keeping both the original and the
  fixed version. Other options: skip prompts already run for this model, retry on
  API failure, and a delay between prompts for rate-limited providers.
- A live preview follows the current generation; a summary at the end reports how
  many were generated, scored, fixed, skipped, and failed.
- When the run finishes you can **flick through everything it produced**: the
  arrows (or the ← / → keys) step through each generated SVG, clicking a row in
  the list jumps straight to it, and **Open** takes you to that benchmark.
- **Past Runs** (dialog header) rebuilds every earlier batch run from the saved
  submissions — pick a run by model/date and flick through its SVGs the same way.

### Parameters and sweeps

The **Parameters** section controls sampling per request. Leave a field blank to
use the model's own settings in LM Studio (that's the default, and it keeps old
results comparable). Type one value to pin it, or a **comma-separated list to
sweep it**: `0, 0.7, 1.2` on Temperature runs every selected prompt three times,
once per value. Sweeping several fields multiplies out — the dialog shows the
resulting number of generations before you commit.

Each submission records the parameters used plus what actually happened:
tokens/sec, time-to-first-token, token counts, whether the model **thought** (and
how many reasoning tokens it spent), and the finish reason. That's what makes
"which settings suit this model + quant" answerable from the saved data.

Two gotchas worth knowing:

- **Max Tokens is dangerous with thinking models.** A reasoning model can spend
  the entire budget thinking and return empty content — the run reports this
  explicitly rather than as a mysterious "empty response". Leave it blank unless
  you mean it.
- **Thinking often can't be switched off.** `Thinking: false` and
  `Reasoning Effort` are only honoured by models that expose them; Gemma 4, for
  instance, thinks regardless. The app records what the model *did*, not what was
  asked of it.

Thinking output (`<think>…</think>`) and markdown fences are stripped before the
SVG is validated, so a model's monologue no longer corrupts the artwork.

The prompt set ships with the app (`data/prompts.json`, harvested from the
benchmarks) so batch works even on a fresh data root — missing benchmarks are
created automatically.

## Scoring

- **Auto-score** — renders both the SVG and the reference image to canvas, runs a pixel-level comparison, and returns a 0–100 % similarity score.
- **Manual score** — press 1–9 on the keyboard (outside of text inputs) to quickly rate a submission.

## Record video

Use **Record** in the toolbar to capture an SVG authoring session, benchmark
review or side-by-side run comparison. Choose 30 or 60 FPS and optionally
request tab/system audio; Chrome always presents its capture-source picker.
Pause, resume and stop are available from the floating recording controls.

**MP4 · H.264** is the default upload-friendly format. WebM is also available
and becomes the automatic fallback when the browser cannot encode MP4 natively.

Download the result directly or save it append-only under
`<root>/svg-benchmark/recordings/<recording-id>/`. Its metadata records the
active benchmark, prompt, scores, provider and model when available.

## Tips

- Use descriptive, specific prompts — models produce better SVGs when given clear constraints (dimensions, colour palette, style).
- Save a reference image first, then generate with multiple models and compare scores to find the best one.
- The benchmark folder structure is plain files on disk (`prompt.txt`, `reference.png`, per-submission SVG + metadata JSON), so you can version-control or share them easily.

## Keyboard

- **Ctrl+S** — Save current submission.
- **Ctrl+G** — Jump to Benchmarks view.
- **Ctrl+D** — Toggle diff overlay.
- **1–9** — Set manual score (when not focused on a text input).
- **Escape** — Close any dialog.

## Troubleshooting

- *"No SVG code to save"* — generate or paste SVG code before saving.
- *Auto-score not available* — you need both an SVG and a reference image loaded.
- *Directory not connected* — click the folder icon to pick a working directory. Only Chromium-based browsers support the File System Access API.
- *Model list empty* — open Provider Settings (server icon) and enable at least one provider with a valid API key or endpoint. For hosted LM Studio, enable CORS (`lms server start --cors`), use `http://localhost:1234`, press **Test**, and allow Chrome/Edge local-network access when prompted.

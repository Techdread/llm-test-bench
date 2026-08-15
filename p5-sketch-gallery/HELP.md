# p5 Sketch Gallery

A creative-coding library: store, preview, tag and remix p5.js sketches as living
canvases (not static HTML). Same collect-and-compare loop as Prompt Gallery,
but with tunable parameters, fixed seeds, motion thumbnails and remix lineage.

## Getting started

1. Open **Settings → Data Root** and pick the folder where your sketches will live.
   The app stores everything under `<root>/p5-sketch-gallery/projects/<sketch-id>/`.
2. Click the **🔑 key icon** in the toolbar to paste a free OpenRouter API key
   (only needed if you want to generate or explain sketches with an LLM).
3. Pick a model in the dropdown.
4. Type a prompt (e.g. *"flocking arrows on a dark grid that react to mouse"*)
   and hit **⚡ Generate**, or just edit the default sketch on the left and watch
   the canvas in the centre update live.
5. Tweak parameters in the right rail; numeric params get sliders for free.
   The panel is rebuilt from the sketch itself on every generation — see below.
6. **Save** writes a folder containing `sketch.js`, `prompt.md`, `params.json`,
   `metadata.json` and a `thumb.png` captured from the live canvas.

## The Save dialog

- The top panel shows how the sketch was made — **AI generated** / **Hand
  written** / **Built-in example** — plus the model and provider that produced
  it and when. That comes from the generation itself, so you never have to
  remember which model you were on; the ✏️ button lets you correct it.
- **Title**, **Description** and **Tags** each have a 🪄 wand that asks the
  currently selected model to write that field from your prompt and sketch
  source. **Auto-fill empty** does all three at once and only touches fields
  you left blank — it never overwrites what you typed.
- The description is saved as the sketch notes, so it shows up in the gallery
  and comes back when you reopen the sketch.
- Suggestions need a model selected and a prompt or some source to read. If a
  suggestion comes back empty, the model returned no text (some thinking models
  do this) — try another one.

## The Create screen

- **Left** — prompt + sketch source code (Ace editor, JS mode).
- **Centre** — live canvas preview with FPS overlay and a runtime-error banner.
- **Right rail** — playback (play/pause/restart/seed), parameters (JSON +
  per-numeric sliders), tags, notes, and AI helpers.

## Parameters come from the code

A sketch declares its own controls by reading them:

```js
const wingSpeed = ctx.params.wingSpeed ?? 0.35;   // slider: wingSpeed, default 0.35
const glow      = ctx.params.glow ?? true;        // no slider (not a number), still in the JSON
```

The default must be a plain literal — `80`, `0.35`, `true`, `"left"` — because
the app reads those literals out of your source to build the panel.
Destructuring (`const { speed = 1.2 } = ctx.params`) works too.

- **After a generation** the panel is rebuilt from the new sketch, using that
  sketch's own defaults. Knobs from the previous sketch disappear, because they
  no longer drive anything.
- **The ⟳ button** in the Parameters header re-reads the code on demand — use it
  after hand-editing a sketch. It keeps values you have already tuned and just
  adds or removes knobs.
- If a sketch touches `ctx.params` in a way the app can't parse (a computed key,
  say), the panel is left alone rather than wrongly emptied.
- **Remix params** only retunes knobs the sketch actually reads; invented keys
  are ignored so dead sliders can't pile up.

## Sketch format

User code must define an instance-mode function with this signature:

```js
function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
  };
  p.draw = () => {
    // ... use ctx.params.foo to read parameters ...
  };
}
```

- `p` is a p5 instance — call methods on it (`p.background`, `p.line`, …).
- `ctx.seed` is the deterministic seed; pass it to `p.randomSeed` /
  `p.noiseSeed` in `setup` so reloads reproduce the same picture.
- `ctx.params` is the tunable object from the right rail. Read defaults with
  `ctx.params.count ?? 80`.

The runner wraps `setup`/`draw` so runtime errors surface in the bottom red
banner instead of locking the page; the iframe is fully sandboxed.

## Gallery

- Cards show the still thumbnail captured at save time, the model badge, tags
  and a small lineage arrow (⤷) for remixes.
- **Filter** by title/notes; **Tag** dropdown narrows further.
- Card actions: open, add to compare, **remix** (loads as a child sketch — when
  you save it, it becomes a new sketch with the parent recorded), and delete.

## Curated prompts

Open the **Prompts** tab for a searchable catalogue of ambitious p5.js ideas,
grouped into emergence, physics, WebGL and shaders, interactive tools, games,
and data/sound. These prompts are written for this app's `sketch(p, ctx)` format
and call out the algorithms, interactions, performance constraints and tunable
parameters that make each result interesting.

- **Use** loads the prompt, title, tags and notes into Create so you can edit it.
- **Generate** loads it and immediately runs the selected model.
- Click a prompt description to expand it and read the design notes.
- When a data root is connected, the tab also scans `projects/` and adds unique
  prompts from your saved sketches. Exact and near-duplicate generations are
  collapsed into one card with a count, so repeated runs do not swamp the list.
- **Rescan gallery** picks up prompts saved while the tab is already open.

## Batch generation

The **Batch** button runs one selected model across many prompt-library entries
in sequence and saves every successful result as a new gallery project.

1. Select the prompts to run. **All** and **None** make large selections quick.
2. Choose the provider/model in the dialog.
3. Optionally skip prompts already generated by that exact provider/model,
   retry temporary API failures, add a rate-limit delay, or disable thumbnails.
4. Press **Run**. Code streams into a live p5 canvas while the queue reports
   generation, validation, rendering and save progress. **Stop** finishes the
   current request and leaves later prompts untouched.

Thumbnail capture waits for each valid sketch to animate before taking a frame;
adjust **Warm-up** for simulations that need longer to become visually useful.
Every save is append-only and records the shared batch id, prompt, model/provider,
sampling parameters, token telemetry, sketch parameters and deterministic seed.

Open **Generation parameters** to pin provider settings or enter comma-separated
values for a sweep. For example, Temperature `0.2, 0.8` runs every selected prompt
twice. The dialog shows the full prompt × parameter-set job count before starting.

After completion, review every live sketch with the arrow buttons and open any
result in Create. The **Runs** tab reconstructs earlier batches from project
metadata, so run history survives reloads and remains usable as metadata evolves.
Open one run for a live sketch-by-sketch review, or select 2–9 runs to compare
matching prompts and parameter sweeps side by side.

## Compare

- Pick 2–4 sketches. They run side by side in synced iframes.
- **Pause / Play all** stops or starts every pane together.
- **Restart all** rebuilds every pane with the current shared seed — so two
  sketches keyed on the same seed render reproducibly.

## Record video

The toolbar **Record** button captures a browser tab, window or display using
Chrome's built-in sharing picker. Choose 30 or 60 FPS and optionally request tab
or system audio. Chrome always asks which surface to share; the app cannot grant
itself permanent screen-recording permission.

**MP4 · H.264** is selected by default for straightforward uploads to services
such as YouTube and Reddit. WebM remains available and is used automatically if
the browser cannot encode MP4 directly.

While recording, the floating controls show elapsed time and let you pause,
resume or stop. The controls themselves are visible if you record the current
tab. When recording ends, preview the video and either download it or save it
append-only under `<root>/p5-sketch-gallery/recordings/<recording-id>/` with a
metadata file recording the route, current sketch, dimensions, codec and timing.
Download remains available when no data root is connected.

## AI helpers

- **Generate** — produces a full `sketch(p, ctx)` from your prompt.
- **Explain** — walks through *this* sketch by name (variables, params, helpers)
  rather than generic creative-coding advice.
- **Remix params** — proposes 4 parameter presets you can apply with one click.
- **💡 Brainstorm prompts** (lightbulb icon in the prompt header) — opens a dialog
  where you give the model a theme (e.g. *"organic textures"*, *"escher tiling"*)
  and it returns ten concrete sketch prompts. Click any chip to drop it into the
  prompt field.
- **✨ More like this** (sparkles icon in the prompt header) — uses your current
  prompt as the seed and returns six neighbouring variations. Disabled until you
  have a prompt typed.

All five stream over the model you've selected in the toolbar.

## Keyboard

- **Ctrl/Cmd + S** — open the Save dialog.
- **Ctrl/Cmd + G** — jump to Gallery.
- **Space** — play/pause the live preview (when not typing in a field).

## Troubleshooting

- *"Sketch must define a function named sketch(p, ctx)."* — your code defines
  `setup()`/`draw()` as globals instead of attaching them to `p`. Wrap the body
  in `function sketch(p, ctx) { p.setup = ... }`.
- *Errors in the red banner* — they include a stack trace; the loop is paused
  until you change the code.
- *No models in the picker* — you haven't pasted an API key, or the configured
  provider is unreachable. For a hosted-site connection to LM Studio, start the
  server with CORS enabled (`lms server start --cors`), add
  `http://localhost:1234` through the server button or public Settings page,
  press **Test**, and allow Chrome/Edge local-network access when prompted.

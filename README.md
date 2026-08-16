<div align="center">

# LLM Test Bench

**Generate it. Compare it. Keep the evidence.**

A browser-based workbench for testing how language models turn the same idea into
interactive HTML, p5.js sketches, and SVG artwork.

[**Open the live site**](https://neuroviz.uk) · [Prompt Gallery](#prompt-gallery) · [p5 Sketch Gallery](#p5-sketch-gallery) · [SVG Generation Gallery](#svg-generation-gallery) · [Quick start](#quick-start)

![Licence](https://img.shields.io/badge/licence-MIT-blue) ![No build step](https://img.shields.io/badge/build-none-brightgreen) ![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge-informational)

</div>

---

Three focused test benches, one shared workflow: pick a prompt, run it through any
model you like, and keep every result with the model, seed, and parameters that
produced it. No accounts, no database, no telemetry — your work is written to a
folder you choose on your own machine.

<!-- VIDEO: replace with a 20–40s overview clip once recorded. See "Adding the videos" below. -->

## What you can do

| | |
|---|---|
| **Bring your own model** | OpenRouter with your key, or a local LM Studio / OpenAI-compatible server. The browser talks to it directly — nothing is relayed through the site. |
| **Keep the evidence** | Every save records the prompt, provider, model, seed, and parameters. Saves are append-only by default, so a run never overwrites an earlier one. |
| **Compare properly** | Run one prompt across several models, put the results side by side, rate them, and export what you find. |
| **Own your files** | Pick a folder once; the apps create their own subfolders inside it and write there through the File System Access API. |
| **Record a walkthrough** | Each app has a built-in screen recorder for capturing what a model produced. |

## The three benches

### Prompt Gallery

Generate standalone interactive HTML from a prompt, preview it in a sandboxed
frame, and keep the ones worth keeping.

- 62 starter prompts covering simulations, tools, games, and visualisations
- Streaming generation, batch runs across a whole prompt set, and self-healing retries
- Gallery, side-by-side comparison, ratings, refinement, and full metadata

<!-- VIDEO: Prompt Gallery walkthrough -->

### p5 Sketch Gallery

Generate instance-mode p5.js sketches with reproducible seeds and live parameter
controls.

- 24 ambitious starter prompts aimed at generative and emergent work
- Sandboxed live canvas, seed control, and tunable `ctx.params`
- Remix a sketch into a variant, explain it, compare lineages, capture video

<!-- VIDEO: p5 Sketch Gallery walkthrough -->

### SVG Generation Gallery

Ask a model for vector artwork, then measure how close it got.

- 63 starter prompts, from simple icons to detailed illustrations
- Pixel-diff scoring against a reference image, plus manual scoring
- Structure inspection, batch runs across the full prompt set, and export

<!-- VIDEO: SVG Generation Gallery walkthrough -->

## Quick start

Nothing to install and nothing to build.

```bash
git clone https://github.com/Techdread/llm-test-bench.git
cd llm-test-bench
python3 -m http.server 8080
```

Open <http://localhost:8080> in Chrome or Edge.

> Do not open the files with a `file://` URL. ES modules and folder access need an
> HTTP(S) origin.

Then:

1. **Settings → Choose folder.** Pick a folder you are happy for the apps to
   organise. They create `prompt-gallery/`, `p5-sketch-gallery/`, and
   `svg-benchmark/` inside it as you go.
2. **Settings → connect a model.** Either add your OpenRouter key inside an app, or
   point the Settings page at a local server (below).
3. **Open a bench and generate.**

### Using a local model

For LM Studio:

1. Load a model and start the server with CORS enabled — Developer settings, or
   `lms server start --cors`.
2. On the **Settings** page, add `http://localhost:1234`.
3. Click **Add & test** and allow the browser's local-network permission prompt.
4. Open any bench and pick the discovered model from its normal model picker.
   Batch mode uses the same selection.

Any OpenAI-compatible server works with the LM Studio endpoint type as long as it
exposes `/v1/models` and `/v1/chat/completions` and allows the site's origin
through CORS. Unsloth Studio has its own endpoint type.

> **Never commit an API key**, and never paste one into an issue, screenshot, or
> recording. Keys live in your browser and are sent only to the provider you pick.

## How it is built

Native ES modules, Preact, and HTM tagged templates. No JSX, no bundler, no
transpilation, no `package.json` at the app level. Every runtime dependency is
vendored under `shared/lib/` and served from the same origin — the site makes no
third-party requests at all.

```text
prompt-gallery/     HTML generation and comparison
p5-sketch-gallery/  p5.js generation and gallery
svg-benchmark/      SVG generation and scoring
shared/             components, services, styles, and vendored runtimes
```

Tests use Node's built-in runner:

```bash
node --test prompt-gallery/tests/*.test.mjs
node --test p5-sketch-gallery/tests/*.test.mjs
node --test svg-benchmark/tests/*.test.mjs
```

## Browser support

Chrome and Edge are recommended. Other modern browsers can open the editors and
previews, but folder access and screen recording vary. The site must be served over
HTTPS or `localhost` — folder access, local-network access, and recording are all
secure-context features.

## Hosted edition versus the local hub

This repository is the static, hosted-safe edition. It supports local **model
servers** but not local **CLI coding agents** or cross-app handoffs, which depend on
a Python bridge and apps outside this release. Local models and local CLI agents are
different connection types; only the latter is absent here.

## Adding the videos

Each app's toolbar has a **Record** button that captures a walkthrough. To put one
in this README:

1. Record the walkthrough in the app and save the file (the recorder produces MP4
   where the browser supports it, otherwise WebM).
2. Open this README in GitHub's web editor and **drag the file into the text area**.
   GitHub uploads it and inserts a `https://github.com/user-attachments/assets/…`
   URL.
3. Leave that URL on its own line where the matching `<!-- VIDEO: … -->` comment is
   and delete the comment. GitHub renders it as an inline player.

Notes: GitHub caps attachment size (10 MB on free plans at the time of writing), so
keep clips short or trim them. Repo-relative `<video>` tags do **not** render in a
README — a committed animated GIF referenced with normal image syntax does, and is a
good fallback for anything longer.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests with a
short reproduction or test are easiest to review.

## Security and privacy

Generated code is untrusted input even when a model produced it. Previews run in
sandboxed iframes, but review generated code before running it elsewhere or sharing
it. See [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

[MIT](LICENSE). Vendored dependencies keep their own licences.

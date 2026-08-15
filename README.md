# LLM Test Bench

LLM Test Bench is a local-first collection of browser tools for comparing model-generated creative code. The first public release contains:

- **Prompt Gallery** — generate, preview, save, rate, refine, batch, and compare standalone HTML.
- **p5 Sketch Gallery** — generate and tune p5.js sketches with reproducible seeds and parameters.
- **SVG Generation Gallery / Benchmark** — generate SVG, compare it with references, score it, and export it.

The hosted site is static. There are no user accounts and no project database: in Chrome or Edge, you choose a local data folder and the apps save there through the File System Access API.

## Try it locally

No install or build step is required.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in Chrome or Edge.

Do not open the HTML files directly with a `file://` URL. Browser modules and folder access need an HTTP(S) origin.

## Using an AI provider

Open a tool, select the key/provider control, and add your own provider credentials. OpenRouter is the default. Keys are stored in browser storage and are sent only to the configured provider when you make a request.

Never commit an API key. Never paste one into an issue, screenshot, recording, or sample file.

## Hosted edition versus the private development hub

The public edition includes the features that can run safely in a static HTTPS website. Local CLI agents and cross-app handoffs are not included because they depend on the private hub's local Python bridge or apps outside this release. Their absence is intentional, not a failed connection.

## Project layout

```text
prompt-gallery/          HTML generation and comparison
p5-sketch-gallery/       p5.js generation and gallery
svg-benchmark/           SVG generation and scoring
shared/                  shared components, services, styles, and vendored runtimes
```

The project uses native ES modules, Preact, and HTM. Runtime dependencies are vendored under `shared/lib/`; there is no app-level package manager or transpilation step.

## Browser support

Chrome and Edge are recommended. Other modern browsers can open the editors and previews, but folder access and screen recording support varies.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Small, focused pull requests with a short reproduction or test are easiest to review.

## Security and privacy

Generated code is untrusted input even when it came from a model. The apps use sandboxed iframes for previews, but you should still review generated code before sharing or running it elsewhere. Read [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

The project source is available under the [MIT Licence](LICENSE). Vendored dependencies retain their own licences.

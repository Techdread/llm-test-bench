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

Local models are supported directly from both the hosted site and a local checkout. For LM Studio:

1. Load a model and start the local server with CORS enabled (Developer settings, or `lms server start --cors`).
2. Open the website's **Settings** page and add `http://localhost:1234`.
3. Click **Add & test** and allow the browser's local-network permission when prompted.
4. Open a gallery and choose the discovered local model from its normal model picker. Batch mode uses the same selection.

The browser connects straight to the endpoint; prompts and responses are not relayed through the hosted site. Other OpenAI-compatible local servers can use the LM Studio endpoint type when they expose `/v1/models` and `/v1/chat/completions` and permit the website origin through CORS.

Never commit an API key. Never paste one into an issue, screenshot, recording, or sample file.

## Hosted edition versus the private development hub

The public edition includes the features that can run safely in a static HTTPS website. Local model servers are supported. Local **CLI coding agents** and cross-app handoffs are not included because they depend on the private hub's Python bridge or apps outside this release; local models and local CLI agents are different connection types.

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

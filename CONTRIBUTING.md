# Contributing

Thank you for helping improve LLM Test Bench. Beginner contributions are welcome.

## Before starting

1. Search existing issues to see whether the idea or bug is already being discussed.
2. For a substantial feature, open an issue before writing the implementation so scope and browser behaviour can be agreed.
3. Keep pull requests focused on one change.

## Run the site

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in Chrome or Edge. There is no npm install or compilation step.

## Code conventions

- Use native browser ES modules and keep Preact components in HTM tagged templates; do not add JSX or a build pipeline.
- Import browser libraries from the vendored paths under `shared/lib/`, not from public CDNs.
- Put reusable, DOM-free logic in `services/` and keep components thin.
- Saves are append-only unless the interface explicitly says Update or Replace.
- Keep generated standalone artefacts portable; do not make them depend on this repository's `shared/lib/` folder.
- Never commit credentials, personal paths, private IP addresses, model caches, or generated run archives.

## Tests

Tests use Node's built-in test runner. Run a specific suite with, for example:

```bash
node --test prompt-gallery/tests/*.test.mjs
node --test p5-sketch-gallery/tests/*.test.mjs
node --test svg-benchmark/tests/*.test.mjs
```

Also test the changed workflow in Chrome. In your pull request, say what you tested and which browser/version you used.

## Pull requests

- Explain the user-visible outcome first.
- Include screenshots or a short recording for interface changes.
- Mention security or privacy effects, especially for generated code, API calls, browser storage, and filesystem access.
- Do not include unrelated formatting or generated files.

By contributing, you agree that your contribution is licensed under the repository's MIT Licence.

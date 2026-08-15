# Security policy

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** feature on the repository Security tab. Do not open a public issue for a vulnerability that could expose API keys, local files, or a user's browser session.

Include:

- the affected tool and browser;
- a minimal reproduction;
- the impact you observed;
- whether generated content or a provider response is required to trigger it.

Do not include real API keys, personal files, or private prompts. Use obvious dummy values and a minimal test file.

## Security model

- This is a static, local-first application. It does not provide authentication or a server-side secret store.
- Provider keys are browser-side credentials. Anyone with access to the browser profile, page context, or developer tools may be able to retrieve them.
- Generated HTML, JavaScript, p5.js, and SVG must be treated as untrusted.
- Local CLI-agent endpoints are not part of the hosted edition and must never be exposed to the public internet.

## Supported version

Security fixes are made on the latest release. Older snapshots may not receive patches.

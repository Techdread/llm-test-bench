# Third-party notices

LLM Test Bench is MIT licensed, but the vendored runtime files under `shared/lib/` retain their upstream licences. The public build currently includes:

| Package | Version | Licence | Upstream |
|---|---:|---|---|
| Preact | 10.19.3 | MIT | https://github.com/preactjs/preact |
| HTM | 3.1.1 | Apache-2.0 | https://github.com/developit/htm |
| Font Awesome Free | 6.5.1 | Icons: CC BY 4.0; fonts: SIL OFL 1.1; code: MIT | https://github.com/FortAwesome/Font-Awesome |
| Ace | 1.32.6 | BSD-3-Clause | https://github.com/ajaxorg/ace-builds |
| Highlight.js | 11.9.0 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| Marked | 11.1.1 and 12.x browser bundle | MIT | https://github.com/markedjs/marked |
| DOMPurify | 3.x browser bundle | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |
| p5.js | 1.9.4 | LGPL-2.1 | https://github.com/processing/p5.js |
| gifenc | 1.0.3 | MIT | https://github.com/mattdesl/gifenc |

Every runtime dependency is vendored under `shared/lib/` and served from the same
origin as the site. The published site makes no requests to third-party CDNs.

The corresponding upstream licence texts are included in `LICENSES/`. The vendored files are intentionally kept replaceable and unmodified; corresponding source is available from each linked upstream repository at the version shown above. In particular, the p5.js 1.9.4 source is available from https://github.com/processing/p5.js/tree/v1.9.4.

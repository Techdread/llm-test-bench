# Third-party notices

The projects in this repository are MIT licensed, but the vendored runtime files under `shared/lib/` retain their upstream licences. The public build currently includes:

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
| Pyodide | 0.25.0, 0.25.1 | MPL-2.0 (bundled Python packages keep their own licences) | https://github.com/pyodide/pyodide |
| sql.js | 1.10.3 | MIT | https://github.com/sql-js/sql.js |
| JSCPP | 2.0.9 | MIT | https://github.com/felixhao28/JSCPP |
| Acorn, acorn-walk, acorn-loose | 8.11.3, 8.3.2, 8.4.0 | MIT | https://github.com/acornjs/acorn |
| three.js | 0.185.1 and 0.128.0 (`three.min.js` only) | MIT | https://github.com/mrdoob/three.js |
| fflate | 0.8.2 | MIT | https://github.com/101arrowz/fflate |
| html2canvas | 1.4.1 | MIT | https://github.com/niklasvh/html2canvas |
| IWER (Immersive Web Emulation Runtime) | 2.3.0 | MIT | https://github.com/meta-quest/immersive-web-emulation-runtime |
| Mesh2Motion | 1.0.0 | Code: MIT; models, rigs and animations: CC0-1.0 | https://github.com/Mesh2Motion/mesh2motion-app |

Game Forge and VR Forge copy a pinned set of engine files into each generated
project. Only those files are published (see `shared/forge/services/projectLibraries.js`):

| Package | Version | Licence | Upstream |
|---|---:|---|---|
| Phaser | 3.80.1 | MIT | https://github.com/phaserjs/phaser |
| PixiJS | 7.4.0 | MIT | https://github.com/pixijs/pixijs |
| Babylon.js | 9.18.0 | Apache-2.0 | https://github.com/BabylonJS/Babylon.js |
| PlayCanvas Engine | 2.21.1 | MIT | https://github.com/playcanvas/engine |
| KAPLAY | 3001.0.19 | MIT | https://github.com/kaplayjs/kaplay |
| Kontra | 10.0.2 | MIT | https://github.com/straker/kontra |
| melonJS | 19.9.0 | MIT | https://github.com/melonjs/melonJS |
| Matter.js | 0.20.0 | MIT | https://github.com/liabru/matter-js |
| Planck.js | 1.5.0 | MIT | https://github.com/piqnt/planck.js |
| Rapier (rapier3d-compat) | 0.14.0 | Apache-2.0 | https://github.com/dimforge/rapier.js |
| Tone.js | 14.8.49 | MIT | https://github.com/Tonejs/Tone.js |
| howler.js | 2.2.4 | MIT | https://github.com/goldfire/howler.js |

Every runtime dependency is vendored under `shared/lib/` and served from the same
origin as the site. The published site makes no requests to third-party CDNs.

The corresponding upstream licence texts are included in `LICENSES/`. The vendored files are intentionally kept replaceable and unmodified; corresponding source is available from each linked upstream repository at the version shown above. In particular, the p5.js 1.9.4 source is available from https://github.com/processing/p5.js/tree/v1.9.4.

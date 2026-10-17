# Mesh2Motion components

Source: https://github.com/Mesh2Motion/mesh2motion-app
Pinned revision: `2d3d1ff03247d9e7e830d1ae375653da4e2146e2`.

The solver files and SkeletonType enum are upstream TypeScript transpiled to ES2022 JavaScript with esbuild 0.28.2 (no algorithm changes). Utilities contains only the five solver helpers; RigConfig is a humanoid-only configuration adapter. Code is MIT, copyright Scott Petrovic; the complete notice is in LICENSE-MIT.MD.

`assets/rig-human.glb` is the upstream human skeleton. `human-base-animations.glb` contains all 87 base-library clips; the example mesh, materials and images were removed and the animation buffers repacked. These core assets are covered by upstream LICENSE-CC0.MD. No third-party variation models, Carnegie Mellon samples, tracking code, hosted services, or upstream UI are included.

Understory fits the skeleton, runs the solver in a disposable worker, validates its weights, and adapts clip translations to the fitted proportions. Browser loading is local and lazy. See ../../animation.js and ../../humanoid.js for our integration.

## Hub vendoring notes (DevTools Hub)

Vendored for spec 336 (Understory Studio) from the standalone Understory project
at `experiments/character/studio/vendor/mesh2motion/`, byte-identical except for
one mechanical rewrite: the bare `three` import specifier in `Utilities.js` and
the six solver files now points at `shared/lib/three/0.185.1/build/three.module.js`
by relative path. That is required because the solver runs inside a module
Worker, and **workers do not inherit the document's import map** — a bare
specifier would fail to resolve at load. No algorithm or API change.

Version folder `1.0.0` is a hub-local label; upstream ships no semver release.
The authoritative pin is the revision recorded above.

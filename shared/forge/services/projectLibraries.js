// Shared Forge project-library registry and provisioner.
//
// Hub applications load their own runtimes from shared/lib. Generated Forge
// projects never do: selected files are copied into the project's own lib/
// folder before generation, checked against pinned hashes, included in export,
// and checked again after the model has finished.

const ALL_FORGE_DOMAINS = Object.freeze([
  'game', 'simulation', 'graphics', 'shader', 'web-app', 'application',
  'lesson-exercise', 'documentation-api', 'code-repair',
]);

// `vr` is deliberately NOT in that list: it opts in library by library. A VR
// project has no use for a 2D sprite engine, and offering one would only
// produce projects that cannot enter a session.

export const PROJECT_LIBRARY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'engine',
    label: 'Engine / renderer',
    description: 'Choose at most one primary foundation. Choose none for Vanilla Canvas.',
  }),
  Object.freeze({
    id: 'physics',
    label: 'Physics',
    description: 'Optional physics layer. Choose at most one.',
  }),
  Object.freeze({
    id: 'audio',
    label: 'Audio',
    description: 'Optional sound layer. Choose at most one.',
  }),
  Object.freeze({
    id: 'services',
    label: 'Hub services',
    description: 'Optional runtime bridge to this hub: model answers, generated images, a local CLI agent. A project that uses it only runs inside the hub.',
  }),
]);

const file = (sourceUrl, path, bytes, sha256, kind = 'runtime') => Object.freeze({
  sourceUrl, path, bytes, sha256, kind,
});

const classic = (path, globalName) => Object.freeze({
  type: 'classic',
  path,
  globalName,
  include: `<script src="${path}"></script>`,
});

const moduleEntry = (path, importExample) => Object.freeze({
  type: 'module',
  path,
  importExample,
});

function library(definition) {
  const files = Object.freeze(definition.files);
  const entry = definition.entry;
  return Object.freeze({
    ...definition,
    files,
    entry,
    path: entry.path,
    sourceUrl: files.find(item => item.path === entry.path)?.sourceUrl || files[0]?.sourceUrl,
    globalName: entry.globalName || null,
    include: entry.include || null,
    approxBytes: files.reduce((sum, item) => sum + item.bytes, 0),
    domains: Object.freeze(definition.domains || ALL_FORGE_DOMAINS),
    briefing: Object.freeze(definition.briefing || []),
    domainBriefing: Object.freeze(definition.domainBriefing || {}),
  });
}

export const PROJECT_LIBRARIES = Object.freeze({
  p5: library({
    id: 'p5',
    label: 'p5.js 1.9.4',
    version: '1.9.4',
    group: 'engine',
    description: 'Creative coding, procedural visuals and approachable 2D games.',
    entry: classic('lib/p5.min.js', 'p5'),
    files: [
      file('../../lib/p5.js/1.9.4/p5.min.js', 'lib/p5.min.js', 1_034_532, '00a532c56e785c68d7c7bb6f9a084e2c856b71527f22c3260aff4a2f582d80c9'),
    ],
    briefing: [
      'Use p5 global mode with setup() and draw(); do not import p5 as a module.',
      'Create the canvas explicitly and keep game state separate from rendering callbacks.',
    ],
  }),
  phaser: library({
    id: 'phaser',
    label: 'Phaser 3.80.1',
    version: '3.80.1',
    group: 'engine',
    description: 'Full 2D game engine with scenes, input, sprites, tilemaps and physics.',
    entry: classic('lib/phaser.min.js', 'Phaser'),
    files: [
      file('../../lib/phaser/3.80.1/phaser.min.js', 'lib/phaser.min.js', 1_181_917, '62081f6a1b51d040473f919ffedef9009953c20833518e146da5a8d1c9405ea8'),
    ],
    domains: ['game', 'simulation', 'lesson-exercise'],
    briefing: [
      'Use the global Phaser object and Phaser 3 scene APIs.',
      'Prefer Phaser Arcade Physics unless the brief specifically requires the bundled Matter integration.',
    ],
  }),
  pixi: library({
    id: 'pixi',
    label: 'PixiJS 7.4.0',
    version: '7.4.0',
    group: 'engine',
    description: 'High-performance 2D rendering for sprites, particles and custom engines.',
    entry: classic('lib/pixi.min.js', 'PIXI'),
    files: [
      file('../../lib/pixi.js/7.4.0/pixi.min.js', 'lib/pixi.min.js', 456_074, '2d716f9557afab2966fe17f190d6c2583364d8460b58f488374f4fa5f3770fcb'),
    ],
    briefing: [
      'Use the global PIXI object and PixiJS v7 APIs.',
      'PixiJS is a renderer, not a complete game engine; implement the loop, input and game rules in project code.',
    ],
  }),
  three: library({
    id: 'three',
    label: 'Three.js classic r128',
    version: '0.128.0',
    group: 'engine',
    description: 'Classic-script Three.js for portable WebGL and 3D projects.',
    entry: classic('lib/three.min.js', 'THREE'),
    files: [
      file('../../lib/three/0.128.0/build/three.min.js', 'lib/three.min.js', 603_445, '9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2'),
    ],
    briefing: [
      'This is r128 core only. No OrbitControls, GLTFLoader, EffectComposer or examples/jsm add-ons are present.',
      'Use r128-era APIs and implement simple camera controls or effects in project code.',
      'Reuse BufferGeometry attributes instead of rebuilding geometry every animation frame.',
    ],
    domainBriefing: {
      simulation: [
        'Keep the deterministic model DOM-free and THREE-free; rendering belongs in a separate renderer module.',
        'If WebGL is unavailable, metrics, configuration and headless experiments must keep working.',
      ],
    },
  }),
  babylon: library({
    id: 'babylon',
    label: 'Babylon.js 9.18.0',
    version: '9.18.0',
    group: 'engine',
    description: 'Batteries-included 3D engine. Powerful, but adds about 8 MB.',
    entry: classic('lib/babylon.js', 'BABYLON'),
    files: [
      file('../../lib/babylonjs/9.18.0/babylon.js', 'lib/babylon.js', 8_180_848, '1b7e6718668aa1a6ca53c9539aaa7d539dbf166bd1ded9eef262e58cb575a3a7'),
      file('../../lib/babylonjs/9.18.0/LICENSE.md', 'lib/licenses/babylonjs-9.18.0.txt', 9_226, '9362ea9ea17cb221a20cbbd63f404710834cc273d2a9a7b60314fd68ab702cd6', 'license'),
    ],
    domains: ['game', 'simulation', 'graphics', 'shader'],
    briefing: [
      'Use the global BABYLON object. This profile contains the core UMD engine only.',
      'Do not assume optional loaders, GUI packages, Havok or external assets are installed.',
      'Keep geometry and textures procedural unless the project itself contains the required asset.',
    ],
  }),
  playcanvas: library({
    id: 'playcanvas',
    label: 'PlayCanvas Engine 2.21.1',
    version: '2.21.1',
    group: 'engine',
    description: 'WebGL/WebGPU-oriented 3D engine with an entity/component architecture.',
    entry: classic('lib/playcanvas.min.js', 'pc'),
    files: [
      file('../../lib/playcanvas/2.21.1/playcanvas.min.js', 'lib/playcanvas.min.js', 2_373_183, '1c21dbd51b19d0eb048e936bcb69dbc1779c12ed5eb0a8210f7d20e4c6253a47'),
      file('../../lib/playcanvas/2.21.1/LICENSE', 'lib/licenses/playcanvas-2.21.1.txt', 1_064, '42fa51ddd556be151a29f381fb97ee975825dcc454e805ea3ea9c079cca04d34', 'license'),
    ],
    domains: ['game', 'simulation', 'graphics', 'shader'],
    briefing: [
      'Use the global pc namespace and the standalone PlayCanvas Engine, not the hosted PlayCanvas Editor.',
      'Do not request cloud assets or Editor services; create entities and resources in project code.',
    ],
  }),
  kaplay: library({
    id: 'kaplay',
    label: 'KAPLAY 3001.0.19',
    version: '3001.0.19',
    group: 'engine',
    description: 'Approachable component-based 2D game library and Kaboom successor.',
    entry: classic('lib/kaplay.js', 'kaplay'),
    files: [
      file('../../lib/kaplay/3001.0.19/kaplay.js', 'lib/kaplay.js', 189_085, '88a946eafc4161f83505449d830b87c7bc15822bb0dae8ce03b2437506ef4a4b'),
      file('../../lib/kaplay/3001.0.19/LICENSE.md', 'lib/licenses/kaplay-3001.0.19.txt', 1_957, '04548e9fae3b077ce4db0c58163a3f35da5ca561779cda7626bf84e389e81dd6', 'license'),
    ],
    domains: ['game', 'lesson-exercise'],
    briefing: [
      'Call the global kaplay(options) function once, then use the returned/global KAPLAY component APIs.',
      'Do not fetch sprite or sound URLs; use shapes, text and project-local assets.',
    ],
  }),
  kontra: library({
    id: 'kontra',
    label: 'Kontra.js 10.0.2',
    version: '10.0.2',
    group: 'engine',
    description: 'Tiny 2D game toolkit suited to compact arcade projects.',
    entry: classic('lib/kontra.min.js', 'kontra'),
    files: [
      file('../../lib/kontra/10.0.2/kontra.min.js', 'lib/kontra.min.js', 33_089, 'e9bf6a3b29e8d25132cd971bfd129c0dce8dcca2a51527bb64273b95c389caf0'),
      file('../../lib/kontra/10.0.2/LICENSE', 'lib/licenses/kontra-10.0.2.txt', 1_080, 'd0336c6366f27726fa732ac33f15c444e95223483b660fbd97ae32e9a2930fa7', 'license'),
    ],
    domains: ['game', 'simulation', 'lesson-exercise'],
    briefing: [
      'Use the global kontra namespace. Initialise the canvas before creating sprites or the game loop.',
      'Kontra is deliberately small; implement domain-specific mechanics in project code.',
    ],
  }),
  melon: library({
    id: 'melon',
    label: 'melonJS 19.9.0',
    version: '19.9.0',
    group: 'engine',
    description: 'Modern 2D/2.5D engine with cameras, tilemaps, collision and audio.',
    entry: moduleEntry('lib/melonjs.mjs', 'import * as me from "../lib/melonjs.mjs";'),
    files: [
      file('../../lib/melonjs/19.9.0/melonjs.mjs', 'lib/melonjs.mjs', 1_619_754, '7e1abc4257cd54bd3a6f0fa092b2a81ad9d4762fea9717f94c483492129bd163'),
    ],
    domains: ['game', 'simulation', 'lesson-exercise'],
    briefing: [
      'This is an ES-module profile. Set forge-project.json runtime to "module-web".',
      'Put project logic in an .mjs module and import the me namespace from the project-relative library path.',
      'The bundle already contains its runtime dependencies; add no package-manager or network imports.',
    ],
  }),
  matter: library({
    id: 'matter',
    label: 'Matter.js 0.20.0',
    version: '0.20.0',
    group: 'physics',
    description: 'General-purpose 2D rigid-body physics.',
    entry: classic('lib/matter.min.js', 'Matter'),
    files: [
      file('../../lib/matter-js/0.20.0/matter.min.js', 'lib/matter.min.js', 83_476, '72d30be0f579eb02ce1e0b6f9d359a4f392e6837e5a26ba8be5dbee7f88e24ae'),
      file('../../lib/matter-js/0.20.0/LICENSE', 'lib/licenses/matter-js-0.20.0.txt', 1_092, 'ed182087be5b26734aa6d4789743de3a97417950e8c1e3ff2e3d19c6462720d3', 'license'),
    ],
    domains: ['game', 'simulation', 'graphics', 'lesson-exercise'],
    briefing: [
      'Use the global Matter namespace and a fixed simulation timestep.',
      'Keep rendering separate from Engine.update() so deterministic runs are possible.',
    ],
  }),
  planck: library({
    id: 'planck',
    label: 'Planck.js 1.5.0',
    version: '1.5.0',
    group: 'physics',
    description: 'Box2D-style deterministic 2D physics.',
    entry: classic('lib/planck.min.js', 'planck'),
    files: [
      file('../../lib/planck/1.5.0/planck.min.js', 'lib/planck.min.js', 296_776, '69c6675a04121ec4042921b7d3d298058617d3211c243d8ea4d940a58af99974'),
      file('../../lib/planck/1.5.0/LICENSE.txt', 'lib/licenses/planck-1.5.0.txt', 1_078, '49fd3df949edd5f294edafb22e8905263dd7560b514bee6df2f17538069aafca', 'license'),
    ],
    domains: ['game', 'simulation', 'graphics', 'lesson-exercise'],
    briefing: [
      'Use the global planck namespace with metre-scale world units and a fixed timestep.',
      'Do not use the optional testbed; render bodies through the selected renderer or Canvas.',
    ],
  }),
  rapier3d: library({
    id: 'rapier3d',
    label: 'Rapier 3D 0.14.0',
    version: '0.14.0',
    group: 'physics',
    description: 'WASM-backed 3D rigid-body physics, normally paired with Three.js.',
    entry: moduleEntry(
      'lib/rapier3d-compat.mjs',
      'import RAPIER from "../lib/rapier3d-compat.mjs"; await RAPIER.init();',
    ),
    files: [
      file('../../lib/@dimforge/rapier3d-compat/0.14.0/rapier3d-compat.bundle.mjs', 'lib/rapier3d-compat.mjs', 2_057_990, 'f4c91a3b3a4815fdfa11aa46f404ba9f2f878263404930ca7e9201592ef7e774'),
    ],
    domains: ['game', 'simulation', 'graphics', 'vr'],
    briefing: [
      'This is a self-contained ES-module bundle with embedded WASM. Set runtime to "module-web".',
      'Import the default RAPIER namespace, await RAPIER.init() once, then create the world.',
      'Use a fixed physics timestep and copy body transforms into the renderer after each step.',
    ],
  }),
  'three-xr': library({
    id: 'three-xr',
    label: 'Three.js 0.185.1 + WebXR add-ons',
    version: '0.185.1',
    group: 'engine',
    description: 'Modern ES-module Three.js with the WebXR buttons, controller, hand and plane add-ons. The Quest 3 profile.',
    entry: moduleEntry(
      'lib/three/build/three.module.js',
      'import * as THREE from "three";\nimport { VRButton } from "three/addons/webxr/VRButton.js";',
    ),
    files: [
      file('../../lib/three/0.185.1/build/three.module.js', 'lib/three/build/three.module.js', 650_153, 'bbf5ed13fe4373f5bd38b14ea8e62e9f157327da5638edc6d3863e08b167c9c7'),
      file('../../lib/three/0.185.1/build/three.core.js', 'lib/three/build/three.core.js', 1_443_056, '3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/VRButton.js', 'lib/three/examples/jsm/webxr/VRButton.js', 5_866, '35a7621bbbe776203dad04cddc79c8e1b166dc3b6757d8b907f97df86d8a9d48'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/ARButton.js', 'lib/three/examples/jsm/webxr/ARButton.js', 5_485, 'ee83c9c0ee1add5f4ebe14fb192fa31e603e98de6cce83a246fbf81407387401'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRButton.js', 'lib/three/examples/jsm/webxr/XRButton.js', 4_959, '13ceb022e450bfc8ff48e7af8e39faceacf08fea84a844fb82858a126c4e0249'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRControllerModelFactory.js', 'lib/three/examples/jsm/webxr/XRControllerModelFactory.js', 10_042, '786de4c890ed876c760ccee19b50e4a0e520ddc987372f00b5e45ad43d192984'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRHandModelFactory.js', 'lib/three/examples/jsm/webxr/XRHandModelFactory.js', 4_232, '8989adcfd2868525365f59a9c2cf442c2e3dd9e776a296005c66e7442f02175b'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRHandMeshModel.js', 'lib/three/examples/jsm/webxr/XRHandMeshModel.js', 4_112, '9bcb2e3f36fcc17c952589f9c40d2e6abe33af1a0bf797bd4b50d5dd311781ae'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRHandPrimitiveModel.js', 'lib/three/examples/jsm/webxr/XRHandPrimitiveModel.js', 3_519, '8bf3e6d6b838a9d71fb53088c86769b80abc71ebb03f24275d14c18bbc155ebb'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XRPlanes.js', 'lib/three/examples/jsm/webxr/XRPlanes.js', 2_480, '33df48ef7672b5d36af1ec50bbcf09b7529cd4fb2fa8bfcd013d767bb3174784'),
      file('../../lib/three/0.185.1/examples/jsm/webxr/XREstimatedLight.js', 'lib/three/examples/jsm/webxr/XREstimatedLight.js', 6_137, 'f2f5d9ef8cbffbf67b4d122e255d49c45e7d458518bc244fdee430351b34fc12'),
      file('../../lib/three/0.185.1/examples/jsm/loaders/GLTFLoader.js', 'lib/three/examples/jsm/loaders/GLTFLoader.js', 114_984, 'dfe84129d4658a277997cb509712f2c9bb71b5f72b8b1dba442d3c812a28706c'),
      file('../../lib/three/0.185.1/examples/jsm/libs/motion-controllers.module.js', 'lib/three/examples/jsm/libs/motion-controllers.module.js', 13_492, '4bf534b98dbb0f3e90b1332ac4d49c7d7747253768970abc7e4133b7700b75b1'),
      file('../../lib/three/0.185.1/examples/jsm/utils/BufferGeometryUtils.js', 'lib/three/examples/jsm/utils/BufferGeometryUtils.js', 37_646, '1820aa5e010e73bb7507f937270b57da0fef8aef088c0da72083c2ad4ccaae0f'),
      file('../../lib/three/0.185.1/examples/jsm/utils/SkeletonUtils.js', 'lib/three/examples/jsm/utils/SkeletonUtils.js', 11_560, '9e53f7de94e1a632b88113536c1c404e243dac973bad2e8e6d514ff49b569e65'),
    ],
    domains: ['vr'],
    briefing: [
      'ES modules only. Put this import map in index.html BEFORE any module script, and use the bare specifiers everywhere:',
      '<script type="importmap">{"imports":{"three":"./lib/three/build/three.module.js","three/addons/":"./lib/three/examples/jsm/"}}</script>',
      'Available add-ons: webxr/VRButton.js, webxr/ARButton.js, webxr/XRButton.js, webxr/XRControllerModelFactory.js, webxr/XRHandModelFactory.js, webxr/XRPlanes.js, webxr/XREstimatedLight.js, loaders/GLTFLoader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js. Nothing else from examples/jsm is present — OrbitControls and the post-processing stack are NOT installed, so write those few lines yourself.',
      'Set renderer.xr.enabled = true and drive the loop with renderer.setAnimationLoop, never requestAnimationFrame — an XR session presents frames through its own loop.',
      'XRControllerModelFactory loads controller models from a remote asset library by default; pass your own local path or draw simple controller proxies instead, because the headset reaches this project through a loopback tunnel with no internet.',
      'Set forge-project.json runtime to "webxr".',
    ],
    domainBriefing: {
      vr: [
        'Use renderer.xr.setReferenceSpaceType before the session starts, and match the reference space the manifest declares.',
        'Keep per-frame allocation out of the animation loop: a Quest 3 frame budget at 72 Hz is 13.9 ms for BOTH eyes.',
      ],
    },
  }),
  'hub-bridge': library({
    id: 'hub-bridge',
    label: 'Hub Bridge 1.0.0 (runtime services)',
    version: '1.0.0',
    group: 'services',
    description: 'Lets the generated project ask the hub for a model answer, a generated image, or a CLI-agent run at runtime.',
    entry: classic('lib/hub-bridge.js', 'HubBridge'),
    files: [
      file('../../lib/hub-bridge/1.0.0/hub-bridge.js', 'lib/hub-bridge.js', 8_844, '150ebd01e24490148baaf8f6a7121e428cc82231c553f130b7312680f2355b43'),
    ],
    domains: ['vr'],
    briefing: [
      'Load it with <script src="lib/hub-bridge.js"></script> and use the global HubBridge.',
      'await HubBridge.status() reports what is available: { ask, image: { reachable }, agent }. ALWAYS check before offering a feature, and keep the simulation fully usable when the answer is false — the hub may be unreachable, the model service unconfigured, or the image node asleep.',
      'HubBridge.ask({ prompt, system }) returns { text } — one question, one answer. HubBridge.askJson({ prompt }) returns parsed JSON for structured input (a generated scenario, policy weights, dialogue).',
      'HubBridge.image({ prompt }) returns { dataUrl } for use as a texture. It takes seconds to minutes: trigger it from an explicit user action, show a placeholder meanwhile, and cache what comes back.',
      'HubBridge.agent({ prompt }) runs a local CLI coding agent for heavier work and returns its final text.',
      'NEVER call any of these from an animation frame. The hub rate-limits to about 20 calls a minute, and a model call takes seconds — a per-frame call will stall the headset and exhaust the budget.',
      'Declare what you use in forge-project.json: "hub": { "services": ["ask"], "required": false }. A project that declares services is recorded as hub-bound and is not portable on its own.',
    ],
  }),
  tone: library({
    id: 'tone',
    label: 'Tone.js 14.8.49',
    version: '14.8.49',
    group: 'audio',
    description: 'Procedural music, synthesis and musical scheduling.',
    entry: classic('lib/Tone.js', 'Tone'),
    files: [
      file('../../lib/tone/14.8.49/Tone.js', 'lib/Tone.js', 349_169, '1261cdd3331d826237e7b0b954b5ed7d2381c8df4331d2018acea8c7a64a9a7b'),
    ],
    domains: [...ALL_FORGE_DOMAINS, 'vr'],
    briefing: [
      'Use the global Tone namespace and start audio only after a user gesture.',
      'Dispose synths and scheduled events when restarting the project state.',
    ],
  }),
  howler: library({
    id: 'howler',
    label: 'Howler.js 2.2.4',
    version: '2.2.4',
    group: 'audio',
    description: 'Straightforward sound effects, music playback and spatial audio.',
    entry: classic('lib/howler.min.js', 'Howl'),
    files: [
      file('../../lib/howler/2.2.4/howler.min.js', 'lib/howler.min.js', 36_173, '736c339444c88baad593e24afdf1d6e8f574019b4e37a110ecb453ff745ffd41'),
      file('../../lib/howler/2.2.4/LICENSE.md', 'lib/licenses/howler-2.2.4.txt', 1_088, '0ad5aef7beeb552832fe01db1c46933f948dfe5da35017bd0efa0006ffd2ced9', 'license'),
    ],
    domains: [...ALL_FORGE_DOMAINS, 'vr'],
    briefing: [
      'Use the global Howl and Howler APIs and start playback only after a user gesture.',
      'Audio sources must be project-local; do not use remote URLs.',
    ],
  }),
});

const NORMALIZED_VENDORED_PATHS = new Set(
  Object.values(PROJECT_LIBRARIES).flatMap(item => item.files.map(entry => normalizePath(entry.path))),
);

export function normalizePath(path) {
  const output = [];
  for (const part of String(path || '').replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }
  return output.join('/');
}

/** Known ids, in declaration order, with unknown/duplicate entries dropped. */
export function normalizeLibraryIds(value) {
  const ids = Array.isArray(value) ? value : [];
  const seen = new Set();
  const output = [];
  for (const raw of ids) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id || seen.has(id) || !PROJECT_LIBRARIES[id]) continue;
    seen.add(id);
    output.push(id);
  }
  return output;
}

export function unknownLibraryIds(value) {
  const ids = Array.isArray(value) ? value : [];
  return [...new Set(ids
    .map(id => String(id || '').trim().toLowerCase())
    .filter(id => id && !PROJECT_LIBRARIES[id]))];
}

export function librariesFor(value) {
  return normalizeLibraryIds(value).map(id => PROJECT_LIBRARIES[id]);
}

export function projectLibrariesForDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  return Object.values(PROJECT_LIBRARIES).filter(item => !normalized || item.domains.includes(normalized));
}

export function librarySelectionErrors(value, { domain = '', targetStack = 'web' } = {}) {
  const errors = unknownLibraryIds(value).map(id => `Unknown project library: ${id}.`);
  const libraries = librariesFor(value);
  if (String(targetStack || 'web').toLowerCase() !== 'web' && libraries.length) {
    errors.push('Browser project libraries can only be used with the web target stack.');
  }
  for (const group of PROJECT_LIBRARY_GROUPS) {
    const selected = libraries.filter(item => item.group === group.id);
    if (selected.length > 1) {
      errors.push(`Choose at most one ${group.label.toLowerCase()}: ${selected.map(item => item.label).join(', ')}.`);
    }
  }
  if (domain) {
    for (const item of libraries) {
      if (!item.domains.includes(String(domain).toLowerCase())) {
        errors.push(`${item.label} is not enabled for the ${domain} forge.`);
      }
    }
  }
  return errors;
}

/** Select a radio-like library group while preserving choices in other groups. */
export function selectProjectLibrary(value, id) {
  const current = normalizeLibraryIds(value);
  if (!id) return current;
  const item = PROJECT_LIBRARIES[id];
  if (!item) return current;
  if (current.includes(id)) return current.filter(valueId => valueId !== id);
  return [
    ...current.filter(valueId => PROJECT_LIBRARIES[valueId]?.group !== item.group),
    id,
  ];
}

export function clearProjectLibraryGroup(value, group) {
  return normalizeLibraryIds(value).filter(id => PROJECT_LIBRARIES[id]?.group !== group);
}

export function vendoredLibraryPaths(value = Object.keys(PROJECT_LIBRARIES)) {
  return librariesFor(value).flatMap(item => item.files.map(entry => entry.path));
}

/**
 * Preserve the user's authored-output allowance while making room for pinned
 * files the Forge itself adds. This prevents a large selected engine from
 * consuming the model's code budget before generation starts.
 */
export function withProjectLibraryBudget(budgets = {}, value = []) {
  const files = librariesFor(value).flatMap(item => item.files);
  if (!files.length) return { ...budgets };
  const provisionedBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const largestFile = Math.max(...files.map(entry => entry.bytes));
  const reserved = new Map(
    (Array.isArray(budgets.reservedFiles) ? budgets.reservedFiles : [])
      .map(entry => [normalizePath(entry?.path), Number(entry?.bytes) || 0]),
  );
  for (const entry of files) reserved.set(normalizePath(entry.path), entry.bytes);
  return {
    ...budgets,
    maxFiles: Number(budgets.maxFiles || 0) + files.length,
    maxTotalBytes: Number(budgets.maxTotalBytes || 0) + provisionedBytes,
    maxFileBytes: Math.max(Number(budgets.maxFileBytes || 0), largestFile),
    provisionedLibraryBytes: provisionedBytes,
    reservedFiles: [...reserved].map(([path, bytes]) => ({ path, bytes })),
  };
}

export function isVendoredLibraryPath(path) {
  return NORMALIZED_VENDORED_PATHS.has(normalizePath(path));
}

export function libraryBriefing(value, { domain = '' } = {}) {
  const libraries = librariesFor(value);
  if (!libraries.length) return '';
  const sections = libraries.map(item => {
    const entryInstruction = item.entry.type === 'classic'
      ? `Load it before project scripts: ${item.entry.include}. It defines ${item.entry.globalName}.`
      : `Use an ES-module entry and import it with: ${item.entry.importExample}`;
    const domainLines = item.domainBriefing[domain] || [];
    return [
      `${item.label} — provisioned ${item.files.length === 1 ? 'file' : 'files'}:`,
      ...item.files.map(entry => `- ${entry.path} (${entry.kind}, SHA-256 ${entry.sha256.slice(0, 12)}…)`),
      `- ${entryInstruction}`,
      `- These files are forge-owned. Never fetch, inline, minify, read, edit, re-author or overwrite them.`,
      ...item.briefing.map(line => `- ${line}`),
      ...domainLines.map(line => `- ${line}`),
    ].join('\n');
  });
  return `PROVISIONED PROJECT LIBRARIES
${sections.join('\n\n')}

The files above are local project files, not Hub-relative paths or external URLs. Keep the project offline. List every provisioned path in forge-project.json assets.`;
}

async function getProjectFile(projectHandle, path) {
  const parts = normalizePath(path).split('/').filter(Boolean);
  let directory = projectHandle;
  try {
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    return await (await directory.getFileHandle(parts.at(-1))).getFile();
  } catch {
    return null;
  }
}

async function writeProjectFile(projectHandle, path, blob) {
  const parts = normalizePath(path).split('/').filter(Boolean);
  let directory = projectHandle;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  const handle = await directory.getFileHandle(parts.at(-1), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Real SHA-256 in plain JS. `crypto.subtle` exists only in secure contexts, so
// a hub opened over plain HTTP on a LAN/Tailscale address has none — and a
// weaker stand-in hash is not an option here, because the digest is compared
// against the pinned value in the library manifest.
export function sha256HexFromBytes(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map(word => word.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(blob, cryptoImpl = globalThis.crypto) {
  const buffer = await blob.arrayBuffer();
  if (!cryptoImpl?.subtle?.digest) return sha256HexFromBytes(new Uint8Array(buffer));
  const digest = await cryptoImpl.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyBlob(blob, expected, digestImpl) {
  if (blob.size !== expected.bytes) {
    return {
      ok: false,
      reason: `expected ${expected.bytes} bytes, found ${blob.size}`,
      bytes: blob.size,
      sha256: null,
    };
  }
  const sha256 = await digestImpl(blob);
  return sha256 === expected.sha256
    ? { ok: true, bytes: blob.size, sha256 }
    : {
      ok: false,
      reason: `SHA-256 mismatch (expected ${expected.sha256}, found ${sha256})`,
      bytes: blob.size,
      sha256,
    };
}

export class ProjectLibraryProvisionError extends Error {
  constructor(message, records = []) {
    super(message);
    this.name = 'ProjectLibraryProvisionError';
    this.records = records;
  }
}

/**
 * Copy selected pinned library packages into a generated project.
 *
 * Existing matching files are retained. Existing mismatched files are never
 * overwritten: the reserved-path conflict fails closed so a fork cannot
 * silently change the runtime promised by its brief.
 */
export async function provisionProjectLibraries(projectHandle, value, {
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseUrl = import.meta.url,
  digestImpl = sha256Hex,
  domain = '',
  targetStack = 'web',
  strict = true,
} = {}) {
  const selectionErrors = librarySelectionErrors(value, { domain, targetStack });
  if (selectionErrors.length) {
    const records = selectionErrors.map(error => ({
      id: 'selection',
      label: 'Library selection',
      version: null,
      status: 'failed',
      bytes: 0,
      files: [],
      error,
    }));
    if (strict) throw new ProjectLibraryProvisionError(selectionErrors.join(' '), records);
    return records;
  }

  const records = [];
  for (const item of librariesFor(value)) {
    const record = {
      id: item.id,
      label: item.label,
      version: item.version,
      status: 'present',
      bytes: 0,
      files: [],
    };
    try {
      let provisioned = false;
      for (const expected of item.files) {
        const existing = await getProjectFile(projectHandle, expected.path);
        if (existing) {
          const integrity = await verifyBlob(existing, expected, digestImpl);
          record.files.push({
            path: expected.path,
            kind: expected.kind,
            status: integrity.ok ? 'present' : 'conflict',
            bytes: integrity.bytes,
            sha256: integrity.sha256,
            expectedSha256: expected.sha256,
            ...(integrity.ok ? {} : { error: integrity.reason }),
          });
          if (!integrity.ok) {
            throw new Error(`${expected.path} conflicts with ${item.label}: ${integrity.reason}.`);
          }
          record.bytes += integrity.bytes;
          continue;
        }

        if (!fetchImpl) throw new Error('No fetch implementation is available.');
        const response = await fetchImpl(new URL(expected.sourceUrl, baseUrl));
        if (!response.ok) {
          throw new Error(`${expected.path}: ${response.status} ${response.statusText || ''}`.trim());
        }
        const blob = await response.blob();
        const integrity = await verifyBlob(blob, expected, digestImpl);
        if (!integrity.ok) {
          throw new Error(`${expected.path} source failed integrity verification: ${integrity.reason}.`);
        }
        await writeProjectFile(projectHandle, expected.path, blob);
        provisioned = true;
        record.bytes += blob.size;
        record.files.push({
          path: expected.path,
          kind: expected.kind,
          status: 'provisioned',
          bytes: blob.size,
          sha256: integrity.sha256,
          expectedSha256: expected.sha256,
        });
      }
      record.status = provisioned ? 'provisioned' : 'present';
    } catch (error) {
      record.status = 'failed';
      record.error = error?.message || String(error);
    }
    records.push(record);
  }

  const failed = records.filter(record => record.status === 'failed');
  if (strict && failed.length) {
    throw new ProjectLibraryProvisionError(
      `Could not provision ${failed.map(record => record.label).join(', ')}: ${failed[0].error}`,
      records,
    );
  }
  return records;
}

/** Verify that selected forge-owned files still match the pinned registry. */
export async function verifyProjectLibraries(projectHandle, value, {
  digestImpl = sha256Hex,
} = {}) {
  const records = [];
  for (const item of librariesFor(value)) {
    const record = {
      id: item.id,
      label: item.label,
      version: item.version,
      status: 'verified',
      bytes: 0,
      files: [],
    };
    for (const expected of item.files) {
      const existing = await getProjectFile(projectHandle, expected.path);
      if (!existing) {
        record.status = 'failed';
        record.files.push({
          path: expected.path,
          kind: expected.kind,
          status: 'missing',
          bytes: 0,
          sha256: null,
          expectedSha256: expected.sha256,
          error: 'File is missing.',
        });
        continue;
      }
      const integrity = await verifyBlob(existing, expected, digestImpl);
      record.bytes += integrity.bytes;
      record.files.push({
        path: expected.path,
        kind: expected.kind,
        status: integrity.ok ? 'verified' : 'modified',
        bytes: integrity.bytes,
        sha256: integrity.sha256,
        expectedSha256: expected.sha256,
        ...(integrity.ok ? {} : { error: integrity.reason }),
      });
      if (!integrity.ok) record.status = 'failed';
    }
    records.push(record);
  }
  return records;
}

export async function projectLibraryValidationIssues(projectHandle, value, options = {}) {
  const records = await verifyProjectLibraries(projectHandle, value, options);
  const issues = [];
  for (const message of librarySelectionErrors(value, options)) {
    issues.push({
      severity: 'error',
      code: 'invalid_project_library_selection',
      message,
    });
  }
  for (const record of records) {
    for (const entry of record.files.filter(item => !['verified', 'present'].includes(item.status))) {
      issues.push({
        severity: 'error',
        code: entry.status === 'missing'
          ? 'provisioned_library_missing'
          : 'provisioned_library_modified',
        message: `${record.label}: ${entry.path} ${entry.error || entry.status}.`,
        path: entry.path,
      });
    }
  }

  const selectedPaths = new Set(vendoredLibraryPaths(value));
  for (const item of Object.values(PROJECT_LIBRARIES)) {
    for (const entry of item.files) {
      if (selectedPaths.has(entry.path)) continue;
      const existing = await getProjectFile(projectHandle, entry.path);
      if (!existing) continue;
      issues.push({
        severity: 'error',
        code: 'unselected_project_library_file',
        message: `${entry.path} is a Forge-reserved runtime path, but ${item.label} is not selected by this brief.`,
        path: entry.path,
      });
    }
  }
  return { records, issues };
}

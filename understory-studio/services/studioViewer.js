// The viewport: builds all five levels of a design, renders them, and — the
// part the loop depends on — captures the three-view and movement-test images
// that go back to the model.
//
// An imperative controller rather than a component, because it owns a WebGL
// context and a render loop whose lifetime must not be tied to a render pass.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAllLevels, validateRecipe } from './recipe.js';
import { createDesignMaterials, disposeDesignMaterials } from './proceduralTextures.js';
import { DETAIL_LEVELS, disposeModel } from './detailLevels.js';
import { assetFilename, exportLODArchive, exportTexturedGLB } from './assetExport.js';
import { centerRiggingModels, riggingTarget } from './rigging.js';
import { restoreBindPose } from './rigPose.js';
import { buildCleanedModel, runCleanup } from './cleanupRunner.js';
import { cleanupSignature, normalizeCleanup } from './meshCleanup.js';

const CAPTURE_SIZE = 768;

/** Three studio setups. The model reviews what it is shown, so the lighting is
 *  deliberately neutral and even — a dramatic key would have it correcting
 *  shadows rather than geometry. */
export const LIGHTING_PRESETS = Object.freeze([
  { id: 'studio', label: 'Studio', background: '#e9e6df', hemiSky: '#ffffff', hemiGround: '#747561', hemi: 2,
    lights: [['#fff0d8', 3, [4, 7, 6]], ['#cedef2', 1.5, [-5, 3, 2]], ['#ffffff', 2, [1, 5, -5]]],
    exposure: 1, environment: 0.35, grid: ['#b8b6aa', '#d5d1c6'] },
  { id: 'forest', label: 'Forest', background: '#d9dfd0', hemiSky: '#c7d4b9', hemiGround: '#3c4533', hemi: 1.6,
    lights: [['#fff1bd', 3.1, [4, 7, 6]], ['#9fbaac', 1.2, [-5, 3, 2]], ['#d7eaa6', 2.4, [1, 5, -5]]],
    exposure: 1.03, environment: 0.22, grid: ['#a8b39a', '#c3ccb6'] },
  { id: 'moon', label: 'Moon', background: '#cad1dd', hemiSky: '#a5b8d4', hemiGround: '#333b4a', hemi: 1.1,
    lights: [['#c0d8ff', 1.8, [4, 7, 6]], ['#adbcdd', 0.9, [-5, 3, 2]], ['#d5e5ff', 3.2, [1, 5, -5]]],
    exposure: 1, environment: 0.16, grid: ['#9aa4b6', '#b9c1cf'] },
]);

export function createStudioViewer(canvas, { onStats = () => {}, onAnimation = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;

  const hemisphere = new THREE.HemisphereLight('#ffffff', '#747561', 2);
  scene.add(hemisphere);
  const directional = [0, 1, 2].map(() => {
    const light = new THREE.DirectionalLight();
    scene.add(light);
    return light;
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  const grid = new THREE.GridHelper(20, 20);
  scene.add(grid);
  const clay = new THREE.MeshStandardMaterial({ color: '#c5baa5', roughness: 0.8 });
  const wire = new THREE.MeshBasicMaterial({ color: '#546851', wireframe: true });

  let models = new Map();
  let animatedModels = new Map();
  let materials = {};
  let mixers = new Map();
  let active = null;
  let recipe = null;
  let detail = 'master';
  let surface = 'textured';
  let selected = -1;
  let rigging = 'none';
  let animationName = '';
  let playing = false;
  let speed = 1;
  let disposed = false;

  // The optional triangle clean-up. Cleaned levels are separate objects built
  // BESIDE the originals; the originals are never touched, so switching back
  // is instant and exact. `generation` invalidates a clean-up that finishes
  // after a different design has been loaded.
  let cleanModels = new Map();
  let cleanAnimated = new Map();
  let cleanSettings = null;
  let cleanKey = '';
  let variant = 'original';
  let generation = 0;
  const resultCache = new Map();

  const clock = new THREE.Clock();
  const draw = () => { if (!disposed) renderer.render(scene, camera); };

  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1);
    if (playing && mixers.has(active)) { mixers.get(active).update(delta * speed); draw(); }
  });

  function applyLighting(id) {
    const preset = LIGHTING_PRESETS.find(entry => entry.id === id) || LIGHTING_PRESETS[0];
    renderer.setClearColor(preset.background);
    renderer.toneMappingExposure = preset.exposure;
    scene.environmentIntensity = preset.environment;
    hemisphere.color.set(preset.hemiSky);
    hemisphere.groundColor.set(preset.hemiGround);
    hemisphere.intensity = preset.hemi;
    preset.lights.forEach(([color, intensity, position], index) => {
      directional[index].color.set(color);
      directional[index].intensity = intensity;
      directional[index].position.set(...position);
    });
    grid.material.color.set(preset.grid[1]);
    draw();
  }
  applyLighting('studio');

  const announceAnimation = () => onAnimation({
    rigged: animatedModels.size > 0,
    clips: active?.animations?.map(clip => clip.name) || [],
    selected: animationName,
    playing,
    speed,
  });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  controls.addEventListener('change', draw);

  function disposeModels(collection) {
    const skeletons = new Set();
    collection.forEach(model => {
      model.traverse(object => { if (object.skeleton) skeletons.add(object.skeleton); });
      disposeModel(model);
    });
    skeletons.forEach(skeleton => skeleton.dispose());
  }

  const bounds = () => {
    const target = selected >= 0
      ? active.children.find(child => child.userData.objectIndex === selected) || active
      : active;
    const box = new THREE.Box3().setFromObject(target, true);
    return box.isEmpty() ? box.setFromObject(active, true) : box;
  };

  function frame(direction = new THREE.Vector3(0.7, 0.4, 1)) {
    if (!active) return;
    const box = bounds();
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2;
    // Widen for a portrait viewport, or a tall character overflows the frame.
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
      * Math.max(1, 1 / camera.aspect) * 1.12;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction.clone().normalize(), distance);
    camera.near = Math.max(0.001, distance / 1000);
    camera.far = distance * 100 + 100;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.1;
    controls.maxDistance = distance * 8;
    controls.update();
    draw();
  }

  function applySurface() {
    active?.traverse(object => {
      if (!object.isMesh) return;
      object.material = surface === 'clay' ? clay
        : surface === 'wireframe' ? wire
        : materials[object.userData.originalMaterial];
    });
    draw();
  }

  const showingCleaned = id => variant === 'cleaned' && cleanModels.has(id);

  function selectLevel(id) {
    if (!models.has(id)) return;
    active?.removeFromParent();
    active = showingCleaned(id)
      ? cleanAnimated.get(id) || cleanModels.get(id)
      : animatedModels.get(id) || models.get(id);
    detail = id;
    scene.add(active);
    applySurface();
    const data = active.userData;
    onStats({
      ...data,
      detail,
      variant: showingCleaned(id) ? 'cleaned' : 'original',
      originalTriangles: models.get(id).userData.triangles,
      reduction: 100 * (1 - data.triangles / models.get('master').userData.triangles),
    });
    announceAnimation();
    draw();
  }

  function setAnimation(name) {
    animationName = name;
    for (const [root, mixer] of mixers) {
      mixer.stopAllAction();
      restoreBindPose(root);
      const clip = root.animations.find(entry => entry.name === name);
      if (clip) mixer.clipAction(clip).reset().play();
      mixer.update(0);
    }
    playing = Boolean(name && mixers.size);
    announceAnimation();
    draw();
  }

  /** Drop the cleaned levels (never the originals). */
  function releaseCleaned() {
    const cleanedRoots = new Set([...cleanModels.values(), ...cleanAnimated.values()]);
    if (cleanedRoots.has(active)) { active.removeFromParent(); active = null; }
    for (const root of cleanAnimated.values()) {
      const mixer = mixers.get(root);
      if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); mixers.delete(root); }
    }
    disposeModels(cleanModels);
    disposeModels(cleanAnimated);
    cleanModels = new Map();
    cleanAnimated = new Map();
    cleanSettings = null;
    cleanKey = '';
  }

  function cleanupSummary() {
    if (!cleanModels.size) return null;
    return {
      settings: cleanSettings,
      levels: DETAIL_LEVELS.filter(level => cleanModels.has(level.id)).map(level => ({
        id: level.id,
        label: level.label,
        original: models.get(level.id).userData.triangles,
        cleaned: cleanModels.get(level.id).userData.triangles,
        stats: cleanModels.get(level.id).userData.cleanupStats,
      })),
    };
  }

  /**
   * Apply (or remove) the triangle clean-up for the loaded design. Results are
   * cached per settings, so flicking a step back to a previous value is free.
   * With `enabled: false` the cleaned levels are released and the originals
   * are shown — exactly the models the generator produced.
   */
  async function applyCleanup(settings, { signal, onProgress } = {}) {
    const normalized = normalizeCleanup(settings);
    if (!normalized.enabled || !models.size) {
      releaseCleaned();
      if (models.size) { selectLevel(detail); if (animatedModels.size) setAnimation(animationName); }
      return null;
    }
    const token = generation;
    const key = cleanupSignature(normalized, { rigged: animatedModels.size > 0 });
    if (key === cleanKey && cleanModels.size) { selectLevel(detail); return cleanupSummary(); }

    let results = resultCache.get(key);
    if (!results) {
      results = await runCleanup({ models, animatedModels, settings: normalized, signal, onProgress });
      if (token !== generation) throw new DOMException('A different design was loaded during the clean-up.', 'AbortError');
      resultCache.set(key, results);
      if (resultCache.size > 4) resultCache.delete(resultCache.keys().next().value);
    }
    signal?.throwIfAborted();

    const nextClean = new Map();
    const nextAnimated = new Map();
    try {
      for (const [id, result] of results) {
        nextClean.set(id, buildCleanedModel(models.get(id), result, { settings: normalized }));
        if (animatedModels.has(id)) {
          nextAnimated.set(id, buildCleanedModel(animatedModels.get(id), result, { skinned: true, settings: normalized }));
        }
      }
    } catch (error) {
      disposeModels(nextClean);
      disposeModels(nextAnimated);
      throw error;
    }
    releaseCleaned();
    cleanModels = nextClean;
    cleanAnimated = nextAnimated;
    cleanSettings = normalized;
    cleanKey = key;
    for (const root of cleanAnimated.values()) mixers.set(root, new THREE.AnimationMixer(root));
    selectLevel(detail);
    if (animatedModels.size) setAnimation(animationName);
    return cleanupSummary();
  }

  async function load(design, options = {}) {
    validateRecipe(design);
    const nextRigging = riggingTarget(options.rigging ?? 'none', options.kind ?? 'character');
    if (nextRigging !== 'none' && design.objects.length !== 1) {
      throw new Error('Humanoid preparation requires exactly one named object containing the whole character. Remove scenery and combine the character parts into that object.');
    }

    let nextMaterials = {};
    let nextModels = new Map();
    const nextAnimated = new Map();
    try {
      nextMaterials = createDesignMaterials(design);
      nextModels = buildAllLevels(design, nextMaterials);
      if (nextRigging !== 'none') centerRiggingModels(nextModels, nextRigging);

      if (nextRigging === 'animated') {
        const { loadAnimationLibrary, rigModel } = await import('./animation.js');
        const library = await loadAnimationLibrary(options.signal);
        for (const [id, model] of nextModels) {
          options.signal?.throwIfAborted();
          // Each level is rigged independently against its own geometry; a
          // shared skeleton cannot carry five different vertex counts.
          const copy = model.clone(true);
          copy.traverse(object => { if (object.isMesh) object.geometry = object.geometry.clone(); });
          nextAnimated.set(id, copy);
          await rigModel(copy, design.rig, library, options.signal);
        }
      }
      options.signal?.throwIfAborted();
    } catch (error) {
      disposeModels(nextModels);
      disposeModels(nextAnimated);
      disposeDesignMaterials(nextMaterials);
      throw error;
    }

    // Only past this point is the previous design released — a failed build
    // must leave the last good asset on screen.
    releaseCleaned();
    resultCache.clear();
    generation++;
    mixers.forEach(mixer => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); });
    disposeModels(models);
    disposeModels(animatedModels);
    disposeDesignMaterials(materials);

    models = nextModels;
    animatedModels = nextAnimated;
    materials = nextMaterials;
    recipe = design;
    rigging = nextRigging;
    selected = -1;
    mixers = new Map([...animatedModels.values()].map(model => [model, new THREE.AnimationMixer(model)]));

    selectLevel(models.has(detail) ? detail : 'master');
    frame();
    setAnimation(animatedModels.size ? 'Idle_A' : '');

    const fullBounds = new THREE.Box3().setFromObject(active, true);
    const size = fullBounds.getSize(new THREE.Vector3()).length();
    grid.scale.setScalar(Math.max(0.1, size / 12));
    grid.position.y = fullBounds.min.y - 0.01;
    draw();
    return { objects: recipe.objects.map(object => object.name), rigged: animatedModels.size > 0 };
  }

  /** Release the loaded design and leave an empty studio behind.
   *
   *  Same release sequence as the second half of `load`, so a cleared viewer is
   *  indistinguishable from one that has never been loaded: no leaked GPU
   *  memory, the grid back at its unscaled size and origin, and the animation
   *  panel told there is nothing rigged any more. */
  function clear() {
    if (!active && !models.size) return;
    releaseCleaned();
    resultCache.clear();
    generation++;
    mixers.forEach(mixer => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); });
    active?.removeFromParent();
    disposeModels(models);
    disposeModels(animatedModels);
    disposeDesignMaterials(materials);

    models = new Map();
    animatedModels = new Map();
    materials = {};
    mixers = new Map();
    active = null;
    recipe = null;
    detail = 'master';
    selected = -1;
    rigging = 'none';
    animationName = '';
    playing = false;

    grid.scale.setScalar(1);
    grid.position.y = 0;
    announceAnimation();
    draw();
  }

  /**
   * Render the images the model reviews.
   *
   * Deliberately fixed: Master level (LOD 1 for movement), textured surface,
   * whole scene, no grid, square 1:1, rest pose. The model must review the
   * asset, not whatever the user left the viewport set to.
   */
  async function captureViews(movement = false) {
    if (!active) throw new Error('No model to inspect.');
    const previous = {
      position: camera.position.clone(), target: controls.target.clone(),
      near: camera.near, far: camera.far,
      selected, detail, surface, grid: grid.visible, animationName, playing, variant,
    };
    try {
      selected = -1;
      // The model reviews what it GENERATED. Clean-up is a person's later
      // choice and must never change what the loop is shown.
      variant = 'original';
      surface = 'textured';
      selectLevel(movement ? 'lod1' : 'master');
      grid.visible = false;
      setAnimation('');
      playing = false;
      renderer.setPixelRatio(1);
      renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();

      const images = [];
      const directions = [
        new THREE.Vector3(0, 0.08, 1),
        new THREE.Vector3(1, 0.08, 0),
        new THREE.Vector3(0, 0.08, -1),
      ];
      for (const [index, direction] of directions.entries()) {
        if (movement) {
          // Walk mid-stride, a settled crouch, and a manually bent elbow —
          // three poses that expose different deformation failures.
          setAnimation(['Walk', 'Crouch_Idle', ''][index]);
          playing = false;
          if (index < 2) mixers.get(active).setTime([0.35, 0.1][index]);
          else {
            active.getObjectByName('lowerarm_l')?.rotateX(Math.PI / 2);
            active.getObjectByName('lowerarm_r')?.rotateX(-Math.PI / 3);
          }
        }
        frame(direction);
        images.push(canvas.toDataURL('image/png'));
      }
      return images;
    } finally {
      selected = previous.selected;
      surface = previous.surface;
      variant = previous.variant;
      grid.visible = previous.grid;
      selectLevel(previous.detail);
      setAnimation(previous.animationName);
      playing = previous.playing;
      announceAnimation();
      camera.position.copy(previous.position);
      controls.target.copy(previous.target);
      camera.near = previous.near;
      camera.far = previous.far;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      resize();
      controls.update();
      draw();
    }
  }

  return {
    load,
    clear,
    captureViews,
    selectLevel,
    frame,
    setAnimation,
    setLighting: applyLighting,
    hasModel: () => Boolean(active),
    isRigged: () => animatedModels.size > 0,
    getDetail: () => detail,
    getRigging: () => rigging,
    getName: () => recipe?.name || '',
    setPlaying(value) { playing = Boolean(value && animationName && mixers.size); announceAnimation(); },
    setSpeed(value) { speed = Math.max(0.1, Math.min(2, Number(value) || 1)); announceAnimation(); },
    setSurface(value) { surface = value; applySurface(); },
    selectObject(index) { selected = Number(index); frame(); },
    screenshot() { draw(); return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); },

    applyCleanup,
    setVariant(value) {
      variant = value === 'cleaned' ? 'cleaned' : 'original';
      if (!models.size) return;
      selectLevel(detail);
      if (animatedModels.size) setAnimation(animationName);
    },
    getVariant: () => variant,
    hasCleaned: () => cleanModels.size > 0,
    getCleanupSummary: cleanupSummary,

    /**
     * Export one level, or every level as a package. `variants` picks the
     * original levels, the cleaned ones, or both side by side; cleaned files
     * carry a `-clean` suffix and never replace an original's name.
     * @returns {Promise<{blob: Blob, filename: string}[]>}
     */
    async exportAsset(all, onProgress, signal, content = 'animated', variants = ['original']) {
      if (!active) throw new Error('Generate or load a design first.');
      if (!['animated', 'rigged', 'static'].includes(content)) throw new Error('Unknown export content.');
      const chosen = variants.filter(v => v === 'original' || (v === 'cleaned' && cleanModels.size));
      if (!chosen.length) throw new Error('Nothing to export: the clean-up has not produced any levels yet.');
      const setFor = v => {
        const [staticSet, animatedSet] = v === 'cleaned' ? [cleanModels, cleanAnimated] : [models, animatedModels];
        return content === 'static' || !animatedSet.size ? staticSet : animatedSet;
      };
      const exportName = rigging === 'mixamo' ? `${recipe.name}-mixamo`
        : animatedModels.size ? `${recipe.name}-${content}`
        : recipe.name;
      const getAnimations = root => (content === 'animated'
        ? (root.animations || []).filter(clip => clip.name === animationName)
        : []);
      if (animatedModels.size && content === 'animated' && !getAnimations(active).length) {
        throw new Error('Choose an animation, or export a rigged/static T-pose.');
      }
      if (all) {
        const levels = chosen.flatMap(v => DETAIL_LEVELS.map(level => (v === 'original'
          ? { ...level, variant: 'original', sourceLevel: level.id }
          : {
            ...level,
            id: `${level.id}-clean`,
            label: `${level.label} · cleaned`,
            variant: 'cleaned',
            sourceLevel: level.id,
            role: level.id === 'master' ? 'cleaned-sculpt' : 'cleaned-runtime-lod',
            cleanupStats: cleanModels.get(level.id)?.userData.cleanupStats,
          })));
        const { blob } = await exportLODArchive({
          name: exportName, levels,
          getModel: id => {
            const level = levels.find(entry => entry.id === id);
            return setFor(level.variant).get(level.sourceLevel);
          },
          materials, onProgress, signal, getAnimations,
          manifestExtra: chosen.includes('cleaned') ? {
            cleanup: {
              settings: cleanSettings,
              note: 'Levels with variant "cleaned" were derived from the originals by the optional triangle clean-up (weld, hidden-triangle removal, simplification). The originals are included unchanged.',
            },
          } : {},
        });
        return [{ blob, filename: assetFilename(exportName, 'all-lods').replace('.glb', '.zip') }];
      }
      const level = DETAIL_LEVELS.find(entry => entry.id === detail);
      const files = [];
      for (const v of chosen) {
        const root = setFor(v).get(detail);
        const buffer = await exportTexturedGLB(root, materials, {
          maxTextureSize: level.maxTextureSize, signal, animations: getAnimations(root),
        });
        files.push({
          blob: new Blob([buffer], { type: 'model/gltf-binary' }),
          filename: assetFilename(exportName, v === 'cleaned' ? `${detail}-clean` : detail),
        });
      }
      return files;
    },

    dispose() {
      disposed = true;
      releaseCleaned();
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      mixers.forEach(mixer => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); });
      disposeModels(models);
      disposeModels(animatedModels);
      disposeDesignMaterials(materials);
      clay.dispose();
      wire.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      environment.texture.dispose();
      renderer.dispose();
    },
  };
}

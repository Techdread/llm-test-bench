// Fitting the bundled humanoid skeleton to a generated character, solving skin
// weights, and adapting the 87 base clips to the fitted proportions.
//
// Every step here is trusted code. The model's only contribution is the 18
// joint positions that humanoid.js has already validated.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateHumanoid } from './humanoid.js';

const VENDOR = '../../shared/lib/mesh2motion/1.0.0/assets/';
const rigURL = new URL(`${VENDOR}rig-human.glb`, import.meta.url);
const clipsURL = new URL(`${VENDOR}human-base-animations.glb`, import.meta.url);

const RIG_TIMEOUT_MS = 120_000;

let library = null;

/** Load the skeleton and clip library once, lazily. 5 MB, so never on startup. */
export async function loadAnimationLibrary(signal) {
  if (!library) {
    library = Promise.all([rigURL, clipsURL].map(async url => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('The bundled Mesh2Motion library could not be loaded.');
      return new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
    })).then(([rig, animations]) => ({ rig: rig.scene, clips: animations.animations }));
    // A failed load must not poison every later attempt.
    library.catch(() => { library = null; });
  }
  const result = await library;
  signal?.throwIfAborted();
  return result;
}

/**
 * Fit joint translations while preserving the template's rotation axes.
 *
 * Only positions move. Keeping the upstream rotations is what lets the library's
 * rotation tracks drive the same named bones at wildly different proportions —
 * re-deriving orientations from the joint positions would need a roll
 * convention the model never supplied.
 */
export function fitHumanoid(template, spec) {
  validateHumanoid(spec);
  const armature = template.clone(true);
  const joints = spec.joints;
  const source = name => armature.getObjectByName(name);
  armature.updateMatrixWorld(true);

  const sourcePelvis = source('pelvis').position.clone();
  const sourceHeight = source('head').getWorldPosition(new THREE.Vector3()).y
    - source('foot_l').getWorldPosition(new THREE.Vector3()).y;
  const scale = (joints.head[1] - joints.leftAnkle[1]) / sourceHeight;

  const target = { pelvis: joints.pelvis, spine_03: joints.chest, neck_01: joints.neck, head: joints.head };
  // The template has three spine bones; the contract asks for two torso points,
  // so the intermediate spines are interpolated rather than demanded.
  for (const [name, fraction] of [['spine_01', 0.3], ['spine_02', 0.65]]) {
    target[name] = joints.pelvis.map((n, i) => n + (joints.chest[i] - n) * fraction);
  }
  for (const [side, suffix] of [['left', 'l'], ['right', 'r']]) {
    for (const [bone, joint] of [['upperarm', 'Shoulder'], ['lowerarm', 'Elbow'], ['hand', 'Wrist'], ['thigh', 'Hip'], ['calf', 'Knee'], ['foot', 'Ankle'], ['ball', 'Toe']]) {
      target[`${bone}_${suffix}`] = joints[side + joint];
    }
    target[`clavicle_${suffix}`] = joints.chest.map((n, i) => n + (joints[side + 'Shoulder'][i] - n) * 0.2);

    // Fingers are dropped and replaced by one leaf bone: this version animates
    // whole hands, and 15 unfitted finger bones per hand would only give the
    // weight solver phantom attractors inside the palm.
    const hand = source(`hand_${suffix}`);
    hand.clear();
    const tip = new THREE.Bone();
    tip.name = `hand_leaf_${suffix}`;
    tip.position.y = 0.14;
    hand.add(tip);
  }

  armature.traverse(bone => { if (bone.isBone) bone.position.multiplyScalar(scale); });
  armature.updateMatrixWorld(true);
  armature.traverse(bone => {
    if (target[bone.name]) {
      bone.position.copy(bone.parent.worldToLocal(new THREE.Vector3(...target[bone.name])));
      bone.updateMatrixWorld(true);
    }
  });

  const bones = [];
  armature.traverse(bone => { if (bone.isBone) bones.push(bone); });
  if (!bones.length) throw new Error('The bundled humanoid template has no bones.');
  return { armature, bones, scale, sourcePelvis, targetPelvis: source('pelvis').position.clone() };
}

/**
 * Keep the rotation tracks for bones we actually have, and rescale the pelvis
 * translation to the fitted proportions. Root motion is deliberately dropped —
 * a clip authored for the template's stride would slide a character of a
 * different size across the ground.
 */
export function adaptClips(clips, fitted) {
  const names = new Set(fitted.bones.map(bone => bone.name));
  return clips.map(clip => {
    const tracks = [];
    for (const original of clip.tracks) {
      const split = original.name.lastIndexOf('.');
      const bone = original.name.slice(0, split);
      const property = original.name.slice(split + 1);
      if (!names.has(bone)) continue;
      if (property !== 'quaternion' && !(property === 'position' && bone === 'pelvis')) continue;
      const track = original.clone();
      if (property === 'position') {
        for (let i = 0; i < track.values.length; i++) {
          const axis = ['x', 'y', 'z'][i % 3];
          track.values[i] = fitted.targetPelvis[axis] + (track.values[i] - fitted.sourcePelvis[axis]) * fitted.scale;
        }
      }
      tracks.push(track);
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }).filter(clip => clip.tracks.length).sort((a, b) => a.name.localeCompare(b.name));
}

/** The solver is third-party code; its output is checked, not trusted. */
export function validateWeights(indices, weights, vertexCount, boneCount) {
  if (indices.length !== vertexCount * 4 || weights.length !== vertexCount * 4) {
    throw new Error('Rigging returned incomplete skin weights.');
  }
  for (let i = 0; i < weights.length; i += 4) {
    let sum = 0;
    for (let j = i; j < i + 4; j++) {
      if (!Number.isInteger(indices[j]) || indices[j] < 0 || indices[j] >= boneCount
        || !Number.isFinite(weights[j]) || weights[j] < 0 || weights[j] > 1) {
        throw new Error('Rigging returned invalid skin weights.');
      }
      sum += weights[j];
    }
    if (Math.abs(sum - 1) > 0.001) throw new Error('Skin weights do not sum to one.');
  }
}

export function solveWeights(bones, meshes, signal) {
  signal?.throwIfAborted();
  const hierarchy = bones.map(bone => ({
    name: bone.name,
    parent: bones.indexOf(bone.parent),
    position: bone.position.toArray(),
    quaternion: bone.quaternion.toArray(),
    scale: bone.scale.toArray(),
  }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./skinningWorker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Rigging cancelled.', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Rigging took too long. Choose a lower detail level or simplify the character.')),
      RIG_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', abort, { once: true });
    // A module worker that fails to LOAD reports an ErrorEvent with no message
    // at all, which is indistinguishable from a solver crash unless the
    // filename is included — and a bad import path is exactly the failure this
    // has to be able to name.
    worker.onerror = event => finish(new Error(
      event.message
        ? `${event.message}${event.filename ? ` (${event.filename})` : ''}`
        : 'The rigging worker could not start. Its module imports may not resolve.',
    ));
    worker.onmessage = event => (event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.weights));
    worker.postMessage({
      bones: hierarchy,
      meshes: meshes.map(mesh => ({
        positions: mesh.geometry.attributes.position.array,
        index: mesh.geometry.index?.array,
      })),
    });
  });
}

/**
 * Turn one built level into a skinned, animated model in place.
 * `solver` is injectable so tests can drive the pipeline without a Worker.
 */
export async function rigModel(model, spec, assets, signal, solver = solveWeights) {
  // Joints arrive in model coordinates but the model group may already have
  // been translated by centerRiggingModels, so compare in the same space.
  const bounds = new THREE.Box3().setFromObject(model).translate(model.position.clone().negate());
  const margin = bounds.getSize(new THREE.Vector3()).length() * 0.05;
  for (const [name, point] of Object.entries(validateHumanoid(spec).joints)) {
    if (!bounds.clone().expandByScalar(margin).containsPoint(new THREE.Vector3(...point))) {
      throw new Error(`${name} lies outside the character. Adjust the rig joints.`);
    }
  }

  const fitted = fitHumanoid(assets.rig, spec);
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });

  const weights = await solver(fitted.bones, meshes, signal);
  signal?.throwIfAborted();
  if (weights.length !== meshes.length) throw new Error('Rigging omitted a mesh.');
  weights.forEach((w, i) => validateWeights(w.indices, w.weights, meshes[i].geometry.attributes.position.count, fitted.bones.length));

  model.add(fitted.armature);
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(fitted.bones);
  skeleton.calculateInverses();

  meshes.forEach((mesh, i) => {
    const geometry = mesh.geometry;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(weights[i].indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights[i].weights, 4));
    const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
    skinned.name = mesh.name;
    skinned.userData = { ...mesh.userData };
    skinned.castShadow = skinned.receiveShadow = true;
    // A skinned mesh's bounding sphere is the bind pose's; an animated limb
    // reaching past it would pop out of view.
    skinned.frustumCulled = false;
    mesh.parent.add(skinned);
    skinned.updateMatrixWorld(true);
    skinned.bind(skeleton, skinned.matrixWorld);
    mesh.removeFromParent();
  });

  model.animations = adaptClips(assets.clips, fitted);
  model.userData.rigged = true;
  return model;
}

// The three-side half of the triangle clean-up: pull plain arrays out of the
// built levels, sample animation poses, run meshCleanup.js in a worker, and
// assemble the cleaned levels as NEW objects beside the originals.
//
// The originals are never modified. A cleaned level is a clone whose meshes
// carry freshly built geometry; its every vertex is one of the source's
// vertices (the worker returns a `vertexMap`), so normals, UVs and skin
// weights come across exactly and a rigged character needs no re-solve.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CLEANUP_LEVELS, COMMON_POSE_CLIPS, POSE_FRAMES, effectiveSteps, normalizeCleanup } from './meshCleanup.js';

/** Stable per-level identity of a batched mesh: its object and material. */
export const meshKey = mesh => `${mesh.userData.objectIndex}|${mesh.userData.originalMaterial}`;

function meshesOf(root) {
  const list = [];
  root.traverse(object => { if (object.isMesh) list.push(object); });
  return list.sort((a, b) => (meshKey(a) < meshKey(b) ? -1 : meshKey(a) > meshKey(b) ? 1 : 0));
}

/** Plain, transferable arrays for one level. Skinned meshes are read in their
 *  bind pose (bindMatrix + rest positions), whatever the viewport is playing. */
export function extractLevel(root) {
  root.updateMatrixWorld(true);
  return meshesOf(root).map(mesh => {
    const geometry = mesh.geometry;
    const attributes = {};
    for (const name of ['normal', 'uv', 'skinIndex', 'skinWeight']) {
      const attribute = geometry.attributes[name];
      if (attribute) attributes[name] = { array: attribute.array, itemSize: attribute.itemSize };
    }
    return {
      key: meshKey(mesh),
      positions: geometry.attributes.position.array,
      index: Uint32Array.from(geometry.index.array),
      matrix: (mesh.isSkinnedMesh ? mesh.bindMatrix : mesh.matrixWorld).toArray(),
      attributes,
      parts: mesh.userData.parts || [],
    };
  });
}

/**
 * Bone matrices (bind-world → posed-world, 16 floats per bone) at a spread of
 * frames from each clip. Sampled on a throwaway clone so the viewport's own
 * playback is untouched.
 */
export function samplePoses(animatedRoot, clipNames) {
  const copy = cloneSkinned(animatedRoot);
  copy.updateMatrixWorld(true);
  let skeleton = null;
  copy.traverse(object => { if (!skeleton && object.isSkinnedMesh) skeleton = object.skeleton; });
  if (!skeleton) return [];
  const mixer = new THREE.AnimationMixer(copy);
  const matrix = new THREE.Matrix4();
  const poses = [];
  try {
    for (const name of clipNames) {
      const clip = copy.animations.find(entry => entry.name === name);
      if (!clip) continue;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      for (const frame of POSE_FRAMES) {
        mixer.setTime(frame * clip.duration);
        copy.updateMatrixWorld(true);
        const pose = new Float32Array(skeleton.bones.length * 16);
        skeleton.bones.forEach((bone, i) => {
          matrix.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]).toArray(pose, i * 16);
        });
        poses.push(pose);
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(copy);
    skeleton.dispose();
  }
  return poses;
}

/** Which clips the hidden-triangle check must survive. */
export function poseClips(animatedRoot, settings) {
  const names = (animatedRoot?.animations || []).map(clip => clip.name);
  return normalizeCleanup(settings).hidden.poses === 'all'
    ? names
    : COMMON_POSE_CLIPS.filter(name => names.includes(name));
}

/**
 * Run the clean-up over every level in a worker.
 *
 * @param {object} args
 *   models          Map levelId → built root (the static originals)
 *   animatedModels  Map levelId → rigged root, or empty
 * @returns {Promise<Map<string, {meshes: Map<string, object>, stats: object}>>}
 */
export function runCleanup({ models, animatedModels = new Map(), settings, signal, onProgress = () => {} }) {
  signal?.throwIfAborted();
  const normalized = normalizeCleanup(settings);
  const checkPoses = effectiveSteps(normalized).hidden && animatedModels.size > 0;

  const levels = CLEANUP_LEVELS.filter(id => models.has(id)).map(id => {
    // A rigged character is cleaned through its skinned level, so the poses
    // can be checked; the static twin then gets the identical result.
    const root = animatedModels.get(id) || models.get(id);
    return {
      id,
      levelIndex: CLEANUP_LEVELS.indexOf(id),
      meshes: extractLevel(root),
      poses: checkPoses ? samplePoses(root, poseClips(root, normalized)) : [],
    };
  });

  // One worker per level, run side by side: the levels are independent, and
  // the pose check on Master alone can take a minute, so the total becomes
  // Master's time instead of the sum of all five.
  const concurrency = Math.max(1, Math.min(levels.length, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
  const results = new Map();
  const workers = new Set();
  const latest = new Map();
  const report = () => {
    // Show the first unfinished level in ladder order — usually Master, the
    // one everything is waiting on.
    const pending = levels.find(level => !results.has(level.id));
    if (!pending) return;
    onProgress({ ...(latest.get(pending.id) || {}), level: pending.id, done: results.size, levels: levels.length });
  };

  const runLevel = level => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cleanupWorker.js', import.meta.url), { type: 'module' });
    workers.add(worker);
    const finish = error => {
      worker.terminate();
      workers.delete(worker);
      if (error) reject(error); else resolve();
    };
    // Same failure mode as the rigging worker: a module that fails to load
    // reports an ErrorEvent with no message, so name the likely cause.
    worker.onerror = event => finish(new Error(
      event.message
        ? `${event.message}${event.filename ? ` (${event.filename})` : ''}`
        : 'The clean-up worker could not start. Its module imports may not resolve.',
    ));
    worker.onmessage = ({ data }) => {
      if (data.error) { finish(new Error(data.error)); return; }
      if (data.progress) { latest.set(level.id, data.progress); report(); return; }
      if (data.level) {
        results.set(data.level, {
          stats: data.result.stats,
          meshes: new Map(data.result.meshes.map(mesh => [mesh.key, mesh])),
        });
        report();
        return;
      }
      if (data.done) finish(null);
    };
    worker.postMessage({ settings: normalized, levels: [level] });
  });

  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = error => {
      if (failed) return;
      failed = true;
      workers.forEach(worker => worker.terminate());
      workers.clear();
      signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => fail(signal.reason ?? new DOMException('Clean-up cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });

    const queue = [...levels];
    const next = () => {
      if (failed) return Promise.resolve();
      const level = queue.shift();
      return level ? runLevel(level).then(next) : Promise.resolve();
    };
    Promise.all(Array.from({ length: concurrency }, next)).then(() => {
      if (failed) return;
      signal?.removeEventListener('abort', abort);
      resolve(results);
    }, fail);
  });
}

/** A new geometry holding only the cleaned triangles, every attribute carried
 *  through `vertexMap`. The source geometry is left exactly as it was. */
export function remapGeometry(source, { positions, index, vertexMap }) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name === 'position') {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      continue;
    }
    const size = attribute.itemSize;
    const out = new attribute.array.constructor(vertexMap.length * size);
    for (let i = 0; i < vertexMap.length; i++) {
      for (let k = 0; k < size; k++) out[i * size + k] = attribute.array[vertexMap[i] * size + k];
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, size, attribute.normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A cleaned copy of one level. `skinned` clones through SkeletonUtils so the
 * copy gets its own skeleton and animates independently of the original.
 */
export function buildCleanedModel(source, result, { skinned = false, settings = null } = {}) {
  const copy = skinned ? cloneSkinned(source) : source.clone(true);
  let triangles = 0, meshCount = 0;
  for (const mesh of meshesOf(copy)) {
    const cleaned = result.meshes.get(meshKey(mesh));
    delete mesh.userData.parts;
    if (!cleaned || !cleaned.index.length) {
      // Every triangle of this mesh was hidden: leave it out rather than ship
      // an empty primitive. A missing result cannot happen for meshes the
      // worker saw; if it does, keep an independent copy of the original.
      if (cleaned) { mesh.removeFromParent(); continue; }
      mesh.geometry = mesh.geometry.clone();
    } else {
      mesh.geometry = remapGeometry(mesh.geometry, cleaned);
    }
    triangles += mesh.geometry.index.count / 3;
    meshCount++;
  }
  copy.userData = {
    ...source.userData,
    triangles, meshCount,
    cleaned: true,
    cleanup: settings ? normalizeCleanup(settings) : null,
    cleanupStats: result.stats,
  };
  return copy;
}

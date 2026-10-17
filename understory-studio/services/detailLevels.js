// The five-level ladder and the one geometry helper the recipe builder needs
// that three does not ship.
//
// Ported from the standalone Understory project's `model.js`, which carried
// these alongside the guardian sculpt. Only the generic half came across: the
// guardian's own anatomy lives in that project and has no place here.

import * as THREE from 'three';

const TAU = Math.PI * 2;

/**
 * Master plus four runtime levels. `maxTextureSize` is the glTF export cap for
 * that level, not a render-time setting — switching distances are configured in
 * whatever engine consumes the package, never here.
 */
export const DETAIL_LEVELS = Object.freeze([
  { id: 'master', label: 'Master', description: 'Source sculpt with every described feature at full tessellation.', maxTextureSize: 1024 },
  { id: 'lod0', label: 'LOD 0', description: 'Near-distance runtime level. Reduced tessellation, all features present.', maxTextureSize: 1024 },
  { id: 'lod1', label: 'LOD 1', description: 'Medium distance. Smaller declared details begin to retire.', maxTextureSize: 512 },
  { id: 'lod2', label: 'LOD 2', description: 'Far distance. Major forms and silhouette only.', maxTextureSize: 256 },
  { id: 'lod3', label: 'LOD 3', description: 'Lowest level. Silhouette and the largest forms.', maxTextureSize: 256 },
].map(Object.freeze));

/** Tessellation multiplier per level. Index matches DETAIL_LEVELS. */
export const DETAIL_FACTORS = Object.freeze([1, 0.65, 0.4, 0.25, 0.15]);

export function levelIndex(detail) {
  return DETAIL_LEVELS.findIndex(level => level.id === detail);
}

/** The same seeded generator the sandbox hands to generated code, so a design
 *  evaluated twice describes the same asset. */
export function seededRandom(seed = 73519) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * A tapered tube swept along a Catmull-Rom curve through `points`, capped at
 * both ends. Three's own TubeGeometry cannot taper, and taper is what makes
 * described limbs, roots, horns and stalks read as organic rather than as pipes.
 */
export function tubeGeometry(points, radius, options = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const segments = options.segments ?? 32;
  const radial = options.radial ?? 8;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [], normals = [], uvs = [], indices = [];
  const end = options.end ?? radius * 0.09;
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    let r = THREE.MathUtils.lerp(radius, end, Math.pow(t, options.taper ?? 1.7));
    if (options.radii) {
      const f = t * (options.radii.length - 1);
      const j = Math.min(Math.floor(f), options.radii.length - 2);
      r = THREE.MathUtils.lerp(options.radii[j], options.radii[j + 1], f - j);
    }
    r *= 1 + (options.ripple ?? 0.035) * Math.sin(t * 47.5);
    if (options.startTaper) r *= Math.min(1, 0.15 + t * 9);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      normals.push(n.x, n.y, n.z);
      uvs.push(j / radial, t);
      if (i < segments && j < radial) {
        const k = i * (radial + 1) + j;
        indices.push(k, k + 1, k + radial + 1, k + 1, k + radial + 2, k + radial + 1);
      }
    }
  }
  for (const i of [0, segments]) {
    const center = positions.length / 3;
    const p = curve.getPointAt(i / segments);
    const tangent = curve.getTangentAt(i / segments).multiplyScalar(i === 0 ? -1 : 1);
    positions.push(p.x, p.y, p.z);
    normals.push(tangent.x, tangent.y, tangent.z);
    uvs.push(0.5, i / segments);
    for (let j = 0; j < radial; j++) {
      const k = i * (radial + 1) + j;
      if (i === 0) indices.push(center, k + 1, k);
      else indices.push(center, k, k + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Free every geometry under a built root. Materials are shared and owned by
 *  the caller, so they are deliberately left alone. */
export function disposeModel(root) {
  root?.traverse(object => object.geometry?.dispose());
}

// Triangle clean-up: a switchable pass a person applies AFTER generation.
//
// Three steps, always in this order, each with its own on/off and strength:
//
//   1. Weld      — snap coincident vertices together and merge the identical
//                  ones, then drop zero-area triangles. Simplify needs this:
//                  meshoptimizer only recognises a seam when positions are
//                  bit-identical, and the builder's tubes and lathes close
//                  their seams at cos(0) vs cos(2π), which are not.
//   2. Remove hidden — drop triangles that lie entirely inside another part.
//                  Designs overlap parts on purpose (joints, bulges, plates
//                  pushed into bodies); measured across the saved projects,
//                  15–83% of triangles can never be seen.
//   3. Simplify  — quadric-error edge collapse (Garland & Heckbert 1997) via
//                  the meshoptimizer build three already vendors.
//
// The order is fixed because the other orders only give worse answers:
// simplifying first spends the budget on buried surface and tears seams.
//
// Nothing here touches the input. Every output is a new index buffer plus a
// `vertexMap` back into the source vertices, so any attribute — normals, UVs,
// skin weights — is carried across exactly by the caller. That is also why
// the originals are always one switch away: the clean-up is derived, never
// written back.
//
// Kept free of three and the DOM on purpose: it runs in a module worker (which
// does not inherit the page's import map) and under `node --test`.

import { MeshoptSimplifier } from '../../shared/lib/three/0.185.1/examples/jsm/libs/meshopt_simplifier.module.js';

export const CLEANUP_SCHEMA_VERSION = 1;

/** Level order matches DETAIL_LEVELS; duplicated so this file needs no three. */
export const CLEANUP_LEVELS = Object.freeze(['master', 'lod0', 'lod1', 'lod2', 'lod3']);

/** Simplify gets heavier down the ladder: the same slider means "the same
 *  visual cost" at each level's viewing distance. */
export const SIMPLIFY_LEVEL_SCALE = Object.freeze([1, 1.5, 2.5, 4, 6]);

/**
 * Clips whose poses the hidden-triangle check must survive on an animated
 * character. Chosen for range of motion: stride, crouch, sit, reach overhead,
 * swing, curl, fold. A shoulder buried at rest is exposed by an arm raise, so a
 * triangle is only removed if it stays buried in every one of these.
 */
export const COMMON_POSE_CLIPS = Object.freeze([
  'Walk', 'Sprint', 'Crouch_Idle', 'Sitting_Idle', 'Jump_air', 'Sword_Attack',
  'Spell_Simple_Shoot', 'Punch_Cross', 'Roll', 'Idle_FoldArms', 'Death_D', 'Swim_Fwd',
]);
export const POSE_FRAMES = Object.freeze([0.2, 0.45, 0.7, 0.95]);

export function defaultCleanup() {
  return {
    schemaVersion: CLEANUP_SCHEMA_VERSION,
    enabled: false,
    weld: { enabled: true, strength: 0.35 },
    hidden: { enabled: true, strength: 0.5, poses: 'common' },
    simplify: { enabled: true, strength: 0.4, levels: null },
  };
}

const clamp01 = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

/** Tolerant read of stored settings: anything missing or malformed falls back
 *  to the default rather than failing, so an older or hand-edited project
 *  still opens. */
export function normalizeCleanup(raw) {
  const base = defaultCleanup();
  if (!raw || typeof raw !== 'object') return base;
  const step = (key, extra = s => s) => {
    const source = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
    return extra({
      enabled: source.enabled === undefined ? base[key].enabled : Boolean(source.enabled),
      strength: clamp01(source.strength, base[key].strength),
    }, source);
  };
  return {
    schemaVersion: CLEANUP_SCHEMA_VERSION,
    enabled: Boolean(raw.enabled),
    weld: step('weld'),
    hidden: step('hidden', (s, source) => ({ ...s, poses: source.poses === 'all' ? 'all' : 'common' })),
    simplify: step('simplify', (s, source) => {
      let levels = null;
      if (source.levels && typeof source.levels === 'object') {
        levels = {};
        for (const id of CLEANUP_LEVELS) levels[id] = clamp01(source.levels[id], s.strength);
      }
      return { ...s, levels };
    }),
  };
}

/** Which steps actually run. Simplify implies weld, whatever the weld switch
 *  says — without it seams open. */
export function effectiveSteps(settings) {
  const s = normalizeCleanup(settings);
  return {
    weld: s.weld.enabled || s.simplify.enabled,
    hidden: s.hidden.enabled,
    simplify: s.simplify.enabled,
  };
}

/** A stable key for a result cache: only what changes the output. */
export function cleanupSignature(settings, { rigged = false } = {}) {
  const s = normalizeCleanup(settings);
  const steps = effectiveSteps(s);
  return JSON.stringify({
    weld: steps.weld ? s.weld.strength : null,
    hidden: steps.hidden ? { strength: s.hidden.strength, poses: rigged ? s.hidden.poses : null } : null,
    simplify: steps.simplify ? CLEANUP_LEVELS.map((_, i) => simplifyStrength(s, i)) : null,
  });
}

// ── Strength → parameters ─────────────────────────────────────────────────
// Every distance is a fraction of the asset's bounding-box diagonal, so one
// slider position means the same thing on a 2-unit mushroom and a 10-unit hall.

/** 1e-6 … 1e-3 of the diagonal. */
export function weldDistance(strength) { return 10 ** (-6 + 3 * clamp01(strength, 0.35)); }

/**
 * Low strength = careful: more points per triangle must be buried, and buried
 * deeper. High strength = thorough: corners and centre only, no depth margin.
 */
export function hiddenParams(strength) {
  const s = clamp01(strength, 0.5);
  return {
    samples: s < 1 / 3 ? 'dense' : s < 0.8 ? 'edges' : 'corners',
    depth: 0.006 * (1 - s) ** 2,
  };
}

export function simplifyStrength(settings, levelIndex) {
  const s = normalizeCleanup(settings).simplify;
  return s.levels ? s.levels[CLEANUP_LEVELS[levelIndex]] : s.strength;
}

/** 0.02% … 1% of the diagonal at Master, scaled up per level. */
export function simplifyError(strength, levelIndex = 0) {
  return 0.0002 * 50 ** clamp01(strength, 0.4) * (SIMPLIFY_LEVEL_SCALE[levelIndex] ?? 1);
}

const percent = fraction => {
  const p = fraction * 100;
  return `${p < 0.001 ? p.toPrecision(1) : p < 0.1 ? p.toFixed(3) : p.toFixed(2)}%`;
};
export const describeWeld = s => `merge within ${percent(weldDistance(s))} of size`;
export const describeHidden = s => {
  const { samples, depth } = hiddenParams(s);
  const points = { dense: 13, edges: 7, corners: 4 }[samples];
  return `${points} points per triangle${depth ? `, ≥${percent(depth)} deep` : ', no depth margin'}`;
};
export const describeSimplify = (s, levelIndex = 0) => `max drift ${percent(simplifyError(s, levelIndex))} of size`;

// ── Small vector helpers on flat arrays ───────────────────────────────────

function transformPoint(m, x, y, z, out, o = 0) {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/** Column-major 4×4 inverse (three's layout). Returns null if singular. */
export function invertMatrix(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

function boundsDiagonal(meshes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  for (const mesh of meshes) {
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      transformPoint(mesh.matrix, pos[i], pos[i + 1], pos[i + 2], p);
      for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
}

// ── Step 1: weld ──────────────────────────────────────────────────────────

const ATTRIBUTE_TOLERANCE = { normal: 1e-4, uv: 1e-6, skinIndex: 0, skinWeight: 1e-4 };

/**
 * Snap every vertex within `tolerance` of an earlier one onto it, and merge
 * the pair outright when all their other attributes also agree. A snapped but
 * unmerged pair is a real seam (a UV cut, a hard normal) and stays two
 * vertices — now with identical positions, which is what the simplifier needs
 * to keep the seam closed. Zero-area triangles go at the same time.
 *
 * @returns {{positions: Float32Array, index: Uint32Array, vertexMap: Uint32Array,
 *            triSource: Uint32Array, merged: number, degenerate: number}}
 */
export function weldMesh({ positions, index, attributes = {} }, tolerance, diagonal = 1) {
  const count = positions.length / 3;
  const cell = Math.max(tolerance, 1e-12);
  const grid = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  const remap = new Uint32Array(count);
  const outPositions = [];
  const vertexMap = [];
  const representatives = [];
  const tol2 = tolerance * tolerance;
  const attrs = Object.entries(attributes).filter(([, a]) => a?.array);

  const sameAttributes = (a, b) => {
    for (const [name, { array, itemSize }] of attrs) {
      const eps = ATTRIBUTE_TOLERANCE[name] ?? 1e-6;
      for (let k = 0; k < itemSize; k++) {
        if (Math.abs(array[a * itemSize + k] - array[b * itemSize + k]) > eps) return false;
      }
    }
    return true;
  };

  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let snap = -1, merge = -1;
    for (let dx = -1; dx <= 1 && merge < 0; dx++) {
      for (let dy = -1; dy <= 1 && merge < 0; dy++) {
        for (let dz = -1; dz <= 1 && merge < 0; dz++) {
          const list = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const r of list) {
            const rx = outPositions[r * 3] - x, ry = outPositions[r * 3 + 1] - y, rz = outPositions[r * 3 + 2] - z;
            if (rx * rx + ry * ry + rz * rz > tol2) continue;
            if (snap < 0) snap = r;
            // Merge with any vertex at this spot whose attributes match, not
            // just the first one found — a seam spot holds several.
            for (const candidate of representatives[r]) {
              if (sameAttributes(vertexMap[candidate], v)) { merge = candidate; break; }
            }
            if (merge >= 0) break;
          }
        }
      }
    }
    if (merge >= 0) { remap[v] = merge; continue; }
    const id = vertexMap.length;
    vertexMap.push(v);
    remap[v] = id;
    if (snap >= 0) {
      outPositions.push(outPositions[snap * 3], outPositions[snap * 3 + 1], outPositions[snap * 3 + 2]);
      representatives[snap].push(id);
      representatives.push(null);
    } else {
      outPositions.push(x, y, z);
      representatives.push([id]);
      const key = cellKey(cx, cy, cz);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(id);
    }
  }

  const outIndex = [];
  const triSource = [];
  const minArea2 = (1e-10 * diagonal * diagonal) ** 2 * 4;
  let degenerate = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = remap[index[t]], b = remap[index[t + 1]], c = remap[index[t + 2]];
    if (a === b || b === c || a === c || crossLength2(outPositions, a, b, c) <= minArea2) { degenerate++; continue; }
    outIndex.push(a, b, c);
    triSource.push(t / 3);
  }
  return {
    positions: new Float32Array(outPositions),
    index: new Uint32Array(outIndex),
    vertexMap: new Uint32Array(vertexMap),
    triSource: new Uint32Array(triSource),
    merged: count - vertexMap.length,
    degenerate,
  };
}

function crossLength2(p, a, b, c) {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  return x * x + y * y + z * z;
}

// ── Step 2: hidden triangles ──────────────────────────────────────────────

/**
 * Fast generalised winding number (Jacobson et al. 2013; far-field dipole
 * approximation after Barill et al. 2018). ≈1 inside a closed surface, ≈0
 * outside, and still well-behaved for the open lathes and custom meshes a
 * design can contain. The sign follows the winding, so callers use |w|.
 */
export function buildWindingTree(positions, index, triangles) {
  const n = triangles.length;
  const order = Uint32Array.from(triangles);
  const centroid = new Float64Array(n * 3);
  const areaVector = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = order[i] * 3;
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    for (let k = 0; k < 3; k++) centroid[i * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    areaVector[i * 3] = (uy * vz - uz * vy) / 2;
    areaVector[i * 3 + 1] = (uz * vx - ux * vz) / 2;
    areaVector[i * 3 + 2] = (ux * vy - uy * vx) / 2;
  }
  const slot = Uint32Array.from({ length: n }, (_, i) => i);
  const nodes = [];

  const build = (start, end) => {
    const node = { start, end, left: null, right: null, cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, r: 0 };
    nodes.push(node);
    let weight = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const s = slot[i] * 3;
      const area = Math.hypot(areaVector[s], areaVector[s + 1], areaVector[s + 2]);
      node.cx += centroid[s] * area; node.cy += centroid[s + 1] * area; node.cz += centroid[s + 2] * area;
      node.nx += areaVector[s]; node.ny += areaVector[s + 1]; node.nz += areaVector[s + 2];
      weight += area;
      for (let k = 0; k < 3; k++) {
        if (centroid[s + k] < min[k]) min[k] = centroid[s + k];
        if (centroid[s + k] > max[k]) max[k] = centroid[s + k];
      }
    }
    if (weight > 0) { node.cx /= weight; node.cy /= weight; node.cz /= weight; }
    else { node.cx = (min[0] + max[0]) / 2; node.cy = (min[1] + max[1]) / 2; node.cz = (min[2] + max[2]) / 2; }
    for (let i = start; i < end; i++) {
      const t = order[slot[i]] * 3;
      for (let j = 0; j < 3; j++) {
        const v = index[t + j] * 3;
        const d = Math.hypot(positions[v] - node.cx, positions[v + 1] - node.cy, positions[v + 2] - node.cz);
        if (d > node.r) node.r = d;
      }
    }
    if (end - start > 8) {
      const axis = [0, 1, 2].reduce((best, k) => (max[k] - min[k] > max[best] - min[best] ? k : best), 0);
      const middle = (min[axis] + max[axis]) / 2;
      let i = start, j = end - 1;
      while (i <= j) {
        if (centroid[slot[i] * 3 + axis] < middle) i++;
        else { const tmp = slot[i]; slot[i] = slot[j]; slot[j] = tmp; j--; }
      }
      if (i === start || i === end) i = (start + end) >> 1;
      node.left = build(start, i);
      node.right = build(i, end);
    }
    return node;
  };
  const root = n ? build(0, n) : null;
  return { root, positions, index, order, slot };
}

const FOUR_PI = 4 * Math.PI;

export function windingNumber(tree, qx, qy, qz, beta = 3) {
  if (!tree.root) return 0;
  const { positions: p, index, order, slot } = tree;
  let w = 0;
  const stack = [tree.root];
  while (stack.length) {
    const node = stack.pop();
    const dx = node.cx - qx, dy = node.cy - qy, dz = node.cz - qz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > beta * node.r) {
      w += (dx * node.nx + dy * node.ny + dz * node.nz) / (FOUR_PI * dist * dist * dist);
      continue;
    }
    if (node.left) { stack.push(node.left, node.right); continue; }
    for (let i = node.start; i < node.end; i++) {
      const t = order[slot[i]] * 3;
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const ax = p[a] - qx, ay = p[a + 1] - qy, az = p[a + 2] - qz;
      const bx = p[b] - qx, by = p[b + 1] - qy, bz = p[b + 2] - qz;
      const cx = p[c] - qx, cy = p[c + 1] - qy, cz = p[c + 2] - qz;
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
      const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc
        + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
      w += 2 * Math.atan2(det, den) / FOUR_PI;
    }
  }
  return w;
}

const SAMPLE_SETS = {
  corners: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3]],
  edges: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]],
  dense: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
    [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3], [0.25, 0.75, 0], [0, 0.25, 0.75], [0.75, 0, 0.25]],
};

/**
 * Least-squares rigid fit (Horn 1987, unit quaternions): the rotation R and
 * translation t that best carry `from` onto `to`, and the worst residual. A
 * posed part whose residual is tiny is tested as its bind-pose solid moved by
 * (R, t) and shrunk by that residual; anything the skin bent further than that
 * is tested against its real posed surface instead (findHiddenTriangles).
 */
export function rigidFit(from, to, vertices) {
  const n = vertices.length;
  if (!n) return { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], residual: 0 };
  let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0;
  for (const v of vertices) {
    fx += from[v * 3]; fy += from[v * 3 + 1]; fz += from[v * 3 + 2];
    tx += to[v * 3]; ty += to[v * 3 + 1]; tz += to[v * 3 + 2];
  }
  fx /= n; fy /= n; fz /= n; tx /= n; ty /= n; tz /= n;
  const S = new Float64Array(9);
  for (const v of vertices) {
    const a = [from[v * 3] - fx, from[v * 3 + 1] - fy, from[v * 3 + 2] - fz];
    const b = [to[v * 3] - tx, to[v * 3 + 1] - ty, to[v * 3 + 2] - tz];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += a[i] * b[j];
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  // Power iteration on N + cI finds the largest eigenvalue's eigenvector.
  const shift = S.reduce((sum, x) => sum + Math.abs(x), 0) + 1e-12;
  let q = [1, 0, 0, 0];
  for (let iter = 0; iter < 60; iter++) {
    const next = N.map((row, i) => row.reduce((sum, x, j) => sum + x * q[j], 0) + shift * q[i]);
    const len = Math.hypot(...next) || 1;
    q = next.map(x => x / len);
  }
  const [w, x, y, z] = q;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  const t = [
    tx - (r[0] * fx + r[1] * fy + r[2] * fz),
    ty - (r[3] * fx + r[4] * fy + r[5] * fz),
    tz - (r[6] * fx + r[7] * fy + r[8] * fz),
  ];
  let residual = 0;
  for (const v of vertices) {
    const px = from[v * 3], py = from[v * 3 + 1], pz = from[v * 3 + 2];
    const d = Math.hypot(
      r[0] * px + r[1] * py + r[2] * pz + t[0] - to[v * 3],
      r[3] * px + r[4] * py + r[5] * pz + t[1] - to[v * 3 + 1],
      r[6] * px + r[7] * py + r[8] * pz + t[2] - to[v * 3 + 2],
    );
    if (d > residual) residual = d;
  }
  return { r, t, residual };
}

/** Linear-blend skinning of every vertex: bind-world → posed-world. */
function skinPositions(bindWorld, skinIndex, skinWeight, boneMatrices) {
  const out = new Float32Array(bindWorld.length);
  const count = bindWorld.length / 3;
  for (let v = 0; v < count; v++) {
    const x = bindWorld[v * 3], y = bindWorld[v * 3 + 1], z = bindWorld[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight[v * 4 + k];
      if (!weight) continue;
      const m = skinIndex[v * 4 + k] * 16;
      ox += weight * (boneMatrices[m] * x + boneMatrices[m + 4] * y + boneMatrices[m + 8] * z + boneMatrices[m + 12]);
      oy += weight * (boneMatrices[m + 1] * x + boneMatrices[m + 5] * y + boneMatrices[m + 9] * z + boneMatrices[m + 13]);
      oz += weight * (boneMatrices[m + 2] * x + boneMatrices[m + 6] * y + boneMatrices[m + 10] * z + boneMatrices[m + 14]);
    }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
  }
  return out;
}

/** A uniform grid over boxes, for "which parts could contain this point". */
function boxGrid(boxes, diagonal) {
  const cell = diagonal / 24;
  const grid = new Map();
  boxes.forEach((box, id) => {
    if (!box) return;
    const lo = box.min.map(x => Math.floor(x / cell)), hi = box.max.map(x => Math.floor(x / cell));
    // A part spanning a huge number of cells is still inserted — it is exactly
    // the big body that occludes most of everything.
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = `${x},${y},${z}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(id);
    }
  });
  return (x, y, z) => grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`);
}

/**
 * Mark the triangles that lie entirely inside other parts.
 *
 * `meshes[i]` carries the (welded) local positions and index, its bind-world
 * `matrix`, the `triPart` owner of each triangle, and, for a skinned mesh, its
 * skin attributes per vertex. `parts` are the solids: an analytic test for
 * ellipsoids and boxes (their `matrix` maps the unit shape into bind-world),
 * the winding number over their own triangles for everything else.
 *
 * A triangle is removed only if every sample point, pushed outward along its
 * normal by the depth margin, is inside some other part — in the bind pose AND
 * in every pose supplied. In a pose, each occluder is tested either as its
 * rigidly moved bind solid (when it barely deformed) or by the winding number
 * of its posed triangles (when it bent), so a bent limb still occludes.
 *
 * @returns {Uint8Array[]} per mesh, 1 = hidden
 */
export function findHiddenTriangles(meshes, parts, { strength = 0.5, poses = [], diagonal = 1, onProgress = () => {} } = {}) {
  const { samples: sampleSet, depth: depthFraction } = hiddenParams(strength);
  const samples = SAMPLE_SETS[sampleSet];
  const depth = depthFraction * diagonal;
  // How far a posed part may stray from a rigid move and still be tested as
  // one. Past this, the exact posed-surface test is used.
  const rigidLimit = 0.002 * diagonal;

  const world = meshes.map(mesh => {
    const out = new Float32Array(mesh.positions.length);
    for (let i = 0; i < out.length; i += 3) transformPoint(mesh.matrix, mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2], out, i);
    return out;
  });

  // Solids in bind-world, and the vertex set each one is fitted by per pose.
  const trianglesOf = new Map();
  meshes.forEach(mesh => mesh.triPart.forEach((id, t) => {
    if (id < 0) return;
    if (!trianglesOf.has(id)) trianglesOf.set(id, []);
    trianglesOf.get(id).push(t);
  }));
  const solids = parts.map(part => {
    const mesh = meshes[part.mesh];
    const tris = trianglesOf.get(part.id) || [];
    const vertices = new Set();
    for (const t of tris) for (let j = 0; j < 3; j++) vertices.add(mesh.index[t * 3 + j]);
    const verts = Uint32Array.from(vertices);
    if (!verts.length) return null;
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const bind = world[part.mesh];
    for (const v of verts) for (let k = 0; k < 3; k++) {
      box.min[k] = Math.min(box.min[k], bind[v * 3 + k]);
      box.max[k] = Math.max(box.max[k], bind[v * 3 + k]);
    }
    const analytic = part.type === 'ellipsoid' || part.type === 'box';
    const matrix = analytic ? multiply(mesh.matrix, part.matrix) : null;
    return {
      id: part.id, mesh: part.mesh, type: part.type, verts, box, tris: Uint32Array.from(tris),
      inverse: analytic ? invertMatrix(matrix) : null,
      // A tessellated sphere's faces are chords inside the ideal sphere; test
      // against the largest sphere the facets still contain.
      inner: part.type === 'ellipsoid' ? (part.inner ?? 1) : 1,
      tree: analytic ? null : buildWindingTree(bind, mesh.index, Uint32Array.from(tris)),
    };
  });

  const insideSolid = (solid, x, y, z) => {
    const { min, max } = solid.box;
    if (x <= min[0] || y <= min[1] || z <= min[2] || x >= max[0] || y >= max[1] || z >= max[2]) return false;
    if (solid.inverse) {
      const m = solid.inverse;
      const lx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const ly = m[1] * x + m[5] * y + m[9] * z + m[13];
      const lz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (solid.type === 'box') return Math.max(Math.abs(lx), Math.abs(ly), Math.abs(lz)) < 0.5;
      return Math.hypot(lx, ly, lz) < solid.inner;
    }
    return Math.abs(windingNumber(solid.tree, x, y, z)) > 0.75;
  };

  const hidden = meshes.map(mesh => new Uint8Array(mesh.index.length / 3).fill(1));
  const allPoses = [null, ...poses];

  for (const [poseIndex, pose] of allPoses.entries()) {
    onProgress({ pose: poseIndex, poses: allPoses.length });
    const posed = pose
      ? meshes.map((mesh, i) => (mesh.skinIndex ? skinPositions(world[i], mesh.skinIndex, mesh.skinWeight, pose) : world[i]))
      : world;
    // Per solid, per pose: a part that moved (near-)rigidly is tested as its
    // bind solid carried by the fit — fast, and exact for a rigid move. A part
    // the skin BENT (a limb across its elbow) is tested against its actual
    // posed triangles instead: a single rigid fit of a bent limb can be off
    // by more than the limb is thick, which would make it occlude nothing.
    const fits = solids.map(solid => {
      if (!solid || !pose) return null;
      const fit = rigidFit(world[solid.mesh], posed[solid.mesh], solid.verts);
      return fit.residual <= rigidLimit ? fit : { posed: true };
    });
    const posedTrees = new Map();
    const posedTree = k => {
      if (!posedTrees.has(k)) posedTrees.set(k, buildWindingTree(posed[solids[k].mesh], meshes[solids[k].mesh].index, solids[k].tris));
      return posedTrees.get(k);
    };
    const boxes = solids.map((solid, i) => {
      if (!solid) return null;
      if (!fits[i]) return solid.box;
      const pos = posed[solid.mesh];
      const pad = fits[i].posed ? 0 : fits[i].residual;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const v of solid.verts) for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[v * 3 + k] - pad);
        max[k] = Math.max(max[k], pos[v * 3 + k] + pad);
      }
      return { min, max };
    });
    const lookup = boxGrid(boxes, diagonal);

    let checked = 0;
    for (const [m, mesh] of meshes.entries()) {
      const pos = posed[m];
      const flags = hidden[m];
      for (let t = 0; t < flags.length; t++) {
        if (!flags[t]) continue;
        if ((++checked & 4095) === 0) onProgress({ pose: poseIndex, poses: allPoses.length, checked });
        const own = mesh.triPart[t];
        const a = mesh.index[t * 3] * 3, b = mesh.index[t * 3 + 1] * 3, c = mesh.index[t * 3 + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        // No normal, no direction to push along — keep it rather than guess.
        if (!len) { flags[t] = 0; continue; }
        nx /= len; ny /= len; nz /= len;

        let buried = true;
        for (const [wa, wb, wc] of samples) {
          const qx = wa * pos[a] + wb * pos[b] + wc * pos[c] + nx * depth;
          const qy = wa * pos[a + 1] + wb * pos[b + 1] + wc * pos[c + 1] + ny * depth;
          const qz = wa * pos[a + 2] + wb * pos[b + 2] + wc * pos[c + 2] + nz * depth;
          const candidates = lookup(qx, qy, qz);
          let inside = false;
          if (candidates) {
            for (const k of candidates) {
              const solid = solids[k];
              if (solid.id === own) continue;
              const fit = fits[k];
              if (!fit) {
                if (insideSolid(solid, qx, qy, qz)) { inside = true; break; }
                continue;
              }
              if (fit.posed) {
                const { min, max } = boxes[k];
                if (qx <= min[0] || qy <= min[1] || qz <= min[2] || qx >= max[0] || qy >= max[1] || qz >= max[2]) continue;
                if (Math.abs(windingNumber(posedTree(k), qx, qy, qz)) > 0.75) { inside = true; break; }
                continue;
              }
              // Into the part's bind frame, pushed on by its residual.
              const { r, t: tr, residual } = fit;
              const dx = qx - tr[0], dy = qy - tr[1], dz = qz - tr[2];
              const bnx = r[0] * nx + r[3] * ny + r[6] * nz, bny = r[1] * nx + r[4] * ny + r[7] * nz, bnz = r[2] * nx + r[5] * ny + r[8] * nz;
              const bx = r[0] * dx + r[3] * dy + r[6] * dz + bnx * residual;
              const by = r[1] * dx + r[4] * dy + r[7] * dz + bny * residual;
              const bz = r[2] * dx + r[5] * dy + r[8] * dz + bnz * residual;
              if (insideSolid(solid, bx, by, bz)) { inside = true; break; }
            }
          }
          if (!inside) { buried = false; break; }
        }
        if (!buried) flags[t] = 0;
      }
    }
    if (!hidden.some(flags => flags.some(Boolean))) break;
  }
  return hidden;
}

function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

// ── Step 3: simplify ──────────────────────────────────────────────────────

/** Borders are locked: once hidden triangles are gone, the cut edge sits on
 *  another part's surface, and letting it drift would open a visible gap. */
export async function simplifyMesh(positions, index, absoluteError) {
  await MeshoptSimplifier.ready;
  if (!index.length) return { index, error: 0 };
  const [out, error] = MeshoptSimplifier.simplify(
    index, positions, 3, 0, absoluteError, ['LockBorder', 'ErrorAbsolute'],
  );
  return { index: out, error };
}

// ── The pipeline ──────────────────────────────────────────────────────────

/** Drop vertices no triangle uses; returns compacted arrays and the map. */
function compact(positions, index, vertexMap) {
  const next = new Int32Array(positions.length / 3).fill(-1);
  const outIndex = new Uint32Array(index.length);
  const kept = [];
  for (let i = 0; i < index.length; i++) {
    const v = index[i];
    if (next[v] < 0) { next[v] = kept.length; kept.push(v); }
    outIndex[i] = next[v];
  }
  const outPositions = new Float32Array(kept.length * 3);
  const outMap = new Uint32Array(kept.length);
  kept.forEach((v, i) => {
    outPositions.set(positions.subarray(v * 3, v * 3 + 3), i * 3);
    outMap[i] = vertexMap[v];
  });
  return { positions: outPositions, index: outIndex, vertexMap: outMap };
}

/**
 * Clean one detail level.
 *
 * @param {object} level
 *   meshes: [{ key, positions, index, matrix, attributes: {normal, uv, skinIndex, skinWeight},
 *              parts: [{ type, firstTriangle, triangleCount, matrix, inner }] }]
 * @param {object} settings   normalizeCleanup-compatible settings
 * @param {object} options    { levelIndex, poses: Float32Array[] (bone matrices), onProgress }
 * @returns {Promise<{meshes: object[], stats: object}>}
 */
export async function cleanLevel(level, settings, { levelIndex = 0, poses = [], onProgress = () => {} } = {}) {
  const started = Date.now();
  const s = normalizeCleanup(settings);
  const steps = effectiveSteps(s);
  const diagonal = boundsDiagonal(level.meshes);
  const stats = {
    trianglesBefore: 0, verticesBefore: 0,
    weldMerged: 0, degenerate: 0, hidden: 0, simplified: 0,
    trianglesAfter: 0, verticesAfter: 0, posesChecked: 0,
  };

  // Global part ids; a triangle's owner survives the weld via triSource.
  const parts = [];
  let state = level.meshes.map((mesh, m) => {
    const triangles = mesh.index.length / 3;
    stats.trianglesBefore += triangles;
    stats.verticesBefore += mesh.positions.length / 3;
    const triPart = new Int32Array(triangles).fill(-1);
    for (const part of mesh.parts || []) {
      const id = parts.length;
      parts.push({ ...part, id, mesh: m });
      triPart.fill(id, part.firstTriangle, part.firstTriangle + part.triangleCount);
    }
    return {
      positions: Float32Array.from(mesh.positions),
      index: Uint32Array.from(mesh.index),
      vertexMap: Uint32Array.from({ length: mesh.positions.length / 3 }, (_, i) => i),
      triPart,
    };
  });

  if (steps.weld) {
    onProgress({ step: 'weld' });
    const tolerance = weldDistance(s.weld.strength) * diagonal;
    state = state.map((mesh, m) => {
      const welded = weldMesh({
        positions: mesh.positions, index: mesh.index, attributes: level.meshes[m].attributes,
      }, tolerance, diagonal);
      stats.weldMerged += welded.merged;
      stats.degenerate += welded.degenerate;
      return {
        positions: welded.positions,
        index: welded.index,
        vertexMap: welded.vertexMap,
        triPart: Int32Array.from(welded.triSource, t => mesh.triPart[t]),
      };
    });
  }

  if (steps.hidden && parts.length > 1) {
    onProgress({ step: 'hidden', pose: 0, poses: poses.length + 1 });
    const inputs = state.map((mesh, m) => {
      const skin = level.meshes[m].attributes?.skinIndex?.array && poses.length ? {
        skinIndex: gather(level.meshes[m].attributes.skinIndex.array, 4, mesh.vertexMap),
        skinWeight: gather(level.meshes[m].attributes.skinWeight.array, 4, mesh.vertexMap),
      } : {};
      return { positions: mesh.positions, index: mesh.index, matrix: level.meshes[m].matrix, triPart: mesh.triPart, ...skin };
    });
    const flags = findHiddenTriangles(inputs, parts, {
      strength: s.hidden.strength, poses, diagonal,
      onProgress: progress => onProgress({ step: 'hidden', ...progress }),
    });
    stats.posesChecked = poses.length + 1;
    state = state.map((mesh, m) => {
      const keep = [];
      const keepPart = [];
      for (let t = 0; t < flags[m].length; t++) {
        if (flags[m][t]) { stats.hidden++; continue; }
        keep.push(mesh.index[t * 3], mesh.index[t * 3 + 1], mesh.index[t * 3 + 2]);
        keepPart.push(mesh.triPart[t]);
      }
      return { ...mesh, index: new Uint32Array(keep), triPart: Int32Array.from(keepPart) };
    });
  }

  if (steps.simplify) {
    onProgress({ step: 'simplify' });
    const error = simplifyError(simplifyStrength(s, levelIndex), levelIndex) * diagonal;
    for (const mesh of state) {
      const before = mesh.index.length / 3;
      mesh.index = (await simplifyMesh(mesh.positions, mesh.index, error)).index;
      stats.simplified += before - mesh.index.length / 3;
    }
  }

  const meshes = state.map((mesh, m) => {
    const out = compact(mesh.positions, mesh.index, mesh.vertexMap);
    stats.trianglesAfter += out.index.length / 3;
    stats.verticesAfter += out.vertexMap.length;
    return { key: level.meshes[m].key, ...out };
  });
  stats.ms = Date.now() - started;
  return { meshes, stats };
}

function gather(array, itemSize, map) {
  const out = new array.constructor(map.length * itemSize);
  for (let i = 0; i < map.length; i++) {
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = array[map[i] * itemSize + k];
  }
  return out;
}

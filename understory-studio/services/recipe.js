// The trusted builder: a validated design in, one THREE.Group per level out.
//
// The contract and its validation live in recipeSchema.js; this file is only
// the half that needs three. See that file for why the model writes a design
// rather than geometry.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DETAIL_FACTORS, DETAIL_LEVELS, levelIndex, tubeGeometry } from './detailLevels.js';
import { validateRecipe } from './recipeSchema.js';

export { RECIPE_GUIDE, validateRecipe } from './recipeSchema.js';

const MAX_TRIANGLES = 1_000_000;

function demand(ok, message) { if (!ok) throw new Error(message); }

/**
 * Build one detail level. Parts are merged per material *within* each named
 * object, so the object structure the model described survives into the scene
 * graph and into the exported glTF, while draw calls stay bounded.
 *
 * @param {object} recipe   A design that has passed validateRecipe.
 * @param {object} materials  Material id → THREE.Material, from proceduralTextures.
 * @param {string} detail   A DETAIL_LEVELS id.
 */
export function buildRecipe(recipe, materials, detail = 'master') {
  validateRecipe(recipe);
  const level = levelIndex(detail);
  demand(level >= 0, 'Unknown detail level.');
  const factor = DETAIL_FACTORS[level];
  const segments = (n = 32, min = 4) => Math.max(min, Math.round(n * factor));

  const root = new THREE.Group();
  root.name = recipe.name;
  let triangles = 0, meshCount = 0;

  try {
    for (const [objectIndex, object] of recipe.objects.entries()) {
      const group = new THREE.Group();
      group.name = object.name;
      group.userData.objectIndex = objectIndex;
      const buckets = new Map();
      const partRecords = new Map();
      try {
        for (const p of object.parts) {
          if ((p.lastLevel ?? 4) < level) continue;
          let geometry;
          if (p.type === 'box') geometry = new THREE.BoxGeometry(1, 1, 1);
          if (p.type === 'ellipsoid') {
            geometry = new THREE.SphereGeometry(1, segments(p.segments), segments((p.segments ?? 32) * 0.65, 3));
          }
          if (p.type === 'tube') {
            geometry = tubeGeometry(p.points, p.radius, {
              end: p.end ?? p.radius,
              segments: segments(p.segments, 3),
              radial: segments(p.radial ?? 8, 3),
            });
          }
          if (p.type === 'lathe') {
            geometry = new THREE.LatheGeometry(p.profile.map(v => new THREE.Vector2(...v)), segments(p.segments ?? 40));
          }
          if (p.type === 'extrude') {
            const shape = new THREE.Shape(p.outline.map(v => new THREE.Vector2(...v)));
            geometry = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false, steps: 1, curveSegments: segments(24) });
          }
          if (p.type === 'mesh') {
            const lod = p.lods[level];
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(lod.positions, 3));
            geometry.setIndex(lod.indices);
            // Planar XY projection: crude, but a custom buffer arrives with no
            // UVs at all and an untextured material is worse than a rough wrap.
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
              lod.positions.flatMap((_, i) => (i % 3 === 0 ? [lod.positions[i], lod.positions[i + 1]] : [])), 2,
            ));
            geometry.computeVertexNormals();
          }

          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...(p.position ?? [0, 0, 0])),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rotation ?? [0, 0, 0]))),
            new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
          );
          geometry.applyMatrix4(matrix);
          if (!geometry.index) {
            geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
          }
          if (!buckets.has(p.material)) buckets.set(p.material, []);
          buckets.get(p.material).push(geometry);
          // Which triangles each part became, for the optional clean-up pass:
          // its hidden-triangle test needs to know what is inside what. Ranges
          // hold because mergeGeometries concatenates in push order.
          if (!partRecords.has(p.material)) partRecords.set(p.material, []);
          partRecords.get(p.material).push({
            type: p.type,
            matrix: matrix.toArray(),
            triangleCount: geometry.index.count / 3,
            // Sphere facets are chords of the ideal sphere, so the analytic test
            // uses the largest sphere the tessellation still contains.
            inner: p.type === 'ellipsoid' ? Math.cos(Math.PI / Math.min(
              geometry.parameters.widthSegments, geometry.parameters.heightSegments,
            )) : 1,
          });

          triangles += geometry.index.count / 3;
          demand(triangles <= MAX_TRIANGLES, 'Geometry exceeds one million triangles. Reduce tessellation or part count.');
          demand(
            geometry.attributes.position.array.every(Number.isFinite)
              && geometry.attributes.normal.array.every(Number.isFinite),
            'Geometry has invalid coordinates or normals.',
          );
        }

        for (const [material, geometries] of buckets) {
          const merged = mergeGeometries(geometries, false);
          demand(merged, 'Geometry could not be batched.');
          const mesh = new THREE.Mesh(merged, materials[material]);
          // The original material id is kept so clay/wireframe mode can be
          // reversed, and so export can restore textures over a clay view.
          mesh.userData.originalMaterial = material;
          mesh.userData.objectIndex = objectIndex;
          let firstTriangle = 0;
          mesh.userData.parts = partRecords.get(material).map(record => {
            const entry = { ...record, firstTriangle };
            firstTriangle += record.triangleCount;
            return entry;
          });
          mesh.name = `${object.name} · ${material}`;
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
          meshCount++;
        }
        root.add(group);
      } finally {
        buckets.forEach(list => list.forEach(geometry => geometry.dispose()));
      }
    }

    demand(triangles > 0, `${detail} is empty. Keep major forms at every level.`);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    demand(size.length() > 0.01 && size.length() < 3000, 'Invalid asset bounds.');

    // A stable fingerprint of the description, so two levels built from the same
    // design can be shown to share one layout.
    let layoutHash = 2166136261;
    const definition = JSON.stringify(recipe);
    for (let i = 0; i < definition.length; i++) {
      layoutHash = Math.imul(layoutHash ^ definition.charCodeAt(i), 16777619) >>> 0;
    }
    root.userData = {
      detail, triangles, meshCount, seed: 73519,
      layoutSignature: layoutHash.toString(16).padStart(8, '0'),
    };
    return root;
  } catch (error) {
    root.traverse(object => object.geometry?.dispose());
    throw error;
  }
}

/** Build every level of one design. Throws if any level fails. */
export function buildAllLevels(recipe, materials) {
  const models = new Map();
  try {
    for (const level of DETAIL_LEVELS) models.set(level.id, buildRecipe(recipe, materials, level.id));
    return models;
  } catch (error) {
    models.forEach(model => model.traverse(object => object.geometry?.dispose()));
    throw error;
  }
}

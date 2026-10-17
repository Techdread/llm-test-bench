// The model-facing contract: what a design may contain, and its validation.
//
// The whole premise of this app lives in this file. The model does NOT write
// three.js and does NOT emit vertices: it writes a seeded function body that
// returns a JSON *description* — named materials, and named objects made of
// parametric parts. Everything below that line is ours. Models are unreliable
// at hundreds of mutually-consistent floats and reliable at constructive,
// parametric description, so the contract is shaped to ask only for the latter.
//
// Two consequences worth stating, because both are load-bearing:
//   * Validation runs before a single triangle exists, and its message is a
//     *repair prompt*, not an exception the user sees. A design that violates
//     a bound goes back to the model with the reason.
//   * The design is described ONCE. All five levels are derived by the builder
//     in recipe.js. That is why placements are identical across levels — a
//     reduced level omits detail, it never moves anything.
//
// Kept free of any three import so `node --test` can exercise the bounds that
// matter — prototype-polluting material ids, non-decreasing custom-mesh LODs,
// degenerate tubes — without a WebGL context or a bundler.

import { validateHumanoid } from './humanoid.js';

export const RECIPE_GUIDE = `Write a JavaScript function BODY (no imports, exports, DOM, network, or THREE).
The function receives api.random() (seeded) and returns a JSON-serializable design:
{name:"Asset title",materials:{wood:{color:"#865331",roughness:0.8,metalness:0}},objects:[
 {name:"Named object",parts:[{type:"box",material:"wood",position:[0,1,0],scale:[1,2,1],rotation:[0,0,0]}]}
]}
Y is up, +Z is front, rotations are radians. Ground at y=0. Work at roughly 2–10 units total height.
Each part has type, material, position, scale, rotation. Transforms default to identity.
Types: box (unit cube); ellipsoid (unit-radius sphere, segments:32);
tube (points:[[x,y,z],...], radius:0.1, end:0.02, segments:32, radial:8);
lathe (profile:[[radius,y],...], segments:40);
extrude (outline:[[x,y],...], depth:0.2; a closed 2D polygon extruded along +Z);
mesh (lods:[{positions:[x,y,z,...],indices:[a,b,c,...]},...exactly five levels]).
Optional part lastLevel:0..4 removes small details after that level (0=Master,4=LOD3).
Optional material texture: bark, root, moss, face, cap, tooth, or stem gives procedural normal/color/roughness maps.
Use loops, arithmetic, curves, layers and seeded variation to make a recognizable complete 3D interpretation.
Keep placements constant: the code runs ONCE to describe the design; our renderer derives five LODs.
Give separate named objects for a scene's components. Max 80 objects, 1800 parts, 120 profile/curve points.
Mesh lod arrays need outward winding, finite coordinates, valid triangle indices, and decreasing counts.
Return ONLY JSON: {"code":"...function body...","summary":"what was built and any inferred hidden geometry"}.
Do not return a fenced code block or try to run tools. Never include image URLs or HTML.`;

const types = new Set(['box', 'ellipsoid', 'tube', 'lathe', 'extrude', 'mesh']);
const textures = new Set(['bark', 'root', 'moss', 'face', 'cap', 'tooth', 'stem']);

const MAX_OBJECTS = 80;
const MAX_PARTS = 1800;
const MAX_PROFILE_POINTS = 120;
const MAX_MESH_TRIANGLES = 500_000;
const MAX_TRIANGLES = 1_000_000;

function finite(n, limit = 1000) { return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit; }
function vector(v, n = 3) { return Array.isArray(v) && v.length === n && v.every(x => finite(x)); }
function demand(ok, message) { if (!ok) throw new Error(message); }

/**
 * Bounds-check a design before anything is built. Throws with a message written
 * to be handed straight back to the model as repair feedback.
 */
export function validateRecipe(recipe) {
  demand(recipe && typeof recipe.name === 'string' && recipe.name.length <= 100, 'A short asset name is required.');
  if (recipe.rig !== undefined) validateHumanoid(recipe.rig);
  demand(recipe.materials && typeof recipe.materials === 'object' && !Array.isArray(recipe.materials), 'Materials are required.');

  const entries = Object.entries(recipe.materials);
  demand(entries.length > 0 && entries.length <= 32, 'Use 1–32 materials.');
  for (const [id, material] of entries) {
    // Prototype-polluting keys are refused outright: the identifier is used as
    // an object key on the material map the builder indexes by name.
    demand(/^[a-zA-Z][\w-]{0,40}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id), 'Invalid material identifier.');
    demand(material && /^#[0-9a-f]{6}$/i.test(material.color), 'Materials need six-digit hex colors.');
    for (const key of ['roughness', 'metalness']) {
      demand(material[key] === undefined || (finite(material[key], 1) && material[key] >= 0), `Invalid ${key}.`);
    }
    demand(!material.texture || textures.has(material.texture), 'Unknown texture recipe.');
  }

  demand(Array.isArray(recipe.objects) && recipe.objects.length > 0 && recipe.objects.length <= MAX_OBJECTS, `Use 1–${MAX_OBJECTS} named objects.`);
  let count = 0, meshTriangles = 0;
  for (const object of recipe.objects) {
    demand(
      object && typeof object.name === 'string' && object.name.length <= 100
        && Array.isArray(object.parts) && object.parts.length > 0,
      'Each object needs a name and parts.',
    );
    for (const p of object.parts) {
      demand(++count <= MAX_PARTS && p && types.has(p.type), 'Unknown shape or too many parts.');
      demand(Object.hasOwn(recipe.materials, p.material), 'Shape references an unknown material.');
      for (const key of ['position', 'scale', 'rotation']) {
        demand(p[key] === undefined || vector(p[key]), `Invalid ${key}.`);
      }
      demand(!p.scale || p.scale.every(x => x > 0 && x <= 100), 'Scale must be positive and no larger than 100.');
      demand(p.lastLevel === undefined || (Number.isInteger(p.lastLevel) && p.lastLevel >= 0 && p.lastLevel <= 4), 'Invalid lastLevel.');
      for (const key of ['segments', 'radial']) {
        demand(p[key] === undefined || (Number.isInteger(p[key]) && p[key] >= 3 && p[key] <= 96), `Invalid ${key}.`);
      }

      if (p.type === 'tube') {
        demand(Array.isArray(p.points) && p.points.length >= 2 && p.points.length <= MAX_PROFILE_POINTS && p.points.every(v => vector(v)), `Tube needs 2–${MAX_PROFILE_POINTS} points.`);
        demand(finite(p.radius, 100) && p.radius > 0 && (p.end === undefined || (finite(p.end, 100) && p.end > 0)), 'Invalid tube radius.');
        // A curve whose points are all identical has no frame to sweep along.
        demand(p.points.some(v => v.some((x, i) => x !== p.points[0][i])), 'Tube points must differ.');
      }

      if (p.type === 'lathe' || p.type === 'extrude') {
        const points = p.type === 'lathe' ? p.profile : p.outline;
        const minimum = p.type === 'lathe' ? 2 : 3;
        demand(Array.isArray(points) && points.length >= minimum && points.length <= MAX_PROFILE_POINTS && points.every(v => vector(v, 2)), 'Invalid shape profile.');
        if (p.type === 'lathe') demand(points.every(v => v[0] >= 0), 'Lathe radii must be positive.');
        else demand(finite(p.depth, 100) && p.depth > 0, 'Extrusion needs a positive depth.');
      }

      if (p.type === 'mesh') {
        demand(Array.isArray(p.lods) && p.lods.length === 5, 'Custom meshes require five LOD buffers.');
        let previous = Infinity;
        for (const lod of p.lods) {
          demand(
            lod && Array.isArray(lod.positions) && lod.positions.length >= 9
              && lod.positions.length % 3 === 0 && lod.positions.every(n => finite(n)),
            'Invalid mesh positions.',
          );
          demand(
            Array.isArray(lod.indices) && lod.indices.length >= 3 && lod.indices.length % 3 === 0
              && lod.indices.every(n => Number.isInteger(n) && n >= 0 && n < lod.positions.length / 3),
            'Invalid mesh triangle indices.',
          );
          const triangles = lod.indices.length / 3;
          demand(triangles <= previous, 'Custom mesh levels must not grow in triangle count.');
          previous = triangles;
          meshTriangles += triangles;
          demand(meshTriangles <= MAX_MESH_TRIANGLES, 'Custom mesh budget exceeded.');
        }
      }
    }
  }
  demand(count > 0, 'The design is empty.');
  return recipe;
}

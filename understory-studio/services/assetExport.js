// glTF export and the five-level package.
//
// Two rules hold throughout, and both come from the same place — an export must
// describe what the asset IS, not what the viewport happens to be showing:
//   * Original textured materials are restored even when the viewport is in
//     clay or wireframe mode.
//   * Export starts from the BIND pose regardless of playback time, so a
//     paused walk cycle cannot be baked into the rest position.

import { Box3 } from 'three';
import { restoreBindPose } from './rigPose.js';

export function assetFilename(name, detail) {
  const safeName = String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
  const safeDetail = String(detail).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'master';
  return `${safeName}-${safeDetail}.glb`;
}

export async function exportTexturedGLB(root, materials, {
  maxTextureSize = 1024, signal, animations = [], onBounds = () => {},
} = {}) {
  signal?.throwIfAborted();
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const { clone } = await import('three/addons/utils/SkeletonUtils.js');
  signal?.throwIfAborted();

  // SkeletonUtils.clone, not Object3D.clone: a plain clone shares the skeleton
  // and rebinds nothing, so an exported skinned mesh would follow the live one.
  const copy = clone(root);
  restoreBindPose(copy);
  onBounds(new Box3().setFromObject(copy, true));

  const clonedMaterials = new Map();
  const cloneMaterial = source => {
    if (!clonedMaterials.has(source)) {
      const material = source.clone();
      // glTF has no bump channel. Shipping both is redundant at best and makes
      // some importers double the relief, so the normal map wins.
      if (material.normalMap) {
        material.bumpMap = null;
        material.bumpScale = 1;
      }
      clonedMaterials.set(source, material);
    }
    return clonedMaterials.get(source);
  };

  try {
    copy.traverse(object => {
      // Builder bookkeeping for the clean-up pass (per-part triangle ranges and
      // matrices). Internal, bulky, and meaningless outside this app — it would
      // otherwise land in every mesh's glTF extras.
      delete object.userData.parts;
      if (!object.isMesh) return;
      const source = materials?.[object.userData.originalMaterial] ?? object.material;
      object.material = Array.isArray(source) ? source.map(cloneMaterial) : cloneMaterial(source);
    });
    const buffer = await new GLTFExporter().parseAsync(copy, {
      binary: true, maxTextureSize, onlyVisible: true, animations,
    });
    signal?.throwIfAborted();
    return buffer;
  } finally {
    clonedMaterials.forEach(material => material.dispose());
  }
}

/**
 * Every level as its own complete GLB plus a manifest describing the set.
 * Deliberately NOT a single glTF with LOD extensions: the point is a package a
 * game engine can consume with its own switching thresholds.
 */
export async function exportLODArchive({
  name, levels, getModel, materials, onProgress = () => {}, signal, getAnimations = () => [],
  manifestExtra = {},
}) {
  if (!levels.length || new Set(levels.map(level => level.id)).size !== levels.length) {
    throw new Error('An LOD archive needs at least one level and unique level identifiers.');
  }
  const { zipSync, strToU8 } = await import('../../shared/lib/fflate/0.8.2/index.mjs');
  const files = {};
  const records = [];
  const filenames = new Set();

  for (const [index, level] of levels.entries()) {
    signal?.throwIfAborted();
    onProgress({ phase: 'exporting', index, total: levels.length, level });
    // Yield between levels so the progress text actually paints.
    await new Promise(resolve => setTimeout(resolve, 0));

    const root = await getModel(level.id);
    if (!root?.isObject3D) throw new Error(`Missing model for ${level.id}.`);
    const file = assetFilename(name, level.id);
    if (filenames.has(file)) throw new Error('LOD identifiers must produce unique export filenames.');
    filenames.add(file);

    const animations = getAnimations(root);
    let bounds;
    const buffer = await exportTexturedGLB(root, materials, {
      maxTextureSize: level.maxTextureSize, signal, animations, onBounds: box => { bounds = box; },
    });
    files[file] = new Uint8Array(buffer);

    let triangles = 0, meshes = 0;
    root.traverse(object => {
      if (!object.isMesh || !object.visible) return;
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    });

    records.push({
      id: level.id,
      label: level.label,
      role: level.role ?? (level.id === 'master' ? 'source-sculpt' : 'runtime-lod'),
      ...(level.variant ? { variant: level.variant, sourceLevel: level.sourceLevel } : {}),
      ...(level.cleanupStats ? { cleanup: level.cleanupStats } : {}),
      file,
      triangles,
      meshes,
      rigged: root.userData.rigged === true,
      animations: animations.map(clip => clip.name),
      seed: root.userData.seed,
      layoutSignature: root.userData.layoutSignature,
      maxTextureSize: level.maxTextureSize,
      bytes: buffer.byteLength,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    });
  }

  signal?.throwIfAborted();
  const manifest = {
    format: 'understory-lod-package',
    version: 1,
    asset: name,
    coordinateSystem: { up: '+Y', front: '+Z', units: 'scene units; physical scale is not calibrated' },
    usage: 'Each GLB is a complete alternative version of the same asset. Render one level at a time. Keep the master as a source sculpt and configure switching thresholds in your game engine.',
    textures: 'Original materials are preserved; texture maps are embedded when present. Procedural normal maps are generated surfaces, not high-to-low geometry bakes.',
    automaticLodSwitching: false,
    rigged: records.every(record => record.rigged),
    ...manifestExtra,
    levels: records,
  };
  files['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  onProgress({ phase: 'packing', index: levels.length, total: levels.length, level: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  signal?.throwIfAborted();
  // level 0: the GLBs are already compressed payloads; deflating them again
  // costs seconds and saves almost nothing.
  const archive = zipSync(files, { level: 0 });
  signal?.throwIfAborted();
  return { blob: new Blob([archive], { type: 'application/zip' }), manifest };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

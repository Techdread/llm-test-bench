// Runs the vendored Mesh2Motion solver over one fitted skeleton and a set of
// meshes. Imported by skinningWorker.js, so every import here must resolve
// WITHOUT an import map — module Workers do not inherit the document's.
import { Bone, BufferGeometry, Float32BufferAttribute } from '../../shared/lib/three/0.185.1/build/three.module.js';
import SkinningAlgorithm from '../../shared/lib/mesh2motion/1.0.0/solvers/SkinningAlgorithm.js';

export function calculateSkinWeights(data) {
  const bones = data.bones.map(spec => {
    const bone = new Bone();
    bone.name = spec.name;
    bone.position.fromArray(spec.position);
    bone.quaternion.fromArray(spec.quaternion);
    bone.scale.fromArray(spec.scale);
    return bone;
  });
  data.bones.forEach((spec, i) => { if (spec.parent >= 0) bones[spec.parent].add(bones[i]); });

  const root = bones[0];
  root.updateMatrixWorld(true);
  const solver = new SkinningAlgorithm(root, 'human');

  // The head corrector needs to know where the head stops being the torso.
  const neck = bones.find(bone => bone.name === 'neck_01');
  solver.set_head_weight_correction_enabled(true);
  solver.set_preview_plane_height(neck.getWorldPosition(neck.position.clone()).y);

  return data.meshes.map(mesh => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
    if (mesh.index) geometry.setIndex(Array.from(mesh.index));
    try {
      solver.set_geometry(geometry);
      const [indices, weights] = solver.calculate_indexes_and_weights();
      return { indices: new Uint16Array(indices), weights: new Float32Array(weights) };
    } finally {
      geometry.dispose();
    }
  });
}

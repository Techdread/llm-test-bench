// Three's Skeleton.pose() treats a non-bone parent as identity. Our characters
// hang under a translated model group (see rigging.centerRiggingModels), so
// posing alone leaves every root bone offset by that translation — the mesh
// exports and previews in a shifted bind pose. Undo the parent transform on the
// root bones after posing.
export function restoreBindPose(root) {
  root.updateMatrixWorld(true);
  const skeletons = new Set();
  root.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
  for (const skeleton of skeletons) {
    skeleton.pose();
    for (const bone of skeleton.bones) {
      if (bone.parent && !bone.parent.isBone) {
        bone.matrix.copy(bone.parent.matrixWorld).invert().multiply(bone.matrixWorld);
        bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      }
    }
  }
  root.updateMatrixWorld(true);
}

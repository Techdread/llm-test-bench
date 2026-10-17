// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import {
  Vector3
} from '../../../three/0.185.1/build/three.module.js';
import { Utility } from "../Utilities.js";
import { BoneClassifier, BoneCategory } from "./BoneClassifier.js";
class ExtremityWeightCorrector {
  geometry;
  bones;
  classifier;
  bone_to_index = /* @__PURE__ */ new Map();
  constructor(geometry, bones) {
    this.geometry = geometry;
    this.bones = bones;
    this.classifier = new BoneClassifier(bones);
    bones.forEach((bone, idx) => this.bone_to_index.set(bone, idx));
  }
  /**
   * Walks every vertex assigned to an extremity bone and reassigns it to the
   * bone's parent when it sits behind the bone's start joint.
   * Modifies skin_indices in place. Runs before smoothing so the corrected
   * assignments are what the smoother sees.
   */
  apply_extremity_weight_correction(skin_indices, skin_weights) {
    const vertex_count = this.geometry.attributes.position.array.length / 3;
    const bone_axes = this.build_extremity_bone_axes();
    for (let i = 0; i < vertex_count; i++) {
      const offset = i * 4;
      const bone_index = skin_indices[offset];
      const axis = bone_axes.get(bone_index);
      if (axis === void 0) continue;
      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i);
      const to_vertex = vertex_position.sub(axis.head);
      if (to_vertex.dot(axis.direction) < 0) {
        skin_indices[offset] = axis.parent_index;
      }
    }
  }
  /**
   * Builds, for each extremity bone that has a parent bone in our list, the
   * start-joint position, the axis pointing toward its child, and the parent
   * bone index. Leaf extremity bones (no child) fall back to the direction
   * coming from the parent joint.
   */
  build_extremity_bone_axes() {
    const axes = /* @__PURE__ */ new Map();
    this.bones.forEach((bone, idx) => {
      if (this.classifier.get_category(idx) !== BoneCategory.Extremity) return;
      const parent = bone.parent;
      if (parent === null) return;
      const parent_index = this.bone_to_index.get(parent);
      if (parent_index === void 0) return;
      const head = Utility.world_position_from_object(bone);
      let direction;
      if (bone.children.length > 0) {
        const child_head = Utility.world_position_from_object(bone.children[0]);
        direction = Utility.direction_between_points(head, child_head);
      } else {
        const parent_head = Utility.world_position_from_object(parent);
        direction = Utility.direction_between_points(parent_head, head);
      }
      axes.set(idx, { head, direction, parent_index });
    });
    return axes;
  }
}
export {
  ExtremityWeightCorrector
};

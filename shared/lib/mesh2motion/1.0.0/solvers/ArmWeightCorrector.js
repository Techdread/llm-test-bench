// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import {
  Vector3,
  Bone
} from '../../../three/0.185.1/build/three.module.js';
import { Utility } from "../Utilities.js";
class ArmWeightCorrector {
  geometry;
  bones;
  arm_plane_offset;
  constructor(geometry, bones_master_data, arm_plane_offset) {
    this.geometry = geometry;
    this.bones = bones_master_data;
    this.arm_plane_offset = arm_plane_offset;
  }
  /**
   * Distance from the model's center line to the shoulder joint, which is where
   * the arm plane sits when the user's offset is zero.
   *
   * Shared with the edit-skeleton preview so the plane the user sees and the
   * plane the solver uses are derived the same way. The solver runs against a
   * clone of the edited armature, so both recompute this from bones rather than
   * passing an absolute coordinate around.
   *
   * @returns the absolute world X of the shoulder joint, or null if no arm bone was found
   */
  static shoulder_anchor_x(bones) {
    const shoulder_bone = ArmWeightCorrector.find_shoulder_bone(bones);
    if (shoulder_bone === void 0) {
      return null;
    }
    return Math.abs(Utility.world_position_from_object(shoulder_bone).x);
  }
  /**
   * The bone the arm plane is anchored to. Human rigs name it `upperarm_l`;
   * the fallbacks cover rigs that use other conventions.
   */
  static find_shoulder_bone(bones) {
    const name_priority = ["upperarm", "shoulder", "arm"];
    for (const keyword of name_priority) {
      const match = bones.find((bone) => bone.name.toLowerCase().includes(keyword));
      if (match !== void 0) {
        return match;
      }
    }
    return void 0;
  }
  /**
   * Reassign arm-bone weights on vertices inboard of the arm plane.
   * Modifies skin_indices and skin_weights in place. Runs before smoothing so
   * the smoother blends the new torso/arm boundary instead of leaving a seam.
   */
  apply_arm_weight_correction(skin_indices, skin_weights) {
    const anchor_x = ArmWeightCorrector.shoulder_anchor_x(this.bones);
    if (anchor_x === null) {
      return;
    }
    const plane_x = anchor_x + this.arm_plane_offset;
    if (plane_x <= 0) {
      return;
    }
    const arm_bone_indices = this.find_arm_bone_indices();
    if (arm_bone_indices.size === 0) {
      return;
    }
    const fallback_bones = this.build_fallback_bone_candidates(arm_bone_indices);
    if (fallback_bones.length === 0) {
      return;
    }
    this.correct_vertex_weights(skin_indices, skin_weights, plane_x, arm_bone_indices, fallback_bones);
  }
  /**
   * Every upperarm bone plus all of its descendants (lowerarm, hand, fingers),
   * on both sides. Walking the hierarchy rather than matching a keyword list
   * gives exactly "upperarm and below" without needing to enumerate every
   * finger bone name, and it leaves the clavicle alone.
   */
  find_arm_bone_indices() {
    const bone_to_index = /* @__PURE__ */ new Map();
    this.bones.forEach((bone, idx) => bone_to_index.set(bone, idx));
    const arm_bone_indices = /* @__PURE__ */ new Set();
    this.bones.forEach((bone) => {
      if (!bone.name.toLowerCase().includes("upperarm")) {
        return;
      }
      bone.traverse((descendant) => {
        if (!(descendant instanceof Bone)) {
          return;
        }
        const index = bone_to_index.get(descendant);
        if (index !== void 0) {
          arm_bone_indices.add(index);
        }
      });
    });
    return arm_bone_indices;
  }
  /**
   * Bones a stripped vertex can be handed to: everything that isn't an arm bone,
   * minus the root (global transform only) and leaf/orientation bones, which the
   * solver never assigns vertices to.
   */
  build_fallback_bone_candidates(arm_bone_indices) {
    const candidates = [];
    this.bones.forEach((bone, idx) => {
      if (arm_bone_indices.has(idx)) {
        return;
      }
      if (bone.name === "root" || Utility.is_leaf_bone(bone)) {
        return;
      }
      candidates.push({ index: idx, midpoint: Utility.bone_midpoint_to_child(bone) });
    });
    return candidates;
  }
  correct_vertex_weights(skin_indices, skin_weights, plane_x, arm_bone_indices, fallback_bones) {
    const vertex_count = this.geometry.attributes.position.array.length / 3;
    for (let i = 0; i < vertex_count; i++) {
      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i);
      if (Math.abs(vertex_position.x) >= plane_x) {
        continue;
      }
      const offset = i * 4;
      let stolen_weight = 0;
      let first_freed_slot = -1;
      for (let j = 0; j < 4; j++) {
        if (!arm_bone_indices.has(skin_indices[offset + j])) {
          continue;
        }
        if (skin_weights[offset + j] <= 0) {
          continue;
        }
        stolen_weight += skin_weights[offset + j];
        skin_weights[offset + j] = 0;
        skin_indices[offset + j] = 0;
        if (first_freed_slot === -1) {
          first_freed_slot = j;
        }
      }
      if (stolen_weight <= 0) {
        continue;
      }
      const replacement_bone_index = this.find_closest_fallback_bone(vertex_position, fallback_bones);
      let target_slot = -1;
      for (let j = 0; j < 4; j++) {
        if (skin_indices[offset + j] === replacement_bone_index && skin_weights[offset + j] > 0) {
          target_slot = j;
          break;
        }
      }
      if (target_slot === -1) {
        target_slot = first_freed_slot;
        skin_indices[offset + target_slot] = replacement_bone_index;
      }
      skin_weights[offset + target_slot] += stolen_weight;
      this.normalize_vertex_weights(skin_weights, offset);
    }
  }
  find_closest_fallback_bone(vertex_position, fallback_bones) {
    let closest_distance = Infinity;
    let closest_index = fallback_bones[0].index;
    for (const candidate of fallback_bones) {
      const distance = candidate.midpoint.distanceTo(vertex_position);
      if (distance < closest_distance) {
        closest_distance = distance;
        closest_index = candidate.index;
      }
    }
    return closest_index;
  }
  /**
   * Normalize weights for a single vertex to ensure they sum to 1.0
   */
  normalize_vertex_weights(skin_weights, offset) {
    const total_weight = skin_weights[offset] + skin_weights[offset + 1] + skin_weights[offset + 2] + skin_weights[offset + 3];
    if (total_weight > 0) {
      skin_weights[offset] /= total_weight;
      skin_weights[offset + 1] /= total_weight;
      skin_weights[offset + 2] /= total_weight;
      skin_weights[offset + 3] /= total_weight;
    }
  }
}
export {
  ArmWeightCorrector
};

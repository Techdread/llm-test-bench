// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import {
  Vector3,
  Raycaster,
  Mesh,
  MeshBasicMaterial,
  DoubleSide
} from '../../../three/0.185.1/build/three.module.js';
import { Utility } from "../Utilities.js";
import { SkeletonType } from "../enums/SkeletonType.js";
import { RigConfig } from "../RigConfig.js";
class WeightCalculator {
  bones;
  geometry;
  skeleton_type;
  cached_median_child_bone_positions = [];
  bone_object_to_index = /* @__PURE__ */ new Map();
  distance_to_bottom_of_position_tracking_bone = 0;
  // each index will be a bone index. the value will be a list of vertex indices that belong to that bone
  bones_vertex_segmentation = [];
  // bone indices that should never receive vertex weights: the root (global
  // transform only) and leaf/orientation bones (finger/toe/tail tips, etc.)
  skipped_bone_indices = /* @__PURE__ */ new Set();
  constructor(bones, geometry, skeleton_type) {
    this.bones = bones;
    this.geometry = geometry;
    this.skeleton_type = skeleton_type;
  }
  /**
   * Pre-computes cached values needed for weight calculations.
   * Must be called before calculate_median_bone_weights.
   */
  initialize_caches() {
    this.cached_median_child_bone_positions = this.bones.map((b) => Utility.bone_midpoint_to_child(b));
    this.bones.forEach((b, idx) => this.bone_object_to_index.set(b, idx));
    this.bones.forEach((b, idx) => {
      if (b.name === "root" || Utility.is_leaf_bone(b)) {
        this.skipped_bone_indices.add(idx);
      }
    });
    this.distance_to_bottom_of_position_tracking_bone = this.calculate_distance_to_bottom_of_position_tracking_bone();
  }
  get_cached_median_child_bone_positions() {
    return this.cached_median_child_bone_positions;
  }
  /**
   * Assigns the closest bone to each vertex.
   * Modifies the skin_indices and skin_weights arrays in place.
   */
  calculate_median_bone_weights(skin_indices, skin_weights) {
    const vertex_count = this.geometry.attributes.position.array.length / 3;
    for (let i = 0; i < vertex_count; i++) {
      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i);
      let closest_bone_distance = 1e3;
      let closest_bone_index = 0;
      this.bones.forEach((bone, idx) => {
        if (this.skipped_bone_indices.has(idx)) {
          return;
        }
        if (this.skeleton_type === SkeletonType.Human && (bone.name.includes("hips") || bone.name.includes("pelvis"))) {
          if (this.distance_to_bottom_of_position_tracking_bone !== null && this.distance_to_bottom_of_position_tracking_bone < vertex_position.y) {
            return;
          }
        }
        const distance = this.cached_median_child_bone_positions[idx].distanceTo(vertex_position);
        if (distance < closest_bone_distance) {
          closest_bone_distance = distance;
          closest_bone_index = idx;
        }
      });
      this.bones_vertex_segmentation[closest_bone_index] ??= [];
      this.bones_vertex_segmentation[closest_bone_index].push(i);
      skin_indices.push(closest_bone_index, 0, 0, 0);
      skin_weights.push(1, 0, 0, 0);
    }
  }
  // every vertex checks to see if it is below the hips area,
  // so do this calculation once and cache it for the lookup later
  calculate_distance_to_bottom_of_position_tracking_bone() {
    const position_tracking_bone_name = RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name || "UNKNOWN POSITION BONE";
    let position_tracking_bone_object = this.bones.find((b) => {
      const name = b.name.toLowerCase();
      return name.includes(position_tracking_bone_name.toLowerCase());
    });
    if (position_tracking_bone_object === void 0) {
      throw new Error("Position tracking bone not found");
    }
    const intesection_point = this.cast_intersection_ray_down_from_bone(position_tracking_bone_object);
    const bone_index = this.bones.findIndex((b) => b === position_tracking_bone_object);
    const bone_position = this.cached_median_child_bone_positions[bone_index];
    let distance_to_bottom = intesection_point?.distanceTo(bone_position) ?? 0;
    distance_to_bottom *= 1.1;
    return distance_to_bottom;
  }
  cast_intersection_ray_down_from_bone(bone) {
    const raycaster = new Raycaster();
    const bone_index = this.bones.findIndex((b) => b === bone);
    const bone_position = this.cached_median_child_bone_positions[bone_index];
    raycaster.set(bone_position, new Vector3(0, -1, 0));
    const temp_mesh = new Mesh(this.geometry, new MeshBasicMaterial());
    temp_mesh.material.side = DoubleSide;
    const recursive_check_child_objects = false;
    const intersections = raycaster.intersectObject(temp_mesh, recursive_check_child_objects);
    if (intersections.length > 0) {
      return intersections[0].point;
    }
    return null;
  }
}
export {
  WeightCalculator
};

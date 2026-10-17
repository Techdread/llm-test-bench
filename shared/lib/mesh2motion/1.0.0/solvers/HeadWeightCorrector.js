// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import { Vector3 } from '../../../three/0.185.1/build/three.module.js';
class HeadWeightCorrector {
  geometry;
  bones_master_data;
  preview_plane_height;
  constructor(geometry, bones_master_data, preview_plane_height) {
    this.geometry = geometry;
    this.bones_master_data = bones_master_data;
    this.preview_plane_height = preview_plane_height;
  }
  /**
   * Apply head weight correction to the skin indices and weights
   * @param skin_indices Array of bone indices for each vertex (4 per vertex)
   * @param skin_weights Array of bone weights for each vertex (4 per vertex)
   */
  apply_head_weight_correction(skin_indices, skin_weights) {
    const head_bone_index = this.find_head_bone_index();
    if (head_bone_index === -1) {
      return;
    }
    const arm_bone_indices = this.find_arm_bone_indices();
    if (arm_bone_indices.length === 0) {
      return;
    }
    this.correct_vertex_weights(skin_indices, skin_weights, head_bone_index, arm_bone_indices);
  }
  /**
   * Find the index of the head bone (looking for "DEF-head" or similar)
   */
  find_head_bone_index() {
    const head_bone_names = ["DEF-head", "head", "Head", "HEAD"];
    for (let i = 0; i < this.bones_master_data.length; i++) {
      const bone_name = this.bones_master_data[i].name;
      if (head_bone_names.includes(bone_name)) {
        return i;
      }
      const lower_bone_name = bone_name.toLowerCase();
      if (head_bone_names.some(
        (name) => lower_bone_name.includes(name.toLowerCase())
      )) {
        return i;
      }
    }
    return -1;
  }
  /**
   * Find the indices of arm bones (looking for arm, shoulder, hand bones)
   */
  find_arm_bone_indices() {
    const arm_bone_keywords = [
      "arm",
      "shoulder",
      "hand",
      "finger",
      "thumb",
      "elbow",
      "forearm",
      "upperarm",
      "thumb",
      "index",
      "middle",
      "ring",
      "pinky"
    ];
    const arm_bone_indices = [];
    for (let i = 0; i < this.bones_master_data.length; i++) {
      const bone_name = this.bones_master_data[i].name.toLowerCase();
      if (arm_bone_keywords.some((keyword) => bone_name.includes(keyword))) {
        arm_bone_indices.push(i);
      }
    }
    return arm_bone_indices;
  }
  /**
   * Correct vertex weights for vertices above the height threshold
   */
  correct_vertex_weights(skin_indices, skin_weights, head_bone_index, arm_bone_indices) {
    const vertex_count = this.geometry.attributes.position.array.length / 3;
    let corrected_count = 0;
    for (let i = 0; i < vertex_count; i++) {
      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i);
      if (vertex_position.y <= this.preview_plane_height) {
        continue;
      }
      const offset = i * 4;
      const primary_bone_index = skin_indices[offset];
      const primary_weight = skin_weights[offset];
      if (arm_bone_indices.includes(primary_bone_index) && primary_weight > 0.5) {
        skin_indices[offset] = head_bone_index;
        skin_indices[offset + 1] = 0;
        skin_indices[offset + 2] = 0;
        skin_indices[offset + 3] = 0;
        skin_weights[offset] = 1;
        skin_weights[offset + 1] = 0;
        skin_weights[offset + 2] = 0;
        skin_weights[offset + 3] = 0;
        corrected_count++;
        continue;
      }
      for (let j = 0; j < 4; j++) {
        const bone_index = skin_indices[offset + j];
        const weight = skin_weights[offset + j];
        if (arm_bone_indices.includes(bone_index) && weight > 0.3) {
          let head_slot = -1;
          for (let k = 0; k < 4; k++) {
            if (skin_indices[offset + k] === head_bone_index) {
              head_slot = k;
              break;
            }
          }
          if (head_slot === -1) {
            skin_indices[offset + j] = head_bone_index;
          } else {
            skin_weights[offset + head_slot] += weight;
            skin_weights[offset + j] = 0;
            skin_indices[offset + j] = 0;
          }
          corrected_count++;
        }
      }
      this.normalize_vertex_weights(skin_weights, offset);
    }
    return corrected_count;
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
  HeadWeightCorrector
};

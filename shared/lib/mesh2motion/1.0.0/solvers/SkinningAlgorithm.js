// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import {
  BufferGeometry
} from '../../../three/0.185.1/build/three.module.js';
import { Utility } from "../Utilities.js";
import { HeadWeightCorrector } from "./HeadWeightCorrector.js";
import { ArmWeightCorrector } from "./ArmWeightCorrector.js";
import { WeightCalculator } from "./WeightCalculator.js";
import { ExtremityWeightCorrector } from "./ExtremityWeightCorrector.js";
import { WeightSmoother } from "./WeightSmoother.js";
import { WeightNormalizer } from "./WeightNormalizer.js";
class SkinningAlgorithm {
  bones_master_data = [];
  geometry = new BufferGeometry();
  skeleton_type = null;
  // Head weight correction properties
  use_head_weight_correction = false;
  preview_plane_height = 1.4;
  // Arm plane correction properties. The offset is relative to the shoulder
  // joint's X, which the corrector reads off the bones itself.
  use_arm_plane_correction = false;
  arm_plane_offset = 0;
  constructor(bone_hier, skeleton_type) {
    this.skeleton_type = skeleton_type;
    this.bones_master_data = Utility.bone_list_from_hierarchy(bone_hier);
  }
  set_geometry(geom) {
    this.geometry = geom;
  }
  set_head_weight_correction_enabled(enabled) {
    this.use_head_weight_correction = enabled;
  }
  set_preview_plane_height(height) {
    this.preview_plane_height = height;
  }
  set_arm_plane_correction_enabled(enabled) {
    this.use_arm_plane_correction = enabled;
  }
  set_arm_plane_offset(offset) {
    this.arm_plane_offset = offset;
  }
  calculate_indexes_and_weights() {
    const skin_indices = [];
    const skin_weights = [];
    const weight_calculator = new WeightCalculator(this.bones_master_data, this.geometry, this.skeleton_type);
    weight_calculator.initialize_caches();
    console.time("calculate_closest_bone_weights");
    weight_calculator.calculate_median_bone_weights(skin_indices, skin_weights);
    const extremity_corrector = new ExtremityWeightCorrector(this.geometry, this.bones_master_data);
    extremity_corrector.apply_extremity_weight_correction(skin_indices, skin_weights);
    if (this.use_arm_plane_correction) {
      const arm_weight_corrector = new ArmWeightCorrector(
        this.geometry,
        this.bones_master_data,
        this.arm_plane_offset
      );
      arm_weight_corrector.apply_arm_weight_correction(skin_indices, skin_weights);
    }
    const weight_smoother = new WeightSmoother(this.geometry, this.bones_master_data);
    weight_smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights);
    console.timeEnd("calculate_closest_bone_weights");
    const weight_normalizer = new WeightNormalizer(this.geometry);
    weight_normalizer.normalize_weights(skin_weights);
    if (this.use_head_weight_correction) {
      const head_weight_corrector = new HeadWeightCorrector(
        this.geometry,
        this.bones_master_data,
        this.preview_plane_height
      );
      console.log("applying the head weight correction...");
      head_weight_corrector.apply_head_weight_correction(skin_indices, skin_weights);
    }
    console.log("do we have any leftover incorrect weights ", weight_normalizer.find_vertices_with_incorrect_weight_sum(skin_weights));
    return [skin_indices, skin_weights];
  }
}
export {
  SkinningAlgorithm as default
};

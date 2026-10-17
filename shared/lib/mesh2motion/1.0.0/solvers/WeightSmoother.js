// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
import { BoneClassifier } from "./BoneClassifier.js";
class WeightSmoother {
  geometry;
  bones;
  classifier;
  constructor(geometry, bones) {
    this.geometry = geometry;
    this.bones = bones;
    this.classifier = new BoneClassifier(bones);
  }
  geometry_vertex_count() {
    return this.geometry.attributes.position.array.length / 3;
  }
  /**
   * Smooths skin weights at bone boundaries with category-aware behavior.
   * - Torso boundaries get multi-ring gradient smoothing (3 rings, tapering weights)
   * - Limb boundaries get directional child-only smoothing
   * - Other boundaries get standard single-ring 50/50 blending
   */
  smooth_bone_weight_boundaries(skin_indices, skin_weights) {
    const adjacency = this.build_vertex_adjacency();
    const position_to_indices = this.build_position_map();
    const boundary_pairs = this.find_boundary_pairs(skin_indices, skin_weights, adjacency);
    this.apply_torso_smoothing(skin_indices, skin_weights, adjacency, position_to_indices, boundary_pairs);
    this.apply_limb_smoothing(skin_indices, skin_weights, position_to_indices, boundary_pairs);
    this.apply_standard_smoothing(skin_indices, skin_weights, position_to_indices, boundary_pairs);
    this.apply_extremity_smoothing(boundary_pairs);
  }
  /**
   * A boundary pair tracks two adjacent vertices assigned to different bones.
   */
  find_boundary_pairs(skin_indices, skin_weights, adjacency) {
    const vertex_count = this.geometry_vertex_count();
    const visited = /* @__PURE__ */ new Set();
    const pairs = [];
    for (let i = 0; i < vertex_count; i++) {
      const offset_a = i * 4;
      const bone_a = skin_indices[offset_a];
      const weight_a = skin_weights[offset_a];
      if (weight_a !== 1) continue;
      for (const j of adjacency[i]) {
        const offset_b = j * 4;
        const bone_b = skin_indices[offset_b];
        const weight_b = skin_weights[offset_b];
        if (bone_a === bone_b || weight_b !== 1) continue;
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (visited.has(key)) continue;
        visited.add(key);
        let smoothing_type = "standard" /* Standard */;
        if (this.classifier.is_torso_boundary(bone_a, bone_b)) {
          smoothing_type = "torso" /* Torso */;
        } else if (this.classifier.is_limb_boundary(bone_a, bone_b)) {
          smoothing_type = "limb" /* Limb */;
        } else if (this.classifier.is_extremity_boundary(bone_a, bone_b)) {
          smoothing_type = "extremity" /* Extremity */;
        }
        pairs.push({ vertex_a: i, vertex_b: j, bone_a, bone_b, smoothing_type });
      }
    }
    return pairs;
  }
  /**
   * Torso smoothing: expands the blend region outward from the boundary
   * by multiple rings, applying tapering weight gradients.
   * This creates a wider, more natural transition for voluminous areas.
   */
  apply_torso_smoothing(skin_indices, skin_weights, adjacency, position_to_indices, pairs) {
    const torso_pairs = pairs.filter((p) => p.smoothing_type === "torso" /* Torso */);
    if (torso_pairs.length === 0) return;
    const boundary_vertices = /* @__PURE__ */ new Set();
    for (const pair of torso_pairs) {
      boundary_vertices.add(pair.vertex_a);
      boundary_vertices.add(pair.vertex_b);
    }
    const ring_weights = [0.5, 0.25, 0.1];
    const processed = /* @__PURE__ */ new Set();
    let current_ring_vertices = /* @__PURE__ */ new Set();
    for (const pair of torso_pairs) {
      this.blend_vertex_pair(
        skin_indices,
        skin_weights,
        position_to_indices,
        pair.vertex_a,
        pair.vertex_b,
        pair.bone_a,
        pair.bone_b,
        ring_weights[0]
      );
      processed.add(pair.vertex_a);
      processed.add(pair.vertex_b);
      current_ring_vertices.add(pair.vertex_a);
      current_ring_vertices.add(pair.vertex_b);
    }
    for (let ring = 1; ring < ring_weights.length; ring++) {
      const next_ring_vertices = /* @__PURE__ */ new Set();
      const secondary_weight = ring_weights[ring];
      for (const vertex_idx of current_ring_vertices) {
        const offset = vertex_idx * 4;
        const primary_bone = skin_indices[offset];
        for (const neighbor of adjacency[vertex_idx]) {
          if (processed.has(neighbor)) continue;
          const neighbor_offset = neighbor * 4;
          const neighbor_bone = skin_indices[neighbor_offset];
          if (neighbor_bone !== primary_bone) continue;
          if (skin_weights[neighbor_offset] !== 1) continue;
          const other_bone = this.find_neighbor_bone_from_boundary(vertex_idx, skin_indices, primary_bone);
          if (other_bone === -1) continue;
          const shared = this.get_shared_vertices(neighbor, position_to_indices);
          for (const idx of shared) {
            const off = idx * 4;
            skin_indices[off + 0] = neighbor_bone;
            skin_indices[off + 1] = other_bone;
            skin_weights[off + 0] = 1 - secondary_weight;
            skin_weights[off + 1] = secondary_weight;
            skin_indices[off + 2] = 0;
            skin_indices[off + 3] = 0;
            skin_weights[off + 2] = 0;
            skin_weights[off + 3] = 0;
          }
          processed.add(neighbor);
          next_ring_vertices.add(neighbor);
        }
      }
      current_ring_vertices = next_ring_vertices;
    }
  }
  /**
   * Limb smoothing: only blends in the direction of the child bone.
   * When bone A is the parent of bone B, only vertices on the B side
   * get blended. This prevents elbow movement from deforming the bicep.
   */
  apply_limb_smoothing(skin_indices, skin_weights, position_to_indices, pairs) {
    const limb_pairs = pairs.filter((p) => p.smoothing_type === "limb" /* Limb */);
    for (const pair of limb_pairs) {
      const a_is_parent = this.is_parent_of(pair.bone_a, pair.bone_b);
      const b_is_parent = this.is_parent_of(pair.bone_b, pair.bone_a);
      if (a_is_parent) {
        this.blend_single_side(
          skin_indices,
          skin_weights,
          position_to_indices,
          pair.vertex_b,
          pair.bone_b,
          pair.bone_a,
          0.5
        );
      } else if (b_is_parent) {
        this.blend_single_side(
          skin_indices,
          skin_weights,
          position_to_indices,
          pair.vertex_a,
          pair.bone_a,
          pair.bone_b,
          0.5
        );
      } else {
        this.blend_vertex_pair(
          skin_indices,
          skin_weights,
          position_to_indices,
          pair.vertex_a,
          pair.vertex_b,
          pair.bone_a,
          pair.bone_b,
          0.5
        );
      }
    }
  }
  /**
   * Extremity smoothing: intentionally does nothing. Hands, fingers, feet, and
   * toes stay 100% rigid to their assigned bone — any blend smears across the
   * small part and looks mushy. Kept as an explicit pass so the intent is clear
   * and so these boundaries aren't accidentally handled elsewhere.
   */
  apply_extremity_smoothing(pairs) {
    void pairs;
  }
  /**
   * Standard smoothing: simple 50/50 blend at boundaries (original behavior).
   */
  apply_standard_smoothing(skin_indices, skin_weights, position_to_indices, pairs) {
    const standard_pairs = pairs.filter((p) => p.smoothing_type === "standard" /* Standard */);
    for (const pair of standard_pairs) {
      this.blend_vertex_pair(
        skin_indices,
        skin_weights,
        position_to_indices,
        pair.vertex_a,
        pair.vertex_b,
        pair.bone_a,
        pair.bone_b,
        0.5
      );
    }
  }
  /**
   * Blends both vertices of a boundary pair symmetrically.
   * secondary_weight is how much influence the "other" bone gets (e.g., 0.5 = 50/50).
   */
  blend_vertex_pair(skin_indices, skin_weights, position_to_indices, vertex_a, vertex_b, bone_a, bone_b, secondary_weight) {
    const primary_weight = 1 - secondary_weight;
    const shared_a = this.get_shared_vertices(vertex_a, position_to_indices);
    for (const idx of shared_a) {
      const off = idx * 4;
      skin_indices[off + 0] = bone_a;
      skin_indices[off + 1] = bone_b;
      skin_weights[off + 0] = primary_weight;
      skin_weights[off + 1] = secondary_weight;
      skin_indices[off + 2] = 0;
      skin_indices[off + 3] = 0;
      skin_weights[off + 2] = 0;
      skin_weights[off + 3] = 0;
    }
    const shared_b = this.get_shared_vertices(vertex_b, position_to_indices);
    for (const idx of shared_b) {
      const off = idx * 4;
      skin_indices[off + 0] = bone_b;
      skin_indices[off + 1] = bone_a;
      skin_weights[off + 0] = primary_weight;
      skin_weights[off + 1] = secondary_weight;
      skin_indices[off + 2] = 0;
      skin_indices[off + 3] = 0;
      skin_weights[off + 2] = 0;
      skin_weights[off + 3] = 0;
    }
  }
  /**
   * Blends only one side of a boundary — used for directional limb smoothing.
   * The vertex gets a blend, but its counterpart on the other side stays rigid.
   */
  blend_single_side(skin_indices, skin_weights, position_to_indices, vertex, primary_bone, secondary_bone, secondary_weight) {
    const primary_weight = 1 - secondary_weight;
    const shared = this.get_shared_vertices(vertex, position_to_indices);
    for (const idx of shared) {
      const off = idx * 4;
      skin_indices[off + 0] = primary_bone;
      skin_indices[off + 1] = secondary_bone;
      skin_weights[off + 0] = primary_weight;
      skin_weights[off + 1] = secondary_weight;
      skin_indices[off + 2] = 0;
      skin_indices[off + 3] = 0;
      skin_weights[off + 2] = 0;
      skin_weights[off + 3] = 0;
    }
  }
  /**
   * Checks if bone at index_a is a direct parent of bone at index_b
   * by walking up the bone hierarchy.
   */
  is_parent_of(parent_index, child_index) {
    const parent_bone = this.bones[parent_index];
    const child_bone = this.bones[child_index];
    if (parent_bone === void 0 || child_bone === void 0) return false;
    return child_bone.parent === parent_bone;
  }
  /**
   * Finds the secondary bone index from a vertex that was already blended,
   * used when expanding torso rings outward.
   */
  find_neighbor_bone_from_boundary(vertex_idx, skin_indices, primary_bone) {
    const offset = vertex_idx * 4;
    const secondary_bone = skin_indices[offset + 1];
    if (secondary_bone !== primary_bone && secondary_bone !== 0) {
      return secondary_bone;
    }
    return -1;
  }
  get_shared_vertices(vertex, position_to_indices) {
    const pos = this.geometry.attributes.position;
    const x = pos.getX(vertex);
    const y = pos.getY(vertex);
    const z = pos.getZ(vertex);
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    return position_to_indices.get(key) || [vertex];
  }
  build_position_map() {
    const vertex_count = this.geometry_vertex_count();
    const position_to_indices = /* @__PURE__ */ new Map();
    for (let i = 0; i < vertex_count; i++) {
      const pos = this.geometry.attributes.position;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      if (!position_to_indices.has(key)) position_to_indices.set(key, []);
      position_to_indices.get(key).push(i);
    }
    return position_to_indices;
  }
  /**
   * Builds a spatial adjacency map for the mesh vertices using geometry's index (faces).
   * Returns an array of Sets, where each Set contains the indices of neighboring vertices.
   */
  build_vertex_adjacency() {
    const vertex_count = this.geometry_vertex_count();
    const adjacency = Array.from({ length: vertex_count }, () => /* @__PURE__ */ new Set());
    const index_attribute = this.geometry.index;
    if (index_attribute === null) return adjacency;
    const indices = index_attribute.array;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      adjacency[a].add(b);
      adjacency[a].add(c);
      adjacency[b].add(a);
      adjacency[b].add(c);
      adjacency[c].add(a);
      adjacency[c].add(b);
    }
    return adjacency;
  }
}
var SmoothingType = /* @__PURE__ */ ((SmoothingType2) => {
  SmoothingType2["Torso"] = "torso";
  SmoothingType2["Limb"] = "limb";
  SmoothingType2["Extremity"] = "extremity";
  SmoothingType2["Standard"] = "standard";
  return SmoothingType2;
})(SmoothingType || {});
export {
  WeightSmoother
};

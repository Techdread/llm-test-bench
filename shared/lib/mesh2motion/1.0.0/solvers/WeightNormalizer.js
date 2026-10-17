// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
class WeightNormalizer {
  geometry;
  constructor(geometry) {
    this.geometry = geometry;
  }
  geometry_vertex_count() {
    return this.geometry.attributes.position.array.length / 3;
  }
  /**
   * Returns an array of vertex indices whose weights do not sum to 1.0 (within a small epsilon).
   */
  find_vertices_with_incorrect_weight_sum(skin_weights) {
    const epsilon = 1e-4;
    const incorrect_vertices = [];
    const vertex_count = this.geometry_vertex_count();
    for (let i = 0; i < vertex_count; i++) {
      const offset = i * 4;
      const sum = skin_weights[offset] + skin_weights[offset + 1] + skin_weights[offset + 2] + skin_weights[offset + 3];
      if (Math.abs(sum - 1) > epsilon) {
        incorrect_vertices.push(i);
      }
    }
    return incorrect_vertices;
  }
  /**
   * Normalizes weights for vertices that don't sum to 1.0.
   * Distributes the remaining weight across non-zero influence slots.
   */
  normalize_weights(all_skin_weights) {
    const vertices_that_do_not_have_influences_adding_to_one = this.find_vertices_with_incorrect_weight_sum(all_skin_weights);
    for (const vertex_index of vertices_that_do_not_have_influences_adding_to_one) {
      const offset = vertex_index * 4;
      const weights = [
        all_skin_weights[offset],
        all_skin_weights[offset + 1],
        all_skin_weights[offset + 2],
        all_skin_weights[offset + 3]
      ];
      const weight_sum = weights.reduce((a, b) => a + b, 0);
      const weight_per_index = (1 - weight_sum) / 3;
      console.log(weight_per_index);
      for (let i = 0; i < 4; i++) {
        if (weights[i] !== 0) {
          all_skin_weights[offset + i] += weight_per_index;
        }
      }
    }
  }
}
export {
  WeightNormalizer
};

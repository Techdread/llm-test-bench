// Humanoid-only adapter for the Mesh2Motion solver's configuration lookup.
export class RigConfig {
  static by_skeleton_type(type) { return type === 'human' ? { position_tracking_bone_name: 'pelvis' } : undefined; }
}

// Adapted subset of Mesh2Motion Utilities, Scott Petrovic — MIT.
import { Vector3 } from '../../three/0.185.1/build/three.module.js';
export class Utility {
  static world_position_from_object(object) { return object.getWorldPosition(new Vector3()); }
  static direction_between_points(a, b) { return new Vector3().subVectors(b, a).normalize(); }
  static is_leaf_bone(bone) { return !bone.children.length && /leaf|tip/i.test(bone.name); }
  static bone_midpoint_to_child(bone) {
    const position = this.world_position_from_object(bone);
    return bone.children.length ? position.lerp(this.world_position_from_object(bone.children[0]), 0.5) : position;
  }
  static bone_list_from_hierarchy(root) { const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); }); return bones; }
}

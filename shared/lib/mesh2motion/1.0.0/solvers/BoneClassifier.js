// Mesh2Motion, Scott Petrovic — MIT. See LICENSE-MIT.MD and README.md.
var BoneCategory = /* @__PURE__ */ ((BoneCategory2) => {
  BoneCategory2["Torso"] = "torso";
  BoneCategory2["Limb"] = "limb";
  BoneCategory2["Extremity"] = "extremity";
  BoneCategory2["Root"] = "root";
  BoneCategory2["Other"] = "other";
  return BoneCategory2;
})(BoneCategory || {});
class BoneClassifier {
  bone_categories = /* @__PURE__ */ new Map();
  constructor(bones) {
    this.classify_all_bones(bones);
  }
  get_category(bone_index) {
    return this.bone_categories.get(bone_index) ?? "other" /* Other */;
  }
  /**
   * Returns true if the bone pair represents a parent-child relationship
   * where smoothing should only flow toward the child direction.
   * This prevents elbow movement from deforming the bicep.
   */
  is_limb_boundary(bone_index_a, bone_index_b) {
    const cat_a = this.get_category(bone_index_a);
    const cat_b = this.get_category(bone_index_b);
    return cat_a === "limb" /* Limb */ || cat_b === "limb" /* Limb */;
  }
  /**
   * Returns true if the boundary is between two extremity bones
   * (hand↔finger, finger↔finger, foot↔toe). These get no smoothing so
   * small parts like fingers stay rigid instead of turning mushy.
   * Requires both sides to be extremities, so the wrist/ankle
   * (limb↔extremity) is not caught here and keeps its limb smoothing.
   */
  is_extremity_boundary(bone_index_a, bone_index_b) {
    return this.get_category(bone_index_a) === "extremity" /* Extremity */ && this.get_category(bone_index_b) === "extremity" /* Extremity */;
  }
  /**
   * Returns true if the boundary between two bones should get
   * wider multi-ring smoothing (torso regions).
   */
  is_torso_boundary(bone_index_a, bone_index_b) {
    const cat_a = this.get_category(bone_index_a);
    const cat_b = this.get_category(bone_index_b);
    return (cat_a === "torso" /* Torso */ || cat_b === "torso" /* Torso */) && cat_a !== "extremity" /* Extremity */ && cat_b !== "extremity" /* Extremity */;
  }
  classify_all_bones(bones) {
    bones.forEach((bone, idx) => {
      const category = this.classify_bone(bone);
      this.bone_categories.set(idx, category);
    });
  }
  classify_bone(bone) {
    const name = bone.name.toLowerCase();
    const extremity_keywords = [
      "hand",
      "foot",
      "feet",
      "toe",
      "ball",
      "thumb",
      "index",
      "middle",
      "ring",
      "pinky",
      "finger",
      "teeth",
      "eye",
      "tongue",
      "wing",
      "feather",
      "leaf",
      "ear",
      "horn"
    ];
    if (extremity_keywords.some((kw) => name.includes(kw))) {
      return "extremity" /* Extremity */;
    }
    const limb_keywords = [
      "arm",
      "upperarm",
      "lowerarm",
      "forearm",
      "elbow",
      "wrist",
      "nose",
      "shoulder",
      "clavicle",
      "ankle",
      "fin",
      "head",
      "chin",
      "jaw",
      "mouth",
      "thigh",
      "calf",
      "shin",
      "knee",
      "leg",
      "upleg",
      "lowleg",
      "neck",
      "humerus"
    ];
    if (limb_keywords.some((kw) => name.includes(kw))) {
      return "limb" /* Limb */;
    }
    const torso_keywords = [
      "spine",
      "chest",
      "hips",
      "pelvis",
      "torso",
      "abdomen",
      "body",
      "tail",
      "stomach",
      "collar",
      "scapula",
      "ribcage"
    ];
    if (torso_keywords.some((kw) => name.includes(kw))) {
      return "torso" /* Torso */;
    }
    const parent_bone = bone.parent;
    if (parent_bone?.isBone !== true) {
      return "root" /* Root */;
    }
    return "other" /* Other */;
  }
}
export {
  BoneCategory,
  BoneClassifier
};

// Character output targets and the model-facing T-pose contract.
//
// Free of any three import so prompts.js — and `node --test` — can reach the
// guide text without pulling in a geometry library. The half that moves actual
// meshes lives in rigging.js.

export const RIGGING_TARGETS = Object.freeze([
  { id: 'none', label: 'Static sculpt', hint: 'Follows the pose in your reference.' },
  { id: 'mixamo', label: 'T-pose · unrigged', hint: 'A neutral humanoid mesh prepared for auto-rigging in Mixamo.' },
  { id: 'animated', label: 'Animated humanoid · Mesh2Motion', hint: 'T-pose plus a locally fitted skeleton, skin weights and 87 clips.' },
]);

/** A generation target, not a claim that a mesh has a skeleton or passed Mixamo. */
export function riggingTarget(value = 'none', kind = 'character') {
  if (!RIGGING_TARGETS.some(target => target.id === value)) throw new Error('Unknown rigging target.');
  if (value !== 'none' && kind !== 'character') throw new Error('Rigging preparation requires a character subject.');
  return value;
}

export const MIXAMO_GUIDE = `Rigging target: Mixamo (unrigged bipedal humanoid).
Build a single character in a symmetric neutral T-pose: upright torso, arms straight out horizontally at shoulder height, elbows extended, palms down, legs straight with a clear gap between them, feet planted. Y is up and +Z is forward.
Preserve the reference character's identity, materials and proportions where compatible, but the T-pose takes priority over the reference pose and any conflicting pose instructions. When refining existing code, reposition the limbs and their attached details together; do not replace the character with a generic mannequin.
Make the head, neck, torso, pelvis, two arms, two hands, two legs and two feet distinguishable and physically connected without gaps at the joints. Keep hands clear of the torso. Use clean surfaces and smoothly connected joint areas, not floating primitives. Keep all major anatomy at every LOD.
Use exactly one named object containing the whole character. No floor, pedestal, scenery, held props, extra limbs, wings, tails, or large loose hair/clothing/accessories that obscure the body. Simplify obstructing decoration and explain what changed in the summary. Center the character over the origin with feet at y=0. Do not add a skeleton or claim the result is rigged.
For visual review, explicitly inspect the T-pose, arm/leg separation, connected neck/shoulders/elbows/wrists/hips/knees/ankles, and absence of extra scene content in the FRONT, SIDE and BACK images. Reject a posed, disconnected or obscured humanoid even if it resembles the reference. Report unresolved rigging obstacles as actionable issues. Visual approval is not a guarantee of acceptance by Mixamo.`;

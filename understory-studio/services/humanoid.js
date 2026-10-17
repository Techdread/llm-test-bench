// Joint validation and the model-facing rigging contract.
//
// The division of labour matters and is deliberate: the model supplies 18 joint
// POSITIONS derived from the same variables that built its geometry, and
// nothing else. It does not invent skin weights, bone hierarchies or clips —
// the trusted path supplies all three. Asking a model for weights produces
// plausible-looking nonsense; asking it where the elbow is works, because it
// just placed the elbow.

export const JOINT_NAMES = [
  'pelvis', 'chest', 'neck', 'head',
  ...['left', 'right'].flatMap(side => ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle', 'Toe'].map(joint => side + joint)),
];

/**
 * Reject a rig that cannot describe a standing humanoid before anything is
 * fitted. Every message is written to be handed back to the model as feedback.
 */
export function validateHumanoid(value) {
  if (!value || value.type !== 'humanoid' || !value.joints || typeof value.joints !== 'object' || Array.isArray(value.joints)) {
    throw new Error('Animation needs a humanoid rig with joint positions.');
  }
  const joints = value.joints;
  if (Object.keys(joints).length !== JOINT_NAMES.length) {
    throw new Error(`Provide exactly these joints: ${JOINT_NAMES.join(', ')}.`);
  }
  for (const name of JOINT_NAMES) {
    const point = joints[name];
    if (!Array.isArray(point) || point.length !== 3 || !point.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000)) {
      throw new Error(`Invalid ${name} joint. Use three finite model-space coordinates.`);
    }
  }

  const height = joints.head[1] - Math.min(joints.leftAnkle[1], joints.rightAnkle[1]);
  if (height < 0.1 || !(joints.head[1] > joints.neck[1] && joints.neck[1] > joints.chest[1] && joints.chest[1] > joints.pelvis[1])) {
    throw new Error('Humanoid head, neck, chest and pelvis must be ordered vertically.');
  }

  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const [shoulder, elbow, wrist, hip, knee, ankle, toe] =
      ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle', 'Toe'].map(key => joints[side + key]);

    if (!(hip[1] > knee[1] && knee[1] > ankle[1] && sign * (hip[0] - joints.pelvis[0]) > 0)) {
      throw new Error(`Fix the ${side} hip, knee and ankle ordering.`);
    }
    // A T-pose arm runs outward and stays level; a model that hands back a
    // resting arm would fit a skeleton that then animates through the torso.
    if (!(sign * (shoulder[0] - joints.chest[0]) > 0 && sign * (elbow[0] - shoulder[0]) > 0 && sign * (wrist[0] - elbow[0]) > 0)
      || Math.abs(shoulder[1] - wrist[1]) > height * 0.2) {
      throw new Error(`Place the ${side} arm joints in a T-pose. Anatomical left is +X.`);
    }
    for (const [a, b] of [[shoulder, elbow], [elbow, wrist], [hip, knee], [knee, ankle], [ankle, toe]]) {
      if (Math.hypot(...a.map((n, i) => n - b[i])) < height * 0.005) {
        throw new Error(`The ${side} limb contains a zero-length or tiny bone.`);
      }
    }
  }
  return value;
}

export const HUMANOID_GUIDE = `Local animation target: a humanoid in a neutral T-pose, rigged by Mesh2Motion after generation.
Follow the T-pose geometry requirements above. Additionally return rig:{type:"humanoid",joints:{...}} in the design JSON alongside name, materials and objects.
Required joint keys: ${JOINT_NAMES.join(', ')}. Each joint is [x,y,z] in the SAME final model coordinates as the geometry, before viewer centering. Anatomical left is +X, right is -X; Y is up; face +Z. Do not use normalized or screen coordinates.
pelvis is the center of the hip rotation, chest is the upper torso, neck is the base of the neck, head is the base of the skull above neck. Shoulder is the upper-arm pivot; Elbow and Wrist are their joint pivots. Hip is the thigh pivot, Knee the knee pivot, Ankle the ankle pivot and Toe the ball of the foot towards +Z. Place these INSIDE the matching body parts. Derive joints from the same variables used to construct limbs. The trusted application supplies bone hierarchy, weights and clips. Hands are animated as whole hands; individual fingers are not rigged in this version.
Do not change a character's identity just to make rigging easier. Keep decorations attached to the body and avoid long ornaments bridging joints. If repairing movement, correct joint locations or local geometry; do not remove limbs.
For visual review, inspect the neutral character AND the three movement-test images (walk, crouch and raised arm). Reject detached anatomy, severe stretching, inverted joints and unrelated body regions moving together. Approval requires both recognizable geometry and coherent movement. Explain remaining problems specifically.`;

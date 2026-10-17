// Shared centering for a prepared character. The targets themselves, and the
// prompt text that describes them, live in riggingTargets.js.

import { Box3, Vector3 } from 'three';

export { MIXAMO_GUIDE, RIGGING_TARGETS, riggingTarget } from './riggingTargets.js';

/**
 * Centre X/Z and drop the feet to y=0 for every level at once.
 *
 * The offset is computed from Master and applied to all five. Deriving it per
 * level would shift a level whose bounds changed because a small detail
 * retired — the character would drift between LODs.
 */
export function centerRiggingModels(models, target = 'mixamo') {
  const master = models.get('master');
  if (!master) throw new Error('Rigging preparation needs a Master level.');
  const bounds = new Box3().setFromObject(master);
  const center = bounds.getCenter(new Vector3());
  const offset = new Vector3(-center.x, -bounds.min.y, -center.z);
  for (const model of models.values()) {
    model.position.add(offset);
    model.userData.riggingTarget = target;
    model.updateMatrixWorld(true);
  }
  return offset;
}

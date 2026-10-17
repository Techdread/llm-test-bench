// Promoted to shared/forge/services/previewAdapters.js (spec 305 / 328 kernel
// slice). Game Forge V2's manifest kind stays "game", so the shim binds that
// default rather than the shared one.
import {
  readProjectManifest as sharedReadProjectManifest,
  buildProjectPreview as sharedBuildProjectPreview,
} from '../../shared/forge/services/previewAdapters.js';

export {
  PREVIEW_ADAPTERS,
  inferPreviewRuntime,
  normalizeProjectManifest,
  validateProjectManifest,
} from '../../shared/forge/services/previewAdapters.js';

export function readProjectManifest(projectHandle, options = {}) {
  return sharedReadProjectManifest(projectHandle, { defaultKind: 'game', ...options });
}

export function buildProjectPreview(projectHandle, options = {}) {
  return sharedBuildProjectPreview(projectHandle, { defaultKind: 'game', ...options });
}

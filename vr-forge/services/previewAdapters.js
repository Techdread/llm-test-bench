// Thin binding over shared/forge/services/previewAdapters.js.
//
// A VR manifest carries two fields the shared normalizer knows nothing about —
// the `xr` session contract and the desktop `fallback` — so they are passed
// through the `extend` hook rather than by forking the module.
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

/** The VR half of forge-project.json, normalized but never invented. */
export function vrManifestExtend(value = {}) {
  const xr = value && typeof value.xr === 'object' && !Array.isArray(value.xr) ? value.xr : null;
  const fallback = value && typeof value.fallback === 'object' && !Array.isArray(value.fallback)
    ? value.fallback : null;
  return {
    xr: xr ? {
      modes: [].concat(xr.modes || []).map(String),
      requiredFeatures: Array.isArray(xr.requiredFeatures) ? xr.requiredFeatures.map(String) : [],
      optionalFeatures: Array.isArray(xr.optionalFeatures) ? xr.optionalFeatures.map(String) : [],
      inputs: xr.inputs && typeof xr.inputs === 'object' ? { ...xr.inputs } : {},
      locomotion: xr.locomotion == null ? null : String(xr.locomotion),
      targetFps: xr.targetFps == null ? null : Number(xr.targetFps),
      entryControl: xr.entryControl == null ? '' : String(xr.entryControl),
    } : null,
    fallback: fallback ? {
      kind: String(fallback.kind || 'desktop'),
      description: String(fallback.description || ''),
    } : null,
  };
}

export function readProjectManifest(projectHandle, options = {}) {
  return sharedReadProjectManifest(projectHandle, {
    defaultKind: 'vr', manifestExtend: vrManifestExtend, ...options,
  });
}

export function buildProjectPreview(projectHandle, options = {}) {
  return sharedBuildProjectPreview(projectHandle, {
    defaultKind: 'vr', manifestExtend: vrManifestExtend, ...options,
  });
}

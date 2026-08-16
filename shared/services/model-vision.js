// Vision-capability detection for models returned by
// model-providers.js `fetchEnabledModels`.
//
// Providers advertise image support differently:
//  - OpenRouter: model.raw.architecture.input_modalities includes "image".
//  - LM Studio:  the OpenAI-compat /v1/models does NOT advertise modality;
//    /api/v0/models does, as `type: "vlm"` (vs "llm"/"embeddings"). The
//    LM Studio adapter best-effort merges that onto model.raw.type.
//
// Detection is deliberately three-valued so callers can distinguish
// "definitely can't" from "we just don't know":
//   true  = vision-capable
//   false = definitely not (hide / block)
//   null  = unknown (allow, but warn "attempted anyway")

export function modelSupportsVision(model) {
  if (!model) return null;

  // OpenRouter (and any OpenAI-style catalogue that exposes modalities)
  const mods = model.raw?.architecture?.input_modalities
    || model.raw?.architecture?.modality
    || model.inputModalities;
  if (Array.isArray(mods)) return mods.includes('image');
  if (typeof mods === 'string') return /image|vision/i.test(mods);

  // LM Studio: type discriminator from /api/v0/models
  const t = String(
    model.modelType || model.type || model.raw?.type || ''
  ).toLowerCase();
  if (t === 'vlm') return true;
  if (t === 'llm' || t === 'embeddings' || t === 'embedding') return false;

  return null; // unknown
}

// Keep everything that isn't *definitely* text-only. Unknown models (e.g. most
// LM Studio entries) stay in — the caller warns rather than hides.
export function filterVisionModels(models) {
  return (models || []).filter(m => modelSupportsVision(m) !== false);
}

// Convenience for a picker that wants to visibly mark, not remove.
export function visionLabel(model) {
  const v = modelSupportsVision(model);
  if (v === true) return 'vision';
  if (v === false) return 'text-only';
  return 'vision?';
}

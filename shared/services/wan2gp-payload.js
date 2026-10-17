// Pure payload + capability helpers for the Wan2GP v0.6 agent API.
//
// Zero imports, zero browser globals: everything here is a function of its
// arguments so the whole payload vocabulary is testable under node:test.
// The network side lives in `wan2gp-capabilities.js`; the app-facing services
// live in `media.js`.
//
// The node derives per-model metadata from WanGP's own `models/model_metadata.py`
// and returns it two ways: flat on `/api/models` rows, nested under
// `api_metadata` on `/api/models/{model_type}`. `getApiMetadata` flattens both.

// ── Metadata normalization ──

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalize a model row or model detail into one metadata shape.
 * Accepts the flat `/api/models` form and the nested `api_metadata` form.
 */
export function getApiMetadata(model) {
  const nested = asObject(model?.api_metadata);
  return {
    main_outputs: nested.main_outputs || model?.main_outputs || [],
    outputs: nested.outputs || model?.outputs || [],
    inputs: nested.inputs || model?.inputs || [],
    media_inputs: nested.media_inputs || model?.media_inputs || {},
    capabilities: nested.capabilities || model?.capabilities || {},
    setting_values: nested.setting_values || model?.setting_values || {},
    config_label: nested.config_label || model?.config_label || 'Config',
    config_choices: nested.config_choices || model?.config_choices || [],
  };
}

/**
 * True when a model row carries v0.6 capability metadata. Rows from an older
 * node parse fine but come back with every list empty — callers must treat
 * that as "unknown", never as "supports nothing".
 */
export function hasCapabilityMetadata(model) {
  const meta = getApiMetadata(model);
  return (
    asArray(meta.inputs).length > 0 ||
    asArray(meta.outputs).length > 0 ||
    Object.keys(asObject(meta.capabilities)).length > 0
  );
}

export function mediaInputsOf(model) {
  const media = asObject(getApiMetadata(model).media_inputs);
  return {
    image: asObject(media.image),
    video: asObject(media.video),
    audio: asObject(media.audio),
  };
}

export function capabilitiesOf(model) {
  return asObject(getApiMetadata(model).capabilities);
}

/** Does `model` report `capability`? Unknown metadata answers `false`. */
export function supportsCapability(model, capability) {
  if (!capability) return true;
  return Boolean(capabilitiesOf(model)[capability]);
}

/**
 * Compare dotted version strings. Returns -1 / 0 / 1.
 * Missing or unparseable segments count as 0, so "0.6" === "0.6.0".
 */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.');
  const pb = String(b || '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = parseInt(pa[i], 10) || 0;
    const nb = parseInt(pb[i], 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** Capability metadata and `/api/uploads` both landed in agent API 0.6.0. */
export const CAPABILITY_API_VERSION = '0.6.0';

export function nodeSupportsCapabilities(health) {
  const version = typeof health === 'string' ? health : health?.version;
  if (!version) return false;
  return compareVersions(version, CAPABILITY_API_VERSION) >= 0;
}

// ── Client-side filtering (mirrors the node's own query parameters) ──

function listContains(list, wanted) {
  const values = asArray(list).map((v) => String(v));
  return splitFilter(wanted).every((needle) => values.includes(needle));
}

function splitFilter(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Filter the catalogue by capability need.
 *
 * Deliberately NOT the same as the node's `/api/models?...` query parameters,
 * which were measured against the live 3090 and differ in two ways:
 *
 *   - the node's `capability=` filters the COARSE capability string
 *     (`image-generation` / `video-generation` / `audio-generation`), not the
 *     fine-grained `capabilities` map. `?capability=reference_images` returns
 *     zero rows there. Here `capability` means the fine-grained map, which is
 *     what an app actually wants to ask for.
 *   - the node's `input`/`output` filters are an ANY-of intersection. Here a
 *     comma-separated list means ALL of them must be present, so a need reads
 *     as a conjunction throughout.
 *
 * Because of that, filtering happens client-side against the cached catalogue
 * (see `wan2gp-capabilities.js`) rather than being pushed to the node.
 *
 * A model without capability metadata never matches — the caller decides what
 * to do about that, and must not read it as "supports nothing".
 */
export function modelMatchesNeed(model, need = {}) {
  const { input, output, capability, family } = need;
  if (family && !splitFilter(family).includes(String(model?.family || ''))) return false;
  if (!hasCapabilityMetadata(model)) return false;
  const meta = getApiMetadata(model);
  if (input && !listContains(meta.inputs, input)) return false;
  if (output && !listContains(meta.outputs, output)) return false;
  for (const cap of splitFilter(capability)) {
    if (!asObject(meta.capabilities)[cap]) return false;
  }
  return true;
}

// ── Flag vocabulary ──

/** Merge WanGP prompt-type letters without duplicating or reordering. */
export function mergeFlags(currentValue, additions) {
  let result = String(currentValue || '');
  for (const flag of String(additions || '')) {
    if (!result.includes(flag)) result += flag;
  }
  return result;
}

/**
 * A model may force letters onto `video_prompt_type` (`set_video_prompt_type`).
 * Forced flags merge into whatever the caller asked for — they never replace it.
 */
export function applyForcedFlags(payload, metadata) {
  const forced = asObject(asObject(metadata?.setting_values).video_prompt_type).forced;
  if (forced) payload.video_prompt_type = mergeFlags(payload.video_prompt_type, forced);
  return payload;
}

function defaultChoiceValue(definition) {
  const def = asObject(definition);
  if (def.default !== undefined && def.default !== null) return def.default;
  const [first] = asArray(def.choices);
  if (first && typeof first === 'object') return first.value;
  return undefined;
}

/**
 * The inpainting method a model wants on `model_mode`. Read from the model's
 * own `setting_values.model_mode` — the values differ per family and change
 * upstream, so nothing here is hardcoded.
 */
export function defaultModelMode(metadata) {
  return defaultChoiceValue(asObject(metadata?.setting_values).model_mode);
}

/**
 * The `image_ref_choices` default a model wants when references are supplied.
 * Krea2 defaults to `KI` (first reference is the subject/landscape); H3 Ref2VA
 * defaults to `I`.
 */
export function defaultReferenceFlags(metadata, { backgroundFirst } = {}) {
  const def = asObject(asObject(metadata?.setting_values).video_prompt_type).image_ref_choices;
  const preferred = defaultChoiceValue(def);
  if (backgroundFirst === true) return 'KI';
  if (backgroundFirst === false) return 'I';
  return preferred || 'I';
}

/**
 * The step count a model ships with — from the detail endpoint's `defaults`,
 * or the list row's `default_steps`. Null when the node does not say.
 *
 * This, not a fixed number, is the yardstick for a "too few steps" warning.
 * MiniMax H3 defaults to 20 because it has no steps-distilled checkpoint, while
 * `joyai_echo_surgical` and `ltx2_22B_msr_v2` are distilled and default to 8 —
 * a hardcoded floor would nag on exactly the models where 8 is correct.
 */
export function modelDefaultSteps(model) {
  const fromDefaults = Number(asObject(model?.defaults).num_inference_steps);
  if (Number.isFinite(fromDefaults) && fromDefaults > 0) return fromDefaults;
  const fromRow = Number(model?.default_steps);
  if (Number.isFinite(fromRow) && fromRow > 0) return fromRow;
  return null;
}

// ── Reference limits ──

/**
 * Per-model reference budget. `media_inputs` says *whether* references are
 * accepted; the count ceilings are model-family facts the API does not carry,
 * so they live here in one place with the family that owns them.
 */
/**
 * The reference limits the NODE actually enforces, as opposed to the advisory
 * family numbers in `referenceLimitsFor`.
 *
 * `wgp.py`'s `validate_settings` caps `image_refs` only through
 * `one_image_ref_needed` / `one_image_ref_only`, and Krea2 declares neither —
 * so a three-reference Krea2 edit is accepted by the node even though two is
 * the quality guidance. The only API-visible hard fact is
 * `media_inputs.image.multiple_references`.
 *
 * Refusing an over-guidance request outright was wrong: it made a legal
 * generation impossible. Guidance now belongs to the UI, and only genuine
 * constraints throw.
 */
/**
 * How many reference slots the PAYLOAD has, regardless of model.
 * `video_guide` + `video_guide2`, and `audio_guide` + `audio_guide2`.
 */
export const VIDEO_REF_SLOTS = 2;
export const AUDIO_REF_SLOTS = 2;

export function referenceHardLimits(model) {
  const media = mediaInputsOf(model);
  const hasRefs = Boolean(media.image.reference);
  return {
    images: hasRefs ? (media.image.multiple_references === false ? 1 : Infinity) : 0,
    videos: media.video.control ? Infinity : 0,
    audios: media.audio.prompt ? Infinity : 0,
  };
}

/**
 * Advisory per-family reference budgets, for UI guidance.
 *
 * These are quality/《documented》 numbers, not validation rules — see
 * `referenceHardLimits` for what the node will actually refuse.
 */
export function referenceLimitsFor(modelType, model) {
  const media = mediaInputsOf(model);
  const type = String(modelType || '');
  const supported = Boolean(media.image.reference);
  let images = supported ? (media.image.multiple_references === false ? 1 : 2) : 0;
  let videos = media.video.control ? 1 : 0;
  let audios = media.audio.prompt ? 1 : 0;

  if (type.startsWith('minimax_h3_ref2va')) {
    images = 9;
    videos = 2;
    audios = 2;
  } else if (type.startsWith('ltx2_') && type.includes('msr')) {
    images = 5;
  }
  return { images, videos, audios };
}

// ── Shared payload scaffolding ──

function requirePrompt(prompt, who) {
  const clean = String(prompt || '').trim();
  if (!clean) throw new Error(`${who}: prompt is required`);
  return clean;
}

function pathOf(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : String(value.path || '');
}

function pathList(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(pathOf).filter(Boolean);
}

function applyCommon(payload, opts) {
  const {
    seed = -1,
    numInferenceSteps,
    negativePrompt,
    resolution,
    videoLength,
    guidanceScale,
    flowShift,
    config,
    extra,
  } = opts;
  payload.seed = Number.isFinite(seed) ? seed : -1;
  if (resolution) payload.resolution = String(resolution);
  if (Number.isFinite(numInferenceSteps) && numInferenceSteps > 0) {
    payload.num_inference_steps = numInferenceSteps;
  }
  if (Number.isFinite(videoLength) && videoLength > 0) payload.video_length = videoLength;
  if (Number.isFinite(guidanceScale)) payload.guidance_scale = guidanceScale;
  if (Number.isFinite(flowShift)) payload.flow_shift = flowShift;
  if (negativePrompt && String(negativePrompt).trim()) {
    payload.negative_prompt = String(negativePrompt).trim();
  }
  if (config) payload.config = String(config);
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(payload, extra);
  return payload;
}

/**
 * Outpainting margins, as WanGP wants them: percentages of the source frame in
 * `"top bottom left right"` order. `"#"` disables. Returns null when every
 * margin is zero, so callers can leave the field off entirely.
 */
export function outpaintingString(outpaint) {
  if (!outpaint) return null;
  if (typeof outpaint === 'string') return outpaint.trim() || null;
  const { top = 0, bottom = 0, left = 0, right = 0 } = outpaint;
  const nums = [top, bottom, left, right].map((v) => Math.max(0, Math.round(Number(v) || 0)));
  if (nums.every((n) => n === 0)) return null;
  return nums.join(' ');
}

// ── Service payload builders ──
//
// Every builder takes already-resolved server-side paths. Uploading is the
// caller's job (see `resolveMediaInput` in media.js) so these stay pure.

/**
 * Image in, image out: references, inpainting mask, outpainting margins.
 * @param {object} opts
 * @param {string} opts.modelType
 * @param {object} [opts.model]        Model row or detail, for capability checks.
 * @param {string} opts.prompt
 * @param {Array}  [opts.references]   Reference images (paths).
 * @param {string} [opts.guide]        Control image, when the model takes one.
 * @param {string} [opts.mask]         Inpainting mask.
 * @param {object|string} [opts.outpaint]  `{top,bottom,left,right}` percentages.
 * @param {boolean} [opts.backgroundFirst] Force `KI` (first ref is background).
 * @param {number|string} [opts.modelMode] Override the model's inpaint method.
 */
/**
 * The letters a model wants for its control-image slot.
 *
 * Not always a bare `V`: `flux2_klein_9b` lists `PV` / `MV` in
 * `guide_preprocessing` and rejects `V` on its own. Read the model's own
 * choices and fall back to `V` only when it offers none.
 */
export function guideFlagsFor(metadata) {
  const def = asObject(asObject(metadata?.setting_values).video_prompt_type).guide_preprocessing;
  const choices = asArray(asObject(def).choices)
    .map((c) => (c && typeof c === 'object' ? String(c.value ?? '') : String(c ?? '')))
    .filter(Boolean);
  if (!choices.length) return 'V';
  // Prefer the plainest option that still selects the control image.
  return choices.find((c) => c === 'V') || choices.slice().sort((a, b) => a.length - b.length)[0];
}

/**
 * The letters a model wants for its mask slot, from `mask_preprocessing`.
 * `A` is "use the supplied mask"; models also offer `NA` (inverted).
 */
export function maskFlagsFor(metadata) {
  const def = asObject(asObject(metadata?.setting_values).video_prompt_type).mask_preprocessing;
  const choices = asArray(asObject(def).choices)
    .map((c) => (c && typeof c === 'object' ? String(c.value ?? '') : String(c ?? '')))
    .filter(Boolean);
  if (!choices.length) return 'A';
  return choices.includes('A') ? 'A' : choices[0];
}

export function buildImageEditPayload(opts = {}) {
  const {
    modelType, model, prompt, references, guide, mask, outpaint, backgroundFirst, modelMode,
    denoisingStrength,
  } = opts;
  if (!modelType) throw new Error('imageEdit: modelType is required');
  const metadata = getApiMetadata(model);
  const media = mediaInputsOf(model);
  const known = hasCapabilityMetadata(model);

  const refs = pathList(references);
  const guidePath = pathOf(guide);
  const maskPath = pathOf(mask);
  const margins = outpaintingString(outpaint);

  if (known) {
    if (refs.length && !media.image.reference) {
      throw new Error(`imageEdit: ${modelType} does not accept reference images`);
    }
    if (maskPath && !media.image.mask) {
      throw new Error(`imageEdit: ${modelType} does not support masking`);
    }
    if (guidePath && !media.image.control) {
      throw new Error(`imageEdit: ${modelType} does not accept a control image`);
    }
    if (margins && !capabilitiesOf(model).outpainting) {
      throw new Error(`imageEdit: ${modelType} does not support outpainting`);
    }
    // Only what the node actually refuses — the per-family numbers are
    // guidance for the UI, not a reason to make a legal request impossible.
    const hard = referenceHardLimits(model);
    if (refs.length > hard.images) {
      throw new Error(`imageEdit: ${modelType} accepts at most ${hard.images} reference image(s), got ${refs.length}`);
    }
  }
  if (!refs.length && !guidePath && !maskPath && !margins) {
    throw new Error('imageEdit: supply at least a reference image, control image, mask, or outpaint margins');
  }

  const payload = {
    model_type: modelType,
    prompt: requirePrompt(prompt, 'imageEdit'),
    image_mode: 1,
  };
  if (refs.length) {
    payload.image_refs = refs;
    payload.video_prompt_type = mergeFlags(
      payload.video_prompt_type,
      defaultReferenceFlags(metadata, { backgroundFirst }),
    );
  }
  if (guidePath) {
    payload.image_guide = guidePath;
    payload.video_prompt_type = mergeFlags(payload.video_prompt_type, guideFlagsFor(metadata));
  }
  if (maskPath) {
    payload.image_mask = maskPath;
    // `A` (or the model's equivalent) selects the supplied mask; `G` is what
    // unlocks `denoising_strength` and `masking_strength` — wgp.py forces
    // denoising to 1.0 without it, which means a full regeneration rather than
    // an edit. Both letters are required for masking to behave as an edit.
    payload.video_prompt_type = mergeFlags(payload.video_prompt_type, `${maskFlagsFor(metadata)}G`);
    const mode = modelMode !== undefined ? modelMode : defaultModelMode(metadata);
    if (mode !== undefined && mode !== null && mode !== '') payload.model_mode = mode;
  }
  // Bounded 0..1 and labelled by the node as "the Lower the Closer to the
  // Control Image/Video". Only meaningful alongside `G`.
  if (Number.isFinite(denoisingStrength)) {
    payload.denoising_strength = Math.min(1, Math.max(0, denoisingStrength));
  }
  if (margins) payload.video_guide_outpainting = margins;

  applyForcedFlags(payload, metadata);
  return applyCommon(payload, opts);
}

/**
 * Reference-driven video: people, motion and voice as guidance rather than
 * fixed frames. `reuseSourceAudio` takes the reference video's own soundtrack
 * (`audio_prompt_type: "K"`) instead of a separate audio file.
 */
export function buildReferenceVideoPayload(opts = {}) {
  const { modelType, model, prompt, imageRefs, videoRefs, audioRefs, reuseSourceAudio, backgroundFirst } = opts;
  if (!modelType) throw new Error('referenceToVideo: modelType is required');
  const metadata = getApiMetadata(model);
  const media = mediaInputsOf(model);
  const known = hasCapabilityMetadata(model);

  const images = pathList(imageRefs);
  const videos = pathList(videoRefs);
  const audios = reuseSourceAudio ? [] : pathList(audioRefs);

  if (!images.length && !videos.length && !audios.length) {
    throw new Error('referenceToVideo: at least one reference is required');
  }
  if (known) {
    if (images.length && !media.image.reference) {
      throw new Error(`referenceToVideo: ${modelType} does not accept reference images`);
    }
    if (videos.length && !media.video.control) {
      throw new Error(`referenceToVideo: ${modelType} does not accept reference video`);
    }
    if ((audios.length || reuseSourceAudio) && !media.audio.prompt) {
      throw new Error(`referenceToVideo: ${modelType} does not accept audio references`);
    }
    const hard = referenceHardLimits(model);
    if (images.length > hard.images) throw new Error(`referenceToVideo: at most ${hard.images} reference image(s)`);
    if (videos.length > hard.videos) throw new Error(`referenceToVideo: at most ${hard.videos} reference video(s)`);
    if (audios.length > hard.audios) throw new Error(`referenceToVideo: at most ${hard.audios} audio reference(s)`);
  }
  // Structural limits of the payload itself, enforced whatever the model says.
  // There are exactly two video slots (`video_guide`, `video_guide2`) and two
  // audio slots (`audio_guide`, `audio_guide2`), so a third reference has
  // nowhere to go. Relaxing the family budgets to `referenceHardLimits` left
  // these unguarded and the extras were SILENTLY DROPPED, which is worse than
  // refusing them.
  if (videos.length > VIDEO_REF_SLOTS) {
    throw new Error(`referenceToVideo: the payload has ${VIDEO_REF_SLOTS} video reference slots, got ${videos.length}`);
  }
  if (audios.length > AUDIO_REF_SLOTS) {
    throw new Error(`referenceToVideo: the payload has ${AUDIO_REF_SLOTS} audio reference slots, got ${audios.length}`);
  }
  if (reuseSourceAudio && !videos.length) {
    throw new Error('referenceToVideo: reuseSourceAudio needs a reference video to take the soundtrack from');
  }

  const payload = {
    model_type: modelType,
    prompt: requirePrompt(prompt, 'referenceToVideo'),
  };
  if (images.length) {
    payload.image_refs = images;
    payload.video_prompt_type = mergeFlags(
      payload.video_prompt_type,
      defaultReferenceFlags(metadata, { backgroundFirst }),
    );
  }
  if (videos.length) {
    payload.video_guide = videos[0];
    payload.video_prompt_type = mergeFlags(payload.video_prompt_type, 'V');
    if (videos[1]) {
      payload.video_guide2 = videos[1];
      payload.video_prompt_type = mergeFlags(payload.video_prompt_type, '+G');
    } else {
      payload.video_prompt_type = mergeFlags(payload.video_prompt_type, 'G');
    }
  }
  if (reuseSourceAudio) {
    payload.audio_prompt_type = mergeFlags(payload.audio_prompt_type, 'K');
  } else if (audios.length) {
    payload.audio_guide = audios[0];
    payload.audio_prompt_type = mergeFlags(payload.audio_prompt_type, 'A');
    if (audios[1]) {
      payload.audio_guide2 = audios[1];
      payload.audio_prompt_type = mergeFlags(payload.audio_prompt_type, 'B');
    }
  }

  applyForcedFlags(payload, metadata);
  return applyCommon(payload, opts);
}

/**
 * Start/end-framed video. On MiniMax H3 the soundtrack comes out of the same
 * pass, so this is also the "video with audio" verb.
 */
export function buildAudiovisualShotPayload(opts = {}) {
  const { modelType, model, prompt, imageStart, imageEnd, videoSource } = opts;
  if (!modelType) throw new Error('audiovisualShot: modelType is required');
  const metadata = getApiMetadata(model);
  const media = mediaInputsOf(model);
  const known = hasCapabilityMetadata(model);

  const start = pathOf(imageStart);
  const end = pathOf(imageEnd);
  const source = pathOf(videoSource);

  if (known) {
    if (start && !media.image.start) throw new Error(`audiovisualShot: ${modelType} does not accept a start image`);
    if (end && !media.image.end) throw new Error(`audiovisualShot: ${modelType} does not accept an end image`);
    if (source && !media.video.continue) throw new Error(`audiovisualShot: ${modelType} cannot continue a video`);
  }

  const payload = {
    model_type: modelType,
    prompt: requirePrompt(prompt, 'audiovisualShot'),
  };
  if (start) {
    payload.image_start = start;
    payload.image_prompt_type = mergeFlags(payload.image_prompt_type, 'S');
  }
  if (end) {
    payload.image_end = end;
    payload.image_prompt_type = mergeFlags(payload.image_prompt_type, 'E');
  }
  if (source) {
    payload.video_source = source;
    payload.image_prompt_type = mergeFlags(payload.image_prompt_type, 'V');
  }

  applyForcedFlags(payload, metadata);
  return applyCommon(payload, opts);
}

// ── Multi-shot prompts ──
//
// WanGP has TWO unrelated multi-shot dialects, and sending the wrong one
// produces a single shot with literal junk in the prompt:
//
//   'relay'  — Shotplan (and LTX2 prompt relay). Contiguous RANGE markers:
//              `[0%:40%] wide shot [40%:100%] close up`. The server
//              (`models/wan/shotplan.py`) rejects a plan that does not start
//              at 0, is not contiguous, or does not reach the end, so those
//              rules are enforced here too — instantly, not four minutes in.
//
//   'window' — sliding-window models (JoyAI-Echo, MiniMax H3 FL2VA, Wan
//              sliding window). Inline COMMANDS between shots:
//              `[/new_shot][/duration=61] close up`.
//
// Shotplan does not report `sliding_window` and sliding-window models do not
// parse range markers, so the dialect is a property of the model, not a user
// preference — though a caller may still force one.

export const SHOT_DIALECTS = Object.freeze({ RELAY: 'relay', WINDOW: 'window' });

/**
 * How WanGP should carve the prompt text up (`multi_prompts_gen_type`).
 *
 * This is NOT optional and the default is actively wrong for shot sequences.
 * `prompt_parser.DEFAULT_MULTI_PROMPTS_MODE` is `"PG"` — *each paragraph adds a
 * new item to the generation queue*. A multi-shot prompt submitted without this
 * field therefore becomes several separate jobs, or one window with every
 * shot's commands collapsed into it. Either way the premise of a shot sequence
 * — one generation, so the model carries continuity across cuts — is lost.
 *
 *   'W'  each LINE is a new sliding window of the SAME generation
 *   'FG' all lines are one prompt (what prompt-relay needs: Shotplan parses the
 *        `[0%:40%]` markers itself out of a single prompt unit)
 *
 * Values come from `prompt_parser.normalize_multi_prompts_mode`:
 * G | PG | W | PW | FG.
 */
export const MULTI_PROMPT_MODES = Object.freeze({
  QUEUE_PER_LINE: 'G',
  QUEUE_PER_PARAGRAPH: 'PG',
  WINDOW_PER_LINE: 'W',
  WINDOW_PER_PARAGRAPH: 'PW',
  SINGLE_PROMPT: 'FG',
});

/**
 * The mode to submit for a dialect, honouring the model's own preference.
 *
 * Models carry a default in `defaults.multi_prompts_gen_type` and they do not
 * agree: `shotplan_t2v_2_2` ships `FG`, `joyai_echo_surgical` ships **`PW`**
 * (each *paragraph* is a window, because Joy sets `preserve_empty_prompt_lines`),
 * and plain `t2v_2_2` ships `PG` — a queue mode, useless for a shot sequence.
 *
 * So: keep the model's choice when it already selects the right kind of mode,
 * and only override when it does not.
 */
export function multiPromptModeFor(dialect, model) {
  const own = String(asObject(model?.defaults).multi_prompts_gen_type || '').toUpperCase();
  if (dialect === SHOT_DIALECTS.RELAY) {
    return own === MULTI_PROMPT_MODES.SINGLE_PROMPT ? own : MULTI_PROMPT_MODES.SINGLE_PROMPT;
  }
  return own.includes('W') ? own : MULTI_PROMPT_MODES.WINDOW_PER_LINE;
}

/**
 * How to join per-window prompts for a mode. A `P` mode splits on blank lines,
 * so joining those windows with a single newline would merge every shot into
 * one window.
 */
export function shotSeparatorFor(mode) {
  return String(mode || '').includes('P') ? '\n\n' : '\n';
}

/** Which multi-shot dialect a model speaks. */
export function shotDialectFor(modelType, model) {
  const type = String(modelType || '');
  if (type.startsWith('shotplan')) return SHOT_DIALECTS.RELAY;
  if (capabilitiesOf(model).sliding_window) return SHOT_DIALECTS.WINDOW;
  if (!hasCapabilityMetadata(model)) return SHOT_DIALECTS.WINDOW;
  return SHOT_DIALECTS.WINDOW;
}

function shotText(shot, index) {
  const text = String(shot?.prompt || '').trim();
  if (!text) throw new Error(`shotSequence: shot ${index + 1} has no prompt`);
  return text;
}

/**
 * Sliding-window dialect: inline commands, one shot per line.
 * Each shot: `{ prompt, durationFrames, overlapFrames, transition, loraMultipliers }`.
 */
export function compileWindowPrompt(shots) {
  const list = asArray(shots);
  if (!list.length) throw new Error('shotSequence: at least one shot is required');
  return list
    .map((shot, index) => {
      const commands = [];
      if (index > 0 && shot?.transition !== 'continue') commands.push('[/new_shot]');
      if (Number.isFinite(shot?.durationFrames) && shot.durationFrames > 0) {
        commands.push(`[/duration=${Math.round(shot.durationFrames)}]`);
      }
      if (Number.isFinite(shot?.overlapFrames) && shot.overlapFrames >= 0) {
        commands.push(`[/overlap=${Math.round(shot.overlapFrames)}]`);
      }
      if (shot?.loraMultipliers) {
        const value = Array.isArray(shot.loraMultipliers) ? shot.loraMultipliers.join(';') : String(shot.loraMultipliers);
        if (value) commands.push(`[/loras_mult=${value}]`);
      }
      const text = shotText(shot, index);
      return commands.length ? `${commands.join('')} ${text}` : text;
    })
    .join('\n');
}

/**
 * Prompt-relay dialect: contiguous percentage ranges covering the whole clip.
 *
 * Percentages are used rather than seconds because they need neither the frame
 * rate nor the clip length to be known here, and they land exactly on 0 and
 * 100 — which is what the server's contiguity check demands.
 *
 * @param {Array} shots  Weighted by `durationFrames` when given, else equal.
 * @param {object} [opts] `{ globalPrompt }` — text before the first marker,
 *   applied across every shot.
 */
export function compileRelayPrompt(shots, { globalPrompt } = {}) {
  const list = asArray(shots);
  if (!list.length) throw new Error('shotSequence: at least one shot is required');

  const weights = list.map((shot) => {
    const value = Number(shot?.durationFrames);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const even = total <= 0 || weights.some((w) => w === 0);

  // Integer percentages that sum to exactly 100: accumulate and round the
  // running boundary, so no drift and no gap between neighbours.
  const bounds = [0];
  let acc = 0;
  list.forEach((_, index) => {
    acc += even ? 1 / list.length : weights[index] / total;
    bounds.push(index === list.length - 1 ? 100 : Math.round(acc * 100));
  });
  for (let i = 1; i < bounds.length; i += 1) {
    if (bounds[i] <= bounds[i - 1]) {
      throw new Error('shotSequence: shots are too short to occupy distinct ranges — use fewer or longer shots');
    }
  }

  const segments = list.map((shot, index) => `[${bounds[index]}%:${bounds[index + 1]}%] ${shotText(shot, index)}`);
  const head = String(globalPrompt || '').trim();
  return head ? `${head}\n${segments.join('\n')}` : segments.join('\n');
}

/**
 * Compile a shot plan for a model. Pass `dialect` to force one.
 */
export function compileShotPrompt(shots, opts = {}) {
  const dialect = opts.dialect || shotDialectFor(opts.modelType, opts.model);
  return dialect === SHOT_DIALECTS.RELAY
    ? compileRelayPrompt(shots, opts)
    : compileWindowPrompt(shots);
}

export function buildShotSequencePayload(opts = {}) {
  const { modelType, model, shots, videoSource, dialect, globalPrompt } = opts;
  if (!modelType) throw new Error('shotSequence: modelType is required');
  const metadata = getApiMetadata(model);
  const known = hasCapabilityMetadata(model);
  const list = asArray(shots);
  const chosen = dialect || shotDialectFor(modelType, model);

  if (known && list.length > 1 && chosen === SHOT_DIALECTS.WINDOW && !capabilitiesOf(model).sliding_window) {
    throw new Error(
      `shotSequence: ${modelType} supports neither prompt relay nor sliding windows, so it cannot carry multiple shots`,
    );
  }

  const payload = {
    model_type: modelType,
    prompt: compileShotPrompt(list, { dialect: chosen, modelType, model, globalPrompt }),
    // Without this the node's default ("PG") turns the plan into several queued
    // jobs instead of one generation. See MULTI_PROMPT_MODES.
    multi_prompts_gen_type: opts.multiPromptMode || multiPromptModeFor(chosen, model),
  };
  const source = pathOf(videoSource);
  if (source) {
    payload.video_source = source;
    payload.image_prompt_type = mergeFlags(payload.image_prompt_type, 'V');
  }

  applyForcedFlags(payload, metadata);
  return applyCommon(payload, opts);
}

/**
 * Voice-cloned speech: a line of text plus one or two reference recordings.
 * `audio_prompt_type: "A"` clones one voice; `"AB"` adds emotion or a second
 * speaker, depending on the model's own `audio_prompt_type.sources` choices.
 */
export function buildVoiceClonePayload(opts = {}) {
  const { modelType, model, text, prompt, voiceRef, secondRef, audioPromptType } = opts;
  if (!modelType) throw new Error('voiceCloneTTS: modelType is required');
  const metadata = getApiMetadata(model);
  const media = mediaInputsOf(model);
  const known = hasCapabilityMetadata(model);

  const line = String(text ?? prompt ?? '').trim();
  if (!line) throw new Error('voiceCloneTTS: text (the line to speak) is required');
  const voice = pathOf(voiceRef);
  if (!voice) throw new Error('voiceCloneTTS: voiceRef is required — use textToSpeech for an uncloned voice');
  if (known && !media.audio.prompt) {
    throw new Error(`voiceCloneTTS: ${modelType} does not accept a voice reference`);
  }

  const payload = {
    model_type: modelType,
    prompt: line,
    audio_guide: voice,
  };
  const second = pathOf(secondRef);
  if (second) payload.audio_guide2 = second;
  payload.audio_prompt_type = audioPromptType || (second ? 'AB' : 'A');

  applyForcedFlags(payload, metadata);
  return applyCommon(payload, opts);
}

// ── musicGeneration ──
//
// A song is not a spoken line, and the node's model rows cannot tell the two
// apart: every music model and every TTS engine reports `family: "tts"`,
// `capability: "audio-generation"` and `text_to_audio: true`. The one field
// that separates them is `model_def.group === "music"` (set by exactly three
// handlers upstream — ace_step, heartmula and stable_audio3), and that field
// only rides the DETAIL endpoint, not the list rows. So `isMusicModel` reads
// the group when it has it and falls back to the architecture prefixes of
// those three handlers when all it has is a list row.

const MUSIC_ARCHITECTURES = ['ace_step', 'heartmula', 'stable_audio3'];

/** Lyrics that ask for a track with no vocals. */
export const INSTRUMENTAL_LYRICS = '[Instrumental]';

/** Is this a song generator rather than a speech engine? */
export function isMusicModel(model) {
  const group = String(asObject(model?.model_def).group || '');
  if (group) return group === 'music';
  const arch = String(model?.architecture || model?.model_type || '').toLowerCase();
  return MUSIC_ARCHITECTURES.some((prefix) => arch.startsWith(prefix));
}

/**
 * The song-length bounds a model declares, in seconds — its own
 * `duration_slider`, which differs per model (ACE-Step 1.5 goes to 360,
 * HeartMula starts at 30, Stable Audio 3 stops at 120). Null when unknown.
 */
export function musicDurationLimits(model) {
  const slider = asObject(asObject(model?.model_def).duration_slider);
  const min = Number(slider.min);
  const max = Number(slider.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const preferred = Number(slider.default);
  return { min, max, default: Number.isFinite(preferred) ? preferred : null };
}

/**
 * The `audio_prompt_type` values a model offers, as `{value, label}`.
 *
 * These letters are per-model, not a shared vocabulary: ACE-Step offers
 * `"" | A | B | AB` (cover mode / timbre transfer) while Stable Audio 3 offers
 * `"" | AE | AI | AC` (edit / inpaint / continue). Anything that guesses a
 * letter here is guessing wrong for half the catalogue.
 */
export function musicAudioTasks(model) {
  const sources = asObject(asObject(getApiMetadata(model).setting_values).audio_prompt_type).sources;
  return asArray(asObject(sources).choices)
    .filter((choice) => choice && typeof choice === 'object')
    .map((choice) => ({ value: String(choice.value ?? ''), label: String(choice.label ?? '') }));
}

/** Does the model take a separate music-caption field alongside the lyrics? */
export function hasMusicCaption(model) {
  return Boolean(asObject(model?.model_def).alt_prompt);
}

// The node normalizes a custom-setting name to lowercase with runs of
// non-alphanumerics collapsed to `_`, then maps a handful of spellings onto one
// id. Mirrored here so `keyScale`, `key_scale` and `KeyScale` all land on the
// id the handler validates.
const MUSIC_SETTING_ALIASES = {
  bpm: 'bpm',
  keyscale: 'keyscale',
  key_scale: 'keyscale',
  timesignature: 'timesignature',
  time_signature: 'timesignature',
  language: 'language',
  lang: 'language',
  language_code: 'language',
};

function canonicalMusicSetting(key) {
  const normalized = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return MUSIC_SETTING_ALIASES[normalized] || normalized;
}

/** The custom-setting ids a model declares (`bpm`, `keyscale`, …). */
export function musicCustomSettingIds(model) {
  return asArray(asObject(model?.model_def).custom_settings)
    .map((def) => canonicalMusicSetting(asObject(def).id || asObject(def).param || asObject(def).name))
    .filter(Boolean);
}

// `applicable_settings` is the node's registry of EXTRA settings, not a
// complete list of what a model accepts — `guidance_scale` is missing from
// ACE-Step's even though the model uses it, because there it is a core slider.
// So only the keys that genuinely live in that registry are gated on it, and
// only when the node actually answered with a list.
const GATED_MUSIC_SETTINGS = new Set([
  'temperature',
  'top_p',
  'top_k',
  'audio_scale',
  'alt_guidance_scale',
]);

function assertApplicable(model, key, modelType, optionName) {
  if (!GATED_MUSIC_SETTINGS.has(key)) return;
  const applicable = asArray(model?.applicable_settings);
  if (!applicable.length) return; // node did not say — let the job decide
  if (applicable.some((setting) => String(asObject(setting).key || setting) === key)) return;
  throw new Error(`musicGeneration: ${modelType} has no ${optionName} control (${key})`);
}

/**
 * A song: lyrics plus a style caption, on a music model.
 *
 * `prompt` carries the LYRICS (`[Instrumental]` for no vocals) and `alt_prompt`
 * the music caption — the inverse of what the field names suggest, and the
 * reason this builder exists rather than apps hand-rolling the payload. Models
 * that declare no `alt_prompt` (Stable Audio 3) have no lyrics concept at all,
 * so there the single text goes in `prompt`.
 *
 * Everything not passed is left off the payload: the node fills missing keys
 * from the model's own defaults at task time, which is how one service covers
 * an 8-step turbo model and a 60-step v1 without hardcoding either.
 */
export function buildMusicPayload(opts = {}) {
  const {
    modelType,
    model,
    lyrics,
    prompt,
    style,
    instrumental,
    durationSeconds,
    sourceAudio,
    timbreRef,
    audioPromptType,
    audioScale,
    lmGuidanceScale,
    lmPreprocessing,
    temperature,
    topP,
    topK,
    bpm,
    keyScale,
    timeSignature,
    language,
    customSettings,
  } = opts;
  if (!modelType) throw new Error('musicGeneration: modelType is required');
  const metadata = getApiMetadata(model);
  const media = mediaInputsOf(model);
  const known = hasCapabilityMetadata(model);
  const def = asObject(model?.model_def);
  // Only the DETAIL response carries `model_def`. A bare list row says nothing
  // about caption fields, duration bounds or custom settings, so the checks
  // that read them are skipped rather than guessed at.
  const described = Object.keys(def).length > 0;

  // Refuse a speech model rather than let it recite the lyrics through a job.
  // Skipped entirely when the node told us nothing about the model.
  if (model && known && !isMusicModel(model)) {
    const what = def.group ? `a "${def.group}" model` : 'not a music model';
    throw new Error(
      `musicGeneration: ${modelType} is ${what} — use textToSpeech or voiceCloneTTS for speech`,
    );
  }
  if (known && !capabilitiesOf(model).text_to_audio) {
    throw new Error(`musicGeneration: ${modelType} does not generate audio from text`);
  }

  const words = String(lyrics ?? prompt ?? '').trim();
  const caption = String(style ?? '').trim();
  const payload = { model_type: modelType };

  // With no caption field the model's single text input IS the description, so
  // `style` alone is a complete request. Both at once would have to be merged,
  // and merging them silently is the kind of guess that loses a lyric.
  if (described && !hasMusicCaption(model)) {
    if (words && caption) {
      throw new Error(
        `musicGeneration: ${modelType} has no separate music-caption field — combine the style into \`lyrics\``,
      );
    }
    payload.prompt = words || caption;
  } else {
    payload.prompt = words || (instrumental ? INSTRUMENTAL_LYRICS : '');
    if (caption) payload.alt_prompt = caption;
  }
  if (!payload.prompt && instrumental) payload.prompt = INSTRUMENTAL_LYRICS;
  if (!payload.prompt) {
    throw new Error(
      'musicGeneration: lyrics are required — pass `instrumental: true` for a track with no vocals',
    );
  }

  if (durationSeconds !== undefined && durationSeconds !== null) {
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('musicGeneration: durationSeconds must be a positive number of seconds');
    }
    const limits = musicDurationLimits(model);
    if (limits && (seconds < limits.min || seconds > limits.max)) {
      throw new Error(
        `musicGeneration: ${modelType} generates between ${limits.min} and ${limits.max} seconds, not ${seconds}`,
      );
    }
    payload.duration_seconds = seconds;
  }

  // Audio task letters. The default mapping (source audio → A, timbre → B) is
  // ACE-Step's; it is checked against what the model actually offers, so a
  // model with a different vocabulary reports its own choices instead of
  // failing four minutes into a job.
  const source = pathOf(sourceAudio);
  const timbre = pathOf(timbreRef);
  if ((source || timbre) && known && !media.audio.prompt) {
    throw new Error(`musicGeneration: ${modelType} does not accept a reference recording`);
  }
  let task = audioPromptType;
  if (task === undefined || task === null) {
    task = `${source ? 'A' : ''}${timbre ? 'B' : ''}`;
  }
  task = String(task);
  if (task.includes('A') && !source) {
    throw new Error(`musicGeneration: audio task "${task}" needs a sourceAudio recording`);
  }
  if (task.includes('B') && !timbre && !audioPromptType) {
    throw new Error(`musicGeneration: audio task "${task}" needs a timbreRef recording`);
  }
  const offered = musicAudioTasks(model);
  if (offered.length && !offered.some((choice) => choice.value === task)) {
    const list = offered.map((choice) => `"${choice.value}" (${choice.label})`).join(', ');
    throw new Error(`musicGeneration: ${modelType} has no audio task "${task}" — it offers ${list}`);
  }
  if (source) payload.audio_guide = source;
  if (timbre) payload.audio_guide2 = timbre;
  if (task) payload.audio_prompt_type = task;

  if (Number.isFinite(audioScale)) {
    assertApplicable(model, 'audio_scale', modelType, 'source-audio strength');
    payload.audio_scale = audioScale;
  }
  if (Number.isFinite(lmGuidanceScale)) {
    assertApplicable(model, 'alt_guidance_scale', modelType, 'LM guidance');
    payload.alt_guidance_scale = lmGuidanceScale;
  }
  if (Number.isFinite(temperature)) {
    assertApplicable(model, 'temperature', modelType, 'temperature');
    payload.temperature = temperature;
  }
  if (Number.isFinite(topP)) {
    assertApplicable(model, 'top_p', modelType, 'top-p');
    payload.top_p = topP;
  }
  if (Number.isFinite(topK)) {
    assertApplicable(model, 'top_k', modelType, 'top-k');
    payload.top_k = topK;
  }

  // The LM chain-of-thought stage exists only on the `*_lm_*` variants, which
  // are the ones that declare `model_mode` choices. Asking for it elsewhere is
  // a silent no-op otherwise.
  if (lmPreprocessing !== undefined && lmPreprocessing !== null) {
    const choices = asArray(asObject(asObject(metadata.setting_values).model_mode).choices);
    if (described && !choices.length) {
      throw new Error(
        `musicGeneration: ${modelType} has no LM preprocessing stage — use one of the *_lm_* variants`,
      );
    }
    payload.model_mode = lmPreprocessing;
  }

  const named = { bpm, keyscale: keyScale, timesignature: timeSignature, language };
  const custom = {};
  for (const [key, value] of Object.entries({ ...asObject(customSettings), ...named })) {
    if (value === undefined || value === null || value === '') continue;
    custom[canonicalMusicSetting(key)] = value;
  }
  if (Object.keys(custom).length) {
    const declared = musicCustomSettingIds(model);
    if (described && !declared.length) {
      throw new Error(`musicGeneration: ${modelType} takes no BPM / key / time-signature settings`);
    }
    const unknown = Object.keys(custom).filter((key) => declared.length && !declared.includes(key));
    if (unknown.length) {
      throw new Error(
        `musicGeneration: ${modelType} has no ${unknown.join(', ')} setting — it declares ${declared.join(', ')}`,
      );
    }
    payload.custom_settings = custom;
  }

  applyForcedFlags(payload, metadata);
  // Audio-only models have no frame geometry; a resolution or video_length
  // pinned in media-settings for another service must not leak into a song.
  return applyCommon(payload, { ...opts, resolution: null, videoLength: null });
}

// ── Service registry ──
//
// What each media.js service needs from a model, and the model to fall back on
// when the node cannot answer (old API) or nothing matches. `prefer` is tried
// in order before dropping to the first capable model on the node.

export const SERVICE_NEEDS = Object.freeze({
  textToImage: {
    need: { output: 'image', capability: 'text_to_image' },
    prefer: ['z_image', 'krea2_turbo', 'flux'],
    fallback: 'z_image',
  },
  imageEdit: {
    need: { input: 'image', output: 'image', capability: 'image_to_image' },
    prefer: ['krea2_turbo_edit', 'krea2_raw_edit'],
    fallback: 'krea2_turbo_edit',
  },
  textToVideo: {
    need: { output: 'video', capability: 'text_to_video' },
    prefer: ['t2v_2_2', 't2v'],
    fallback: 't2v_2_2',
  },
  imageToVideo: {
    need: { input: 'image', output: 'video', capability: 'image_to_video' },
    prefer: ['i2v_2_2', 'i2v'],
    fallback: 'i2v_2_2',
  },
  referenceToVideo: {
    need: { input: 'image', output: 'video', capability: 'reference_images' },
    prefer: ['minimax_h3_ref2va_pruned', 'minimax_h3_ref2va', 'ltx2_22B_msr_v2'],
    fallback: 'minimax_h3_ref2va_pruned',
  },
  audiovisualShot: {
    need: { output: 'video', capability: 'audio_output,image_to_video' },
    prefer: ['minimax_h3_fl2va_pruned', 'minimax_h3_fl2va', 'joyai_echo_surgical'],
    fallback: 'minimax_h3_fl2va',
  },
  shotSequence: {
    // NOT `capability: sliding_window` — Shotplan carries its shots through
    // prompt relay and does not report that flag, so requiring it would
    // exclude the models named for the job. The dialect check in
    // `buildShotSequencePayload` is what actually guards multi-shot support.
    need: { output: 'video', capability: 'text_to_video' },
    prefer: ['shotplan_t2v_2_2', 'shotplan_t2v', 'joyai_echo_surgical'],
    fallback: 'shotplan_t2v_2_2',
  },
  textToSpeech: {
    need: { output: 'audio', capability: 'text_to_audio' },
    prefer: ['index_tts2'],
    fallback: 'index_tts2',
  },
  voiceCloneTTS: {
    need: { output: 'audio', capability: 'audio_to_audio' },
    prefer: ['index_tts2'],
    fallback: 'index_tts2',
  },
  musicGeneration: {
    // Same coarse need as textToSpeech — every TTS engine on the node also
    // reports `text_to_audio` — so the music/speech split is made by `refine`
    // rather than by the need. See `isMusicModel` for why that field exists.
    need: { output: 'audio', capability: 'text_to_audio' },
    refine: isMusicModel,
    prefer: [
      'ace_step_v1_5_xl_turbo_lm_4b',
      'ace_step_v1_5_xl',
      'ace_step_v1_5_turbo_lm_4b',
      'ace_step_v1_5',
    ],
    fallback: 'ace_step_v1_5',
  },
});

/**
 * Rank capable models for a service: preferred names first (in order), then
 * everything else by name so the choice is stable across calls.
 *
 * A service may add a `refine` predicate for a distinction the capability
 * metadata cannot express — `musicGeneration` uses one to keep speech models
 * out of a list every one of them technically matches.
 */
export function rankModelsForService(models, serviceId) {
  const spec = SERVICE_NEEDS[serviceId];
  if (!spec) throw new Error(`rankModelsForService: unknown service "${serviceId}"`);
  const capable = asArray(models).filter(
    (m) => modelMatchesNeed(m, spec.need) && (typeof spec.refine !== 'function' || spec.refine(m)),
  );
  const rank = (model) => {
    const index = spec.prefer.indexOf(String(model?.model_type || ''));
    return index === -1 ? spec.prefer.length : index;
  };
  return capable.sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return String(a?.model_type || '').localeCompare(String(b?.model_type || ''));
  });
}

// High-level media services for apps.
//
// Apps consume these and stay ignorant of Wan2GP specifics (model_type names,
// image_mode flags, prompt-type letters, file path conventions). The dashboard
// remains "raw mode" for the operator; everything else should import from here.
//
// Two generations of service live here:
//
//   textToImage / textToVideo / imageToVideo / textToSpeech
//     The original four. Each has a single named default model, resolved from
//     `media-settings` and then a hardcoded fallback. Their behaviour is frozen
//     — 22 apps import them.
//
//   imageEdit / referenceToVideo / audiovisualShot / shotSequence /
//   voiceCloneTTS / musicGeneration
//     Added for the v0.6 agent API (spec 314). These resolve a model by
//     *capability* against the live node, accept File/Blob/data-URL media for
//     every input, and preflight the payload before queueing a job.
//
// Media arguments everywhere in the new services accept a `File`, a `Blob`, a
// `data:`/`blob:`/`http(s):` URL, or a path the node already holds. Uploads are
// content-addressed per node, so the same reference used by three services
// uploads once.

import {
  submitJob,
  getJob,
  downloadFile,
  fileNameFromPath,
  isTerminalStatus,
  validateSettings,
} from './wan2gp.js';
import { getDefault } from './media-defaults.js';
import { pickModel, getCapabilities, fallbackNotice } from './wan2gp-capabilities.js';
import { resolveMediaInput, resolveMediaInputs } from './wan2gp-uploads.js';
import {
  buildImageEditPayload,
  buildReferenceVideoPayload,
  buildAudiovisualShotPayload,
  buildShotSequencePayload,
  buildVoiceClonePayload,
  buildMusicPayload,
  modelDefaultSteps,
  SERVICE_NEEDS,
} from './wan2gp-payload.js';

// Re-exported so apps can build capability-aware UI without reaching past this
// layer for the common cases.
export { pickModel, getCapabilities, fallbackNotice } from './wan2gp-capabilities.js';
export { resolveMediaInput, resolveMediaInputs, invalidateUploads } from './wan2gp-uploads.js';
export {
  listCapableModels,
  nodeCapabilityStatus,
  invalidateCapabilities,
  CapabilityUnavailableError,
  referenceLimitsFor,
} from './wan2gp-capabilities.js';
export { compileShotPrompt, SERVICE_NEEDS } from './wan2gp-payload.js';
export {
  isMusicModel,
  musicDurationLimits,
  musicAudioTasks,
  musicCustomSettingIds,
  hasMusicCaption,
  INSTRUMENTAL_LYRICS,
} from './wan2gp-payload.js';

export const SIZE_PRESETS = {
  square: '1024x1024',
  portrait: '1024x1280',
  landscape: '1280x1024',
  wide: '1664x928',
  tall: '928x1664',
};

// Hardcoded fallbacks. The user's choice in `media-settings/` is
// preferred via getDefault() — these only apply if nothing's saved yet.
export const DEFAULTS = {
  textToImage: {
    modelType: 'z_image',
    resolution: SIZE_PRESETS.square,
  },
  textToVideo: {
    modelType: 't2v_2_2',
    resolution: SIZE_PRESETS.landscape,
    videoLength: 81,
  },
  imageToVideo: {
    modelType: 'i2v_2_2',
    resolution: SIZE_PRESETS.landscape,
    videoLength: 81,
  },
  textToSpeech: {
    modelType: 'index_tts2',
  },
  // Capability-resolved services. `modelType` here is the last resort — the
  // node's own catalogue is consulted first (see resolveServiceModel).
  imageEdit: {
    modelType: SERVICE_NEEDS.imageEdit.fallback,
    resolution: SIZE_PRESETS.square,
  },
  referenceToVideo: {
    modelType: SERVICE_NEEDS.referenceToVideo.fallback,
    resolution: '832x480',
    videoLength: 124,
  },
  audiovisualShot: {
    modelType: SERVICE_NEEDS.audiovisualShot.fallback,
    resolution: '832x480',
    videoLength: 124,
    // MiniMax H3 has no steps-distilled checkpoint yet; below ~15 steps the
    // output degrades badly, so the service default sits at the node's floor.
    numInferenceSteps: 20,
  },
  shotSequence: {
    modelType: SERVICE_NEEDS.shotSequence.fallback,
    resolution: SIZE_PRESETS.landscape,
  },
  voiceCloneTTS: {
    modelType: SERVICE_NEEDS.voiceCloneTTS.fallback,
  },
  // No resolution and no videoLength: a song has no frame geometry, and
  // `buildMusicPayload` strips both rather than let one leak in from a pin.
  musicGeneration: {
    modelType: SERVICE_NEEDS.musicGeneration.fallback,
  },
};

/** Steps below this on MiniMax H3 produce mush; warn rather than clamp. */
export const H3_MIN_STEPS = 15;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function progressFromJob(job) {
  const raw = Number(job?.progress);
  const percent = Number.isFinite(raw) ? (raw <= 1 ? raw * 100 : raw) : 0;
  return {
    percent,
    step: Number(job?.step) || 0,
    total: Number(job?.total_steps) || 0,
    status: job?.status || 'unknown',
  };
}

async function awaitTerminal(jobId, { signal, onProgress, nodeId, appId, intervalMs = 1500 } = {}) {
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await getJob(jobId, { signal, nodeId, appId });
    if (onProgress) {
      try { onProgress(progressFromJob(job)); } catch {}
    }
    if (isTerminalStatus(job?.status)) return job;
    await sleep(intervalMs, signal);
  }
}

function fileAccessors(paths, { signal, nodeId, appId } = {}) {
  return (paths || []).map(path => ({
    path,
    name: fileNameFromPath(path),
    blob: (s) => downloadFile(path, { signal: s ?? signal, nodeId, appId }),
    url: async (s) => URL.createObjectURL(await downloadFile(path, { signal: s ?? signal, nodeId, appId })),
  }));
}

function resolveResolution({ resolution, size }) {
  if (resolution && /^\d+x\d+$/.test(String(resolution))) return String(resolution);
  if (size && SIZE_PRESETS[size]) return SIZE_PRESETS[size];
  if (size && /^\d+x\d+$/.test(String(size))) return String(size);
  return null;
}

/**
 * Generate an image from text.
 *
 * @param {object} opts
 * @param {string} opts.prompt              Required text prompt.
 * @param {string} [opts.modelType]         Override the default model_type (`z_image`).
 * @param {string} [opts.size]              Named preset: `square|portrait|landscape|wide|tall`, or an exact `WxH`.
 * @param {string} [opts.resolution]        Exact `WxH`. Wins over `size` if set.
 * @param {number} [opts.seed]              -1 for random.
 * @param {number} [opts.numInferenceSteps] Override the model's default steps.
 * @param {string} [opts.negativePrompt]    Optional negative prompt.
 * @param {object} [opts.extra]             Additional payload fields merged last (provider escape hatch).
 * @param {(p: {percent, step, total, status}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]       Cancels the in-flight request and the poll loop.
 * @returns {Promise<{ jobId, status, files: Array<{path, name, blob, url}>, raw }>}
 */
export async function textToImage(opts = {}) {
  const {
    prompt,
    appId,
    nodeId,
    modelType = getDefault('textToImage', 'modelType', DEFAULTS.textToImage.modelType, { appId }),
    size,
    resolution,
    seed = -1,
    numInferenceSteps,
    negativePrompt,
    extra,
    onProgress,
    signal,
  } = opts;

  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('textToImage: prompt is required');

  const payload = {
    model_type: modelType,
    prompt: cleanPrompt,
    image_mode: 1,
    seed: Number.isFinite(seed) ? seed : -1,
  };
  const res =
    resolveResolution({ resolution, size }) ||
    getDefault('textToImage', 'resolution', DEFAULTS.textToImage.resolution, { appId });
  if (res) payload.resolution = res;
  if (Number.isFinite(numInferenceSteps) && numInferenceSteps > 0) {
    payload.num_inference_steps = numInferenceSteps;
  }
  if (negativePrompt && String(negativePrompt).trim()) {
    payload.negative_prompt = String(negativePrompt).trim();
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.assign(payload, extra);
  }

  const apiOpts = { signal, nodeId, appId };
  const submitted = await submitJob(payload, apiOpts);
  const jobId = submitted?.job_id || submitted?.jobId || submitted?.id;
  if (!jobId) throw new Error('textToImage: server did not return a job_id');

  const final = await awaitTerminal(jobId, { signal, onProgress, nodeId, appId });
  const status = String(final?.status || 'unknown').toLowerCase();
  if (status === 'failed') {
    const err = final?.error;
    throw new Error(typeof err === 'string' ? err : (err?.message || 'Job failed'));
  }
  if (status === 'cancelled') throw new Error('Job cancelled');

  return {
    jobId,
    status,
    files: fileAccessors(final?.files, { signal, nodeId, appId }),
    raw: final,
  };
}

async function runVideoJob(payload, opts) {
  const { onProgress, signal, nodeId, appId } = opts;
  const apiOpts = { signal, nodeId, appId };
  const submitted = await submitJob(payload, apiOpts);
  const jobId = submitted?.job_id || submitted?.jobId || submitted?.id;
  if (!jobId) throw new Error('video job: server did not return a job_id');

  const final = await awaitTerminal(jobId, { signal, onProgress, nodeId, appId });
  const status = String(final?.status || 'unknown').toLowerCase();
  if (status === 'failed') {
    const err = final?.error;
    throw new Error(typeof err === 'string' ? err : (err?.message || 'Job failed'));
  }
  if (status === 'cancelled') throw new Error('Job cancelled');

  return {
    jobId,
    status,
    files: fileAccessors(final?.files, { signal, nodeId, appId }),
    raw: final,
  };
}

/**
 * Generate a video clip from text.
 */
export async function textToVideo(opts = {}) {
  const {
    prompt,
    appId,
    nodeId,
    modelType = getDefault('textToVideo', 'modelType', DEFAULTS.textToVideo.modelType, { appId }),
    size,
    resolution,
    videoLength = getDefault('textToVideo', 'videoLength', DEFAULTS.textToVideo.videoLength, { appId }),
    guidanceScale,
    flowShift,
    seed = -1,
    numInferenceSteps,
    negativePrompt,
    extra,
    onProgress,
    signal,
  } = opts;

  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('textToVideo: prompt is required');

  const payload = {
    model_type: modelType,
    prompt: cleanPrompt,
    seed: Number.isFinite(seed) ? seed : -1,
  };
  const res =
    resolveResolution({ resolution, size }) ||
    getDefault('textToVideo', 'resolution', DEFAULTS.textToVideo.resolution, { appId });
  if (res) payload.resolution = res;
  if (Number.isFinite(videoLength) && videoLength > 0) payload.video_length = videoLength;
  if (Number.isFinite(guidanceScale)) payload.guidance_scale = guidanceScale;
  if (Number.isFinite(flowShift)) payload.flow_shift = flowShift;
  if (Number.isFinite(numInferenceSteps) && numInferenceSteps > 0) {
    payload.num_inference_steps = numInferenceSteps;
  }
  if (negativePrompt && String(negativePrompt).trim()) {
    payload.negative_prompt = String(negativePrompt).trim();
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(payload, extra);

  return runVideoJob(payload, { onProgress, signal, nodeId, appId });
}

/**
 * Generate a video clip from a still image (image-to-video).
 *
 * `imagePath` should be a Wan2GP-side file path (typically the `path` of a
 * file produced by a previous job — the agent stores generated assets on the
 * node so paths from prior jobs can be re-submitted).
 */
export async function imageToVideo(opts = {}) {
  const {
    prompt,
    imagePath,
    appId,
    nodeId,
    modelType = getDefault('imageToVideo', 'modelType', DEFAULTS.imageToVideo.modelType, { appId }),
    size,
    resolution,
    videoLength = getDefault('imageToVideo', 'videoLength', DEFAULTS.imageToVideo.videoLength, { appId }),
    motionIntensity,
    guidanceScale,
    flowShift,
    seed = -1,
    numInferenceSteps,
    negativePrompt,
    extra,
    onProgress,
    signal,
  } = opts;

  if (!imagePath) throw new Error('imageToVideo: imagePath is required');
  const cleanPrompt = String(prompt || '').trim();

  const payload = {
    model_type: modelType,
    prompt: cleanPrompt,
    image_start: imagePath,
    seed: Number.isFinite(seed) ? seed : -1,
  };
  const res =
    resolveResolution({ resolution, size }) ||
    getDefault('imageToVideo', 'resolution', DEFAULTS.imageToVideo.resolution, { appId });
  if (res) payload.resolution = res;
  if (Number.isFinite(videoLength) && videoLength > 0) payload.video_length = videoLength;
  if (Number.isFinite(guidanceScale)) payload.guidance_scale = guidanceScale;
  if (Number.isFinite(flowShift)) payload.flow_shift = flowShift;
  if (Number.isFinite(motionIntensity)) payload.motion_intensity = motionIntensity;
  if (Number.isFinite(numInferenceSteps) && numInferenceSteps > 0) {
    payload.num_inference_steps = numInferenceSteps;
  }
  if (negativePrompt && String(negativePrompt).trim()) {
    payload.negative_prompt = String(negativePrompt).trim();
  }
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(payload, extra);

  return runVideoJob(payload, { onProgress, signal, nodeId, appId });
}

// ── Capability-resolved services (spec 314) ──

/**
 * Which model a capability-resolved service should use.
 *
 * Order: explicit `modelType` → the user's pin in `media-settings` → the first
 * model on the node that reports the needed capability → the service's named
 * fallback. The last case is what an old or unreachable node gets, and it comes
 * back with a `notice` so the app can say so instead of silently misbehaving.
 *
 * @returns {Promise<{ modelType, resolvedBy, notice }>}
 */
export async function resolveServiceModel(serviceId, opts = {}) {
  const { modelType, appId, nodeId, signal } = opts;
  if (modelType) return { modelType, resolvedBy: 'explicit', notice: null };

  const pinned = getDefault(serviceId, 'modelType', null, { appId });
  if (pinned) return { modelType: pinned, resolvedBy: 'pinned', notice: null };

  const pick = await pickModel(serviceId, { appId, nodeId, signal });
  return {
    modelType: pick.modelType,
    resolvedBy: pick.resolvedBy,
    notice: fallbackNotice(pick, serviceId),
  };
}

// Model metadata is needed to build a correct payload (reference flags, inpaint
// method, forced letters). A node that cannot serve the detail endpoint is not
// fatal — the payload builders treat missing metadata as "unknown" and skip
// their capability assertions rather than refusing to work.
async function loadModelForPayload(modelType, opts) {
  try {
    const { detail } = await getCapabilities(modelType, opts);
    return detail;
  } catch {
    return null;
  }
}

/**
 * Ask the node whether it would accept this payload, before queueing it.
 * Cheap, and it turns "the job died four minutes in" into an immediate error.
 * A node that cannot answer is not treated as a rejection.
 */
async function preflight(payload, opts) {
  let result;
  try {
    result = await validateSettings(payload, opts);
  } catch {
    return; // validation endpoint unavailable — let the job speak for itself
  }
  if (result && result.valid === false) {
    throw new Error(result.error || 'Wan2GP rejected this request');
  }
}

// Shared tail for the new services: resolve model, build payload, preflight,
// submit, poll. `build` gets the resolved model detail so it can honour
// per-model metadata.
async function runService(serviceId, opts, build) {
  const { appId, nodeId, signal, onProgress, onNotice, preflight: doPreflight = true } = opts;
  const apiOpts = { signal, nodeId, appId };

  const resolved = await resolveServiceModel(serviceId, opts);
  if (resolved.notice && onNotice) {
    try { onNotice(resolved.notice); } catch {}
  }
  const model = await loadModelForPayload(resolved.modelType, apiOpts);

  const defaults = DEFAULTS[serviceId] || {};
  const resolution =
    resolveResolution({ resolution: opts.resolution, size: opts.size }) ||
    getDefault(serviceId, 'resolution', defaults.resolution, { appId });
  const videoLength = Number.isFinite(opts.videoLength)
    ? opts.videoLength
    : getDefault(serviceId, 'videoLength', defaults.videoLength, { appId });
  const numInferenceSteps = Number.isFinite(opts.numInferenceSteps)
    ? opts.numInferenceSteps
    : getDefault(serviceId, 'numInferenceSteps', defaults.numInferenceSteps, { appId });

  const payload = await build({
    ...opts,
    modelType: resolved.modelType,
    model,
    resolution,
    videoLength,
    numInferenceSteps,
    apiOpts,
  });

  if (doPreflight) await preflight(payload, apiOpts);

  const submitted = await submitJob(payload, apiOpts);
  const jobId = submitted?.job_id || submitted?.jobId || submitted?.id;
  if (!jobId) throw new Error(`${serviceId}: server did not return a job_id`);

  const final = await awaitTerminal(jobId, { signal, onProgress, nodeId, appId });
  const status = String(final?.status || 'unknown').toLowerCase();
  if (status === 'failed') {
    const err = final?.error;
    throw new Error(typeof err === 'string' ? err : (err?.message || 'Job failed'));
  }
  if (status === 'cancelled') throw new Error('Job cancelled');

  return {
    jobId,
    status,
    modelType: resolved.modelType,
    resolvedBy: resolved.resolvedBy,
    notice: resolved.notice,
    payload,
    files: fileAccessors(final?.files, { signal, nodeId, appId }),
    raw: final,
  };
}

/**
 * Edit an image: reference-driven generation, inpainting with a mask, or
 * outpainting by extending the frame.
 *
 * @param {object} opts
 * @param {string} opts.prompt                What the result should be.
 * @param {Array}  [opts.references]          Reference images (File/Blob/URL/path).
 * @param {*}      [opts.guide]               Control image, when the model takes one.
 * @param {*}      [opts.mask]                Inpainting mask (white = repaint).
 * @param {object|string} [opts.outpaint]     `{top,bottom,left,right}` percentages.
 * @param {boolean} [opts.backgroundFirst]    First reference is the background (`KI`).
 * @param {number|string} [opts.modelMode]    Override the model's inpaint method.
 * @param {string} [opts.modelType]           Skip capability resolution.
 * @param {(msg: string) => void} [opts.onNotice] Called when a fallback was used.
 */
export async function imageEdit(opts = {}) {
  return runService('imageEdit', opts, async (ctx) => {
    const [references, guide, mask] = await Promise.all([
      resolveMediaInputs(ctx.references, ctx.apiOpts),
      resolveMediaInput(ctx.guide, ctx.apiOpts),
      resolveMediaInput(ctx.mask, ctx.apiOpts),
    ]);
    return buildImageEditPayload({ ...ctx, references, guide, mask });
  });
}

/**
 * Generate video guided by references — a person, a movement, a voice — rather
 * than fixed frames. Set `reuseSourceAudio` to take the reference video's own
 * soundtrack instead of supplying separate audio.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {Array} [opts.imageRefs]
 * @param {Array} [opts.videoRefs]
 * @param {Array} [opts.audioRefs]
 * @param {boolean} [opts.reuseSourceAudio]
 */
export async function referenceToVideo(opts = {}) {
  return runService('referenceToVideo', opts, async (ctx) => {
    const [imageRefs, videoRefs, audioRefs] = await Promise.all([
      resolveMediaInputs(ctx.imageRefs, ctx.apiOpts),
      resolveMediaInputs(ctx.videoRefs, ctx.apiOpts),
      ctx.reuseSourceAudio ? [] : resolveMediaInputs(ctx.audioRefs, ctx.apiOpts),
    ]);
    return buildReferenceVideoPayload({ ...ctx, imageRefs, videoRefs, audioRefs });
  });
}

/**
 * Generate a shot with its soundtrack in the same pass. Optionally framed by a
 * start image, an end image, or both, or continued from an existing video.
 *
 * On MiniMax H3 the audio is generated with the video and comes back baked into
 * the file. There is no steps-distilled checkpoint, so `numInferenceSteps`
 * below `H3_MIN_STEPS` warns via `onNotice` — it is never silently clamped.
 */
export async function audiovisualShot(opts = {}) {
  return runService('audiovisualShot', opts, async (ctx) => {
    // Warn against the model's OWN default, not a fixed number. MiniMax H3
    // ships 20 steps because it has no distilled checkpoint; joyai_echo_surgical
    // and ltx2_22B_msr_v2 are distilled and ship 8. A hardcoded floor would
    // nag on exactly the models where a low count is the right answer.
    const floor = modelDefaultSteps(ctx.model) ?? H3_MIN_STEPS;
    if (Number.isFinite(ctx.numInferenceSteps) && ctx.numInferenceSteps < floor && opts.onNotice) {
      try {
        opts.onNotice(
          `${ctx.numInferenceSteps} steps is below the ${floor} ${ctx.modelType} ships with — expect degraded output.`,
        );
      } catch {}
    }
    const [imageStart, imageEnd, videoSource] = await Promise.all([
      resolveMediaInput(ctx.imageStart, ctx.apiOpts),
      resolveMediaInput(ctx.imageEnd, ctx.apiOpts),
      resolveMediaInput(ctx.videoSource, ctx.apiOpts),
    ]);
    return buildAudiovisualShotPayload({ ...ctx, imageStart, imageEnd, videoSource });
  });
}

/**
 * Run a multi-shot plan as ONE generation, so the model carries character and
 * object continuity across cuts instead of restarting each time.
 *
 * @param {object} opts
 * @param {Array<{prompt, durationFrames, overlapFrames, transition, loraMultipliers}>} opts.shots
 * @param {*} [opts.videoSource] Continue from an existing video.
 */
export async function shotSequence(opts = {}) {
  return runService('shotSequence', opts, async (ctx) => {
    const videoSource = await resolveMediaInput(ctx.videoSource, ctx.apiOpts);
    return buildShotSequencePayload({ ...ctx, videoSource });
  });
}

/**
 * Speak a line in a cloned voice.
 *
 * @param {object} opts
 * @param {string} opts.text        The line to speak.
 * @param {*} opts.voiceRef         Reference recording of the voice to clone.
 * @param {*} [opts.secondRef]      Emotion or second-speaker reference.
 */
export async function voiceCloneTTS(opts = {}) {
  return runService('voiceCloneTTS', opts, async (ctx) => {
    const [voiceRef, secondRef] = await Promise.all([
      resolveMediaInput(ctx.voiceRef, ctx.apiOpts),
      resolveMediaInput(ctx.secondRef, ctx.apiOpts),
    ]);
    return buildVoiceClonePayload({ ...ctx, voiceRef, secondRef });
  });
}

/**
 * Write and perform a song.
 *
 * `lyrics` is the sung text — `[Instrumental]`, or `instrumental: true`, for a
 * track with no vocals — and `style` the music caption (genre, instruments,
 * mood). On a model with no caption field the two collapse into one text.
 *
 * Anything left out is filled from the model's own defaults on the node, so
 * the same call is correct on an 8-step ACE-Step 1.5 Turbo and on the 60-step
 * v1.0. Song length is `durationSeconds`, NOT a frame count; the accepted range
 * is per-model and reported by `musicDurationLimits`.
 *
 * @param {object} opts
 * @param {string} [opts.lyrics]            The sung text.
 * @param {string} [opts.style]             Music caption: genre, instruments, mood.
 * @param {boolean} [opts.instrumental]     Shorthand for `[Instrumental]` lyrics.
 * @param {number} [opts.durationSeconds]   Song length in seconds.
 * @param {*} [opts.sourceAudio]            Track to cover/remix (`audio_guide`).
 * @param {*} [opts.timbreRef]              Voice/timbre to transfer (`audio_guide2`).
 * @param {string} [opts.audioPromptType]   Explicit audio task letters, when the
 *                                          model's vocabulary is not ACE-Step's.
 * @param {number} [opts.audioScale]        How strongly the source audio holds.
 * @param {number} [opts.lmGuidanceScale]   LM CFG on the `*_lm_*` variants.
 * @param {number} [opts.lmPreprocessing]   LM chain-of-thought stage (`model_mode`).
 * @param {number|string} [opts.bpm]
 * @param {string} [opts.keyScale]          e.g. `"F# minor"`.
 * @param {number} [opts.timeSignature]     2, 3, 4 or 6.
 * @param {string} [opts.language]          ISO code; empty = auto.
 */
export async function musicGeneration(opts = {}) {
  return runService('musicGeneration', opts, async (ctx) => {
    const [sourceAudio, timbreRef] = await Promise.all([
      resolveMediaInput(ctx.sourceAudio, ctx.apiOpts),
      resolveMediaInput(ctx.timbreRef, ctx.apiOpts),
    ]);
    return buildMusicPayload({ ...ctx, sourceAudio, timbreRef });
  });
}

/**
 * Generate a TTS audio clip from text.
 *
 * `voiceId` and `speakerSample` map to `voice_id` / `speaker_sample`, neither
 * of which exists anywhere in WanGP — they are dropped by its task-argument
 * filter, and have been since VibeVoice left the node. They stay for
 * back-compat with callers that still pass them.
 *
 * To actually choose a voice, pass `extra: { model_mode }` — the model's own
 * speaker (or language) control, whose choices come from
 * `api_metadata.setting_values.model_mode` on the detail endpoint. Free-text
 * voice direction goes in `extra: { alt_prompt }`. To clone a voice from a
 * recording, use `voiceCloneTTS`, which sends a real `audio_guide`.
 */
export async function textToSpeech(opts = {}) {
  const {
    prompt,
    appId,
    nodeId,
    modelType = getDefault('textToSpeech', 'modelType', DEFAULTS.textToSpeech.modelType, { appId }),
    voiceId,
    speakerSample,
    seed = -1,
    extra,
    onProgress,
    signal,
  } = opts;

  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('textToSpeech: prompt (the line to speak) is required');

  const payload = {
    model_type: modelType,
    prompt: cleanPrompt,
    seed: Number.isFinite(seed) ? seed : -1,
  };
  if (voiceId) payload.voice_id = voiceId;
  if (speakerSample) payload.speaker_sample = speakerSample;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(payload, extra);

  return runVideoJob(payload, { onProgress, signal, nodeId, appId });
}


// The XR probe (spec 334) — how VR Forge learns whether a generated project
// actually works in a headset without a headset being present.
//
// The probe is a classic script injected into the project's own window ahead of
// every project script (`previewer.js` bootstrap option). It installs IWER
// configured as a Meta Quest 3 over `navigator.xr`, then wraps the WebXR entry
// points the project will use and records what really happened:
//
//   requestSession(mode, init)   what was asked for, and whether it was granted
//   session.requestAnimationFrame  how many frames ran, and what each cost
//   XRFrame.getViewerPose        how many views, and whether they differ
//   XRWebGLLayer + readPixels    what the left eye actually saw
//   select* events / haptics     whether input reached the project
//
// It measures the project; it never helps it. The only thing the probe does on
// the project's behalf is click the entry control the manifest declares, because
// a session cannot start any other way.
//
// What this can and cannot prove is written down in HELP.md and shown in the UI:
// an emulator establishes that a project enters immersive mode and renders
// stereo frames. It says nothing about how a Quest 3 performs.

export const XR_PROBE_DEFAULTS = Object.freeze({
  targetFrames: 120,        // ~2s at 60Hz; enough for a loop to prove it is a loop
  frameBudgetMs: 13.9,      // one frame at 72Hz, both eyes
  sessionTimeoutMs: 12_000,
  captureFrames: Object.freeze([30, 90]),
  captureWidth: 320,
  // A flat-shaded VR scene legitimately has very few colours: the fixture's own
  // eye capture is background + two cube faces. The check is for a frame that
  // is one flat field, not for a frame that is simple.
  minDistinctColors: 3,
});

/** IWER's UMD bundle, fetched as text so it can be injected into the project. */
export async function loadEmulatorSource(fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const url = new URL('../../shared/lib/iwer/2.3.0/iwer.min.js', import.meta.url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not load the WebXR emulator (${res.status})`);
  return res.text();
}

/**
 * The probe source, parameterised for one run.
 * Runs inside the project's window; talks to the app through postMessage.
 */
export function xrProbeSource(token, options = {}) {
  const config = { ...XR_PROBE_DEFAULTS, ...options };
  return `(() => {
  'use strict';
  const TOKEN = ${JSON.stringify(token)};
  const CONFIG = ${JSON.stringify(config)};
  const post = (kind, payload) => {
    try { parent.postMessage(Object.assign({ __vrForgeXr: TOKEN, kind }, payload || {}), '*'); }
    catch (e) { /* the app went away */ }
  };

  if (!window.IWER || !window.IWER.XRDevice) { post('fatal', { message: 'The WebXR emulator did not load.' }); return; }

  const device = new IWER.XRDevice(IWER.metaQuest3);
  // forceInstall: a desktop Chrome with a real (empty) WebXR runtime would
  // otherwise keep its own navigator.xr and report "no device".
  device.installRuntime({ forceInstall: true });
  window.__vrForgeDevice = device;

  const report = {
    emulator: { name: device.name || 'Meta Quest 3', version: device.version || null },
    request: null,          // what the project asked navigator.xr for
    granted: false,
    frames: 0,
    frameCosts: [],
    poseCalls: 0,
    maxViewportsPerFrame: 0,   // distinct gl.viewport rects within one XR frame
    viewportsSample: [],
    views: null,            // sampled view geometry
    stereo: null,
    inputSources: [],
    selectEvents: [],
    hapticPulses: 0,
    referenceSpaces: [],
    captures: [],
    errors: [],
    ended: false,
    endedCleanly: false,
    startedAt: null,
    finishedAt: null,
  };
  const note = (kind, message) => {
    report.errors.push({ kind, message: String(message && message.message || message) });
  };

  // ── record the WebGL contexts the project creates, for pixel evidence, and
  // every viewport it sets, which is how "one view shown to both eyes" is
  // actually caught: the runtime always offers two views, so only what the
  // project DRAWS distinguishes stereo from mono. ──
  const contexts = [];
  let frameViewports = [];
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    const ctx = originalGetContext.apply(this, arguments);
    if (ctx && /webgl/i.test(String(type)) && !contexts.includes(ctx)) {
      contexts.push(ctx);
      const originalViewport = ctx.viewport.bind(ctx);
      ctx.viewport = function (x, y, w, h) {
        const key = [x, y, w, h].join(',');
        if (!frameViewports.includes(key)) frameViewports.push(key);
        return originalViewport(x, y, w, h);
      };
    }
    return ctx;
  };

  let session = null;
  let refSpace = null;

  // ── views: measured from the project's OWN getViewerPose calls, so what is
  // recorded is what the project rendered with, not what it could have had ──
  const XRFrameProto = (window.XRFrame && window.XRFrame.prototype) || null;
  if (XRFrameProto && XRFrameProto.getViewerPose) {
    const originalGetViewerPose = XRFrameProto.getViewerPose;
    XRFrameProto.getViewerPose = function (space) {
      const pose = originalGetViewerPose.apply(this, arguments);
      report.poseCalls++;
      if (pose && !report.views && pose.views) {
        report.views = pose.views.map(view => ({
          eye: view.eye,
          // The 16-float matrices are what actually separates two eyes from one
          // view drawn twice, so they are compared rather than trusted.
          transform: Array.from(view.transform.matrix, n => +n.toFixed(6)),
          projection: Array.from(view.projectionMatrix, n => +n.toFixed(6)),
        }));
      }
      return pose;
    };
  }

  // ── pixel evidence: read the left viewport straight out of the framebuffer ──
  function capture(frameIndex) {
    try {
      const gl = contexts[contexts.length - 1];
      const layer = session && session.renderState && session.renderState.baseLayer;
      if (!gl || !layer) return;
      const width = layer.framebufferWidth || gl.drawingBufferWidth;
      const height = layer.framebufferHeight || gl.drawingBufferHeight;
      // Left half for a stereo layer; the whole buffer if the runtime says so.
      const w = Math.max(1, Math.min(width, report.views && report.views.length > 1 ? Math.floor(width / 2) : width));
      const h = Math.max(1, height);
      const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer || null);
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous || null);

      // Statistics first: they are the evidence. The PNG is for the human.
      const seen = new Set();
      let sum = 0, min = 255, max = 0;
      const step = Math.max(1, Math.floor((w * h) / 4096));
      let samples = 0;
      for (let i = 0; i < w * h; i += step) {
        const o = i * 4;
        const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
        seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += luma; min = Math.min(min, luma); max = Math.max(max, luma);
        samples++;
      }

      const full = document.createElement('canvas');
      full.width = w; full.height = h;
      const ctx2d = full.getContext('2d');
      const image = ctx2d.createImageData(w, h);
      // readPixels is bottom-up; flip so the capture is the right way round.
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        image.data.set(pixels.subarray(src, src + w * 4), y * w * 4);
      }
      ctx2d.putImageData(image, 0, 0);
      const scaled = document.createElement('canvas');
      const scale = Math.min(1, CONFIG.captureWidth / w);
      scaled.width = Math.max(1, Math.round(w * scale));
      scaled.height = Math.max(1, Math.round(h * scale));
      scaled.getContext('2d').drawImage(full, 0, 0, scaled.width, scaled.height);

      report.captures.push({
        frame: frameIndex,
        width: w, height: h,
        distinctColors: seen.size,
        meanLuma: +(sum / Math.max(1, samples)).toFixed(2),
        minLuma: +min.toFixed(2), maxLuma: +max.toFixed(2),
        dataUrl: scaled.toDataURL('image/png'),
      });
    } catch (e) {
      note('capture', e);
    }
  }

  // ── input plumbing ──
  function watchInputs() {
    try {
      report.inputSources = Array.from(session.inputSources || []).map(source => ({
        handedness: source.handedness,
        targetRayMode: source.targetRayMode,
        profiles: Array.from(source.profiles || []),
        hasGamepad: !!source.gamepad,
        hasHand: !!source.hand,
        hapticActuators: source.gamepad && source.gamepad.hapticActuators
          ? source.gamepad.hapticActuators.length : 0,
      }));
      for (const source of session.inputSources || []) {
        const actuators = (source.gamepad && source.gamepad.hapticActuators) || [];
        for (const actuator of actuators) {
          if (actuator.__vrForgeWrapped) continue;
          const originalPulse = actuator.pulse && actuator.pulse.bind(actuator);
          if (!originalPulse) continue;
          actuator.pulse = function () { report.hapticPulses++; return originalPulse.apply(actuator, arguments); };
          actuator.__vrForgeWrapped = true;
        }
      }
    } catch (e) { note('inputs', e); }
  }

  function instrument(active) {
    session = active;
    report.granted = true;
    report.startedAt = Date.now();

    const originalRaf = active.requestAnimationFrame.bind(active);
    active.requestAnimationFrame = (callback) => originalRaf((time, frame) => {
      frameViewports = [];
      const started = performance.now();
      try {
        callback(time, frame);
      } catch (error) {
        // A throwing frame callback is the project's bug, and the loop usually
        // dies with it — record it rather than letting it vanish into the
        // runtime's own error handling.
        note('frame-callback', error);
      }
      const cost = performance.now() - started;
      report.frames++;
      if (frameViewports.length > report.maxViewportsPerFrame) {
        report.maxViewportsPerFrame = frameViewports.length;
        report.viewportsSample = frameViewports.slice(0, 4);
      }
      if (report.frameCosts.length < 900) report.frameCosts.push(+cost.toFixed(3));
      if (CONFIG.captureFrames.includes(report.frames)) capture(report.frames);
      if (report.frames === 5) watchInputs();
      if (report.frames % 15 === 0) post('progress', { frames: report.frames, cost: +cost.toFixed(2) });
    });

    const originalRefSpace = active.requestReferenceSpace.bind(active);
    active.requestReferenceSpace = (type) => originalRefSpace(type).then((space) => {
      report.referenceSpaces.push({ type, granted: true });
      refSpace = refSpace || space;
      return space;
    }, (error) => {
      report.referenceSpaces.push({ type, granted: false, error: String(error && error.message || error) });
      throw error;
    });

    for (const type of ['selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend']) {
      active.addEventListener(type, (event) => {
        report.selectEvents.push({ type, handedness: event.inputSource && event.inputSource.handedness, frame: report.frames });
      });
    }
    active.addEventListener('inputsourceschange', watchInputs);
    active.addEventListener('end', () => {
      report.ended = true;
      report.finishedAt = Date.now();
      post('ended', {});
    });
    post('session', { request: report.request, granted: true });
  }

  const xr = navigator.xr;
  const originalRequestSession = xr.requestSession.bind(xr);
  xr.requestSession = function (mode, init) {
    const options = init || {};
    report.request = {
      mode,
      requiredFeatures: Array.from(options.requiredFeatures || []),
      optionalFeatures: Array.from(options.optionalFeatures || []),
      at: Date.now(),
    };
    return originalRequestSession(mode, options).then((active) => {
      instrument(active);
      return active;
    }, (error) => {
      report.request.error = String(error && error.message || error);
      post('session', { request: report.request, granted: false });
      throw error;
    });
  };

  // ── commands from the app ──
  const controller = (hand) => (device.controllers && device.controllers[hand]) || null;
  const commands = {
    ping() { post('ready', { modes: device.supportedSessionModes, features: device.supportedFeatures }); },
    enter({ selector }) {
      const candidates = [];
      if (selector) candidates.push(selector);
      candidates.push('[data-forge-id="enter-xr"]', '#VRButton', '#ARButton', '#XRButton');
      for (const query of candidates) {
        let element = null;
        try { element = document.querySelector(query); } catch (e) { continue; }
        if (element) { element.click(); post('entered', { via: query, exact: query === selector }); return; }
      }
      // Last resort, and reported as such: a button that merely looks right.
      const button = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .find(el => /enter\\s*(vr|xr|ar)|start\\s*(vr|xr)/i.test(el.textContent || ''));
      if (button) { button.click(); post('entered', { via: 'text-match', exact: false }); return; }
      post('entered', { via: null, exact: false });
    },
    press({ hand = 'right', button = 'trigger', value = 1 }) {
      const target = controller(hand);
      if (!target) { post('input', { ok: false, reason: 'no controller ' + hand }); return; }
      try {
        target.updateButtonValue(button, value);
        post('input', { ok: true, hand, button, value });
      } catch (e) { post('input', { ok: false, reason: String(e && e.message || e) }); }
    },
    axes({ hand = 'right', x = 0, y = 0 }) {
      const target = controller(hand);
      if (target) { try { target.updateAxes('thumbstick', x, y); } catch (e) { note('axes', e); } }
    },
    inputMode({ mode }) { try { device.primaryInputMode = mode; } catch (e) { note('input-mode', e); } },
    recenter() { try { device.recenter(); } catch (e) { note('recenter', e); } },
    capture() { capture(report.frames); post('captured', { captures: report.captures.length }); },
    async end() {
      try {
        if (session && !report.ended) await session.end();
        report.endedCleanly = true;
      } catch (e) { note('session-end', e); }
      post('report', { report });
    },
    report() { post('report', { report }); },
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__vrForgeCmd !== TOKEN) return;
    const command = commands[data.cmd];
    if (command) { try { command(data.args || {}); } catch (e) { note('command:' + data.cmd, e); } }
  });

  window.addEventListener('error', (event) => note('window-error', event.message || 'error'));
  window.addEventListener('unhandledrejection', (event) => note('unhandled-rejection',
    (event.reason && event.reason.message) || event.reason || 'rejection'));

  post('installed', { emulator: report.emulator });
})();`;
}

// ── Pure analysis. Everything below runs in the app, on a finished report. ──

export function percentile(values, p) {
  const list = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1));
  return list[index];
}

/**
 * Two views are stereo only if they are actually different. One view drawn into
 * both eyes — the classic "flat scene in a headset" bug — has identical
 * transforms and is caught here.
 */
export function stereoVerdict(views) {
  if (!Array.isArray(views) || views.length === 0) return { ok: false, reason: 'no-views', views: 0 };
  if (views.length === 1) return { ok: false, reason: 'monoscopic', views: 1 };
  const [left, right] = views;
  const same = Array.isArray(left.transform) && Array.isArray(right.transform)
    && left.transform.length === right.transform.length
    && left.transform.every((value, index) => value === right.transform[index]);
  if (same) return { ok: false, reason: 'identical-views', views: views.length };
  const separation = Array.isArray(left.transform) && Array.isArray(right.transform)
    ? Math.abs(left.transform[12] - right.transform[12])
    : null;
  return { ok: true, reason: null, views: views.length, separationM: separation == null ? null : +separation.toFixed(4) };
}

export function summarizeXrReport(report, config = XR_PROBE_DEFAULTS) {
  if (!report) return null;
  const costs = report.frameCosts || [];
  const stereo = stereoVerdict(report.views);
  const capture = (report.captures || []).at(-1) || null;
  return {
    granted: !!report.granted,
    mode: report.request?.mode || null,
    requiredFeatures: report.request?.requiredFeatures || [],
    optionalFeatures: report.request?.optionalFeatures || [],
    frames: report.frames || 0,
    targetFrames: config.targetFrames,
    meanFrameCostMs: costs.length ? +(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2) : null,
    p95FrameCostMs: costs.length ? +percentile(costs, 95).toFixed(2) : null,
    frameBudgetMs: config.frameBudgetMs,
    stereo,
    renderedViewports: report.maxViewportsPerFrame || 0,
    referenceSpaces: report.referenceSpaces || [],
    inputSources: report.inputSources || [],
    selectEvents: (report.selectEvents || []).length,
    hapticPulses: report.hapticPulses || 0,
    distinctColors: capture ? capture.distinctColors : null,
    meanLuma: capture ? capture.meanLuma : null,
    endedCleanly: !!report.endedCleanly,
    errors: report.errors || [],
  };
}

const issue = (severity, code, message, detail = {}) => ({ severity, code, message, ...detail });

/**
 * Turn a probe report into validation issues.
 *
 * The manifest is the project's own declaration, so most of these are
 * consistency checks: a project that asks the runtime for something it never
 * declared is as wrong as one that fails to render.
 */
export function evaluateXrReport(report, {
  manifest = null, brief = null, config = XR_PROBE_DEFAULTS, entered = null,
} = {}) {
  const issues = [];
  const xrManifest = manifest?.xr || {};
  if (!report) {
    issues.push(issue('error', 'xr_probe_missing', 'The emulated XR session never ran, so nothing about VR was verified.'));
    return issues;
  }
  if (entered && entered.via === null) {
    issues.push(issue('error', 'xr_entry_control_missing',
      'No XR entry control was found. The manifest must declare one and the page must render it with data-forge-id="enter-xr".'));
  } else if (entered && entered.exact === false) {
    issues.push(issue('warning', 'xr_entry_control_guessed',
      `The declared entry control was not found; the probe fell back to ${entered.via}. A headless run cannot rely on that.`));
  }

  if (!report.granted) {
    issues.push(issue('error', 'xr_session_not_entered',
      report.request?.error
        ? `The project asked for an immersive session and was refused: ${report.request.error}`
        : 'The project never entered an immersive XR session.'));
    return issues;
  }

  const summary = summarizeXrReport(report, config);
  if (summary.frames < config.targetFrames) {
    issues.push(issue('error', 'xr_frames_insufficient',
      `The XR frame loop presented ${summary.frames} frames; ${config.targetFrames} were required.`, { frames: summary.frames }));
  }
  if (!summary.stereo.ok) {
    const reason = {
      'no-views': 'The project never asked for a viewer pose, so nothing was rendered from the headset\'s point of view.',
      monoscopic: 'Only one view was rendered. A Quest 3 session presents two.',
      'identical-views': 'Both eye views had identical transforms — the scene was drawn once and shown to both eyes.',
    }[summary.stereo.reason] || 'Stereo rendering could not be established.';
    issues.push(issue('error', 'xr_not_stereo', reason, { stereo: summary.stereo }));
  }
  // The runtime hands every project two views, so a monoscopic project is not
  // caught by the pose — it is caught by what it drew. A stereo renderer sets a
  // different viewport for each eye; a project that draws once and lets both
  // eyes see it sets one.
  if (summary.stereo.ok && summary.renderedViewports < 2) {
    issues.push(issue('error', 'xr_single_viewport',
      'The session presented two eye views, but the project only ever set one viewport — both eyes were shown the same image. '
      + '(A renderer using OVR_multiview would also look like this; say so in the README if that is deliberate.)',
      { renderedViewports: summary.renderedViewports }));
  }
  const capture = (report.captures || []).at(-1);
  if (!capture) {
    issues.push(issue('warning', 'xr_no_capture', 'No eye capture could be read back from the session framebuffer.'));
  } else if (capture.distinctColors < config.minDistinctColors) {
    issues.push(issue('error', 'xr_blank_frame',
      `The captured eye view had ${capture.distinctColors} distinct colour${capture.distinctColors === 1 ? '' : 's'} — the headset would show a flat field, not a scene.`, { capture }));
  }

  // Declaration vs behaviour.
  const declaredModes = [].concat(xrManifest.modes || []);
  if (declaredModes.length && summary.mode && !declaredModes.includes(summary.mode)) {
    issues.push(issue('error', 'xr_mode_undeclared',
      `The project requested a ${summary.mode} session but its manifest declares ${declaredModes.join(', ') || 'none'}.`));
  }
  const declaredRequired = new Set([].concat(xrManifest.requiredFeatures || []));
  for (const feature of summary.requiredFeatures) {
    if (!declaredRequired.has(feature)) {
      issues.push(issue('error', 'xr_feature_undeclared',
        `The session required the "${feature}" feature, which the manifest does not declare.`));
    }
  }
  for (const declared of declaredRequired) {
    if (!summary.requiredFeatures.includes(declared)) {
      issues.push(issue('warning', 'xr_feature_unused',
        `The manifest declares required feature "${declared}", but the session never asked for it.`));
    }
  }

  // Input: only asserted when the brief says the project needs it.
  const wantsControllers = brief?.interaction?.controllers && brief.interaction.controllers !== 'none';
  if (wantsControllers && !summary.inputSources.some(source => source.hasGamepad)) {
    issues.push(issue('warning', 'xr_no_controllers',
      'The brief expects controllers, but the session reported no gamepad input sources.'));
  }
  if (brief?.interaction?.haptics && summary.hapticPulses === 0) {
    issues.push(issue('warning', 'xr_no_haptics',
      'The brief asks for haptics, but no haptic pulse was requested during the session.'));
  }
  if (wantsControllers && summary.selectEvents === 0) {
    issues.push(issue('warning', 'xr_no_select_events',
      'An emulated trigger press produced no select event the project handled.'));
  }

  // Frame cost is a warning by design: the emulator's frame rate is the host
  // browser's, so only the project's own per-frame work is meaningful.
  if (summary.p95FrameCostMs != null && summary.p95FrameCostMs > config.frameBudgetMs) {
    issues.push(issue('warning', 'xr_frame_budget',
      `95th-percentile frame callback cost ${summary.p95FrameCostMs} ms against a ${config.frameBudgetMs} ms budget at ${brief?.comfort?.targetFps || 72} fps (measured in the emulator, not on device).`));
  }
  for (const error of report.errors || []) {
    issues.push(issue('error', 'xr_runtime_error', `${error.kind}: ${error.message}`));
  }
  if (!summary.endedCleanly) {
    issues.push(issue('warning', 'xr_session_end_unclean', 'The XR session did not end cleanly when asked to.'));
  }
  return issues;
}

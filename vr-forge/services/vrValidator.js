// VR Forge validation (spec 334).
//
// Four lanes, in the order they can fail:
//
//   A structure   manifest, files, no external references, library integrity,
//                 and the XR contract the app requires of every project
//   B desktop     the project boots and its declared non-XR fallback renders
//   C emulated XR the project enters an immersive session on an emulated Quest 3
//                 and presents stereo frames (services/xrProbe.js)
//   D device      whether the run was opened on the real headset — provenance,
//                 never evidence
//
// Lane C is the reason this app exists; lane B is what stops a project that
// throws on load from ever reaching it.

import {
  fileRecords, runWebDiagnostics, statusFromIssues, validateWebStructure,
} from './validator.js';
import { hubServicesFor } from '../adapters/vr.js';
import { readProjectTree } from './previewer.js';
import { createXrHarness, sleep } from './xrHarness.js';
import { readProjectManifest, validateProjectManifest } from './previewAdapters.js';
import { projectLibraryValidationIssues } from './projectLibraries.js';
import {
  XR_PROBE_DEFAULTS, evaluateXrReport, summarizeXrReport,
} from './xrProbe.js';

const issue = (severity, code, message, detail = {}) => ({ severity, code, message, ...detail });

const XR_MODES = new Set(['immersive-vr', 'immersive-ar', 'inline']);

/**
 * The manifest's own `xr` block, checked before anything is run. A project that
 * cannot say what it is going to do cannot be held to it afterwards.
 */
export function validateXrManifest(manifest, entryHtml = '') {
  const issues = [];
  const xr = manifest?.xr;
  if (!xr || typeof xr !== 'object') {
    issues.push(issue('error', 'xr_manifest_missing', 'forge-project.json has no "xr" block, so the project never declared what session it needs.'));
    return issues;
  }
  const modes = [].concat(xr.modes || []);
  if (!modes.length) {
    issues.push(issue('error', 'xr_modes_missing', 'The manifest declares no XR session modes.'));
  }
  for (const mode of modes) {
    if (!XR_MODES.has(mode)) issues.push(issue('error', 'xr_mode_unknown', `"${mode}" is not a WebXR session mode.`));
  }
  for (const key of ['requiredFeatures', 'optionalFeatures']) {
    if (xr[key] != null && !Array.isArray(xr[key])) {
      issues.push(issue('error', 'xr_features_shape', `manifest xr.${key} must be an array of WebXR feature strings.`));
    }
  }
  const selector = String(xr.entryControl || '').trim();
  if (!selector) {
    issues.push(issue('error', 'xr_entry_control_undeclared',
      'The manifest declares no xr.entryControl, so nothing can start the session but a human.'));
  } else if (entryHtml && !entryHtml.includes('data-forge-id="enter-xr"') && !entryHtml.includes("data-forge-id='enter-xr'")) {
    // The selector may be anything, but the convention is what makes a run
    // reproducible; a project that only builds the button at runtime gets a
    // warning here and is still verified by the probe if the click lands.
    issues.push(issue('warning', 'xr_entry_control_not_in_markup',
      'No data-forge-id="enter-xr" element is present in the entry HTML. If the control is created at runtime, make sure it carries that attribute.'));
  }
  if (xr.targetFps != null && ![60, 72, 80, 90, 120].includes(Number(xr.targetFps))) {
    issues.push(issue('warning', 'xr_target_fps_odd', `xr.targetFps ${xr.targetFps} is not a Quest 3 refresh rate (72, 80, 90 or 120).`));
  }
  return issues;
}

/**
 * Run the emulated XR session against a built project.
 *
 * Returns the probe's raw report plus what the app observed driving it. Never
 * throws for a project's own failure: an unusable project produces a report
 * that says so.
 */
export async function runXrDiagnostics(projectHandle, {
  config = XR_PROBE_DEFAULTS, manifest = null, onProgress = null, fetchImpl,
} = {}) {
  if (typeof document === 'undefined') {
    return { ran: false, reason: 'The XR lane needs a browser.', report: null, entered: null };
  }
  const harness = await createXrHarness(projectHandle, {
    manifest, config, fetchImpl,
    onEvent: (event) => { if (event.kind === 'progress') onProgress?.(event); },
  });
  if (!harness.ok) return { ran: false, reason: harness.reason, report: null, entered: null };
  const { state, send, waitFor } = harness;
  const finish = (ran, reason) => ({ ran, reason, report: state.report, entered: state.entered });

  try {
    const installed = await waitFor(() => state.installed || state.fatal, 4000);
    if (state.fatal) return finish(false, state.fatal);
    if (!installed) {
      return finish(false, 'The XR probe never reported in; the project may have replaced the document.');
    }

    // Let the project finish its own start-up before asking for a session.
    await sleep(600);
    send('enter', { selector: manifest?.xr?.entryControl || '[data-forge-id="enter-xr"]' });
    await waitFor(() => state.entered, 2000);

    const reachedTarget = await waitFor(() => state.frames >= config.targetFrames, config.sessionTimeoutMs);
    if (reachedTarget) {
      // Input only matters once the loop is running.
      send('press', { hand: 'right', button: 'trigger', value: 1 });
      await sleep(200);
      send('press', { hand: 'right', button: 'trigger', value: 0 });
      await sleep(300);
    }
    send('end');
    await waitFor(() => state.report, 3000);
    if (!state.report) { send('report'); await waitFor(() => state.report, 1500); }
    return finish(true, null);
  } catch (error) {
    return finish(false, error.message);
  } finally {
    harness.dispose();
  }
}

/**
 * The whole report for one VR run, in the shape every Forge view already reads
 * (`status`, `issues`, `screenshot`) plus an `xr` section of its own.
 */
export async function validateVrProject({
  projectHandle, projectDir, brief = null, libraries = [], stopReason, config = XR_PROBE_DEFAULTS,
  device = null, onProgress = null,
}) {
  const files = await readProjectTree(projectHandle);
  const hubServices = hubServicesFor(brief);
  const structure = validateWebStructure(await fileRecords(projectHandle), { offline: true, hubServices });
  const manifestInfo = await readProjectManifest(projectHandle, { stack: 'web' });
  const entryHtml = structure.entry ? await (files.get(structure.entry)?.text() ?? '') : '';

  const issues = [
    ...structure.issues,
    ...validateProjectManifest(manifestInfo, [...files.keys()]),
    ...validateXrManifest(manifestInfo.manifest, entryHtml),
  ];

  // Lane B — the project boots and its fallback renders.
  let runtime = { errors: [], warnings: [], dimensions: null, screenshot: null };
  if (structure.entry) {
    try {
      runtime = await runWebDiagnostics(projectHandle, {});
    } catch (error) {
      runtime.warnings.push(`Desktop diagnostics failed to start: ${error.message}`);
    }
  }
  for (const error of runtime.errors) {
    const message = typeof error === 'string' ? error : error.message || error.value || error.kind;
    issues.push(issue('error', 'runtime_error', String(message), { runtime: error }));
  }
  for (const warning of runtime.warnings) issues.push(issue('warning', 'runtime_warning', warning));

  // A project that calls the hub is not portable: it runs inside this hub and
  // nowhere else. That is a legitimate choice a brief can make, and it is
  // recorded on every run that makes it rather than discovered later.
  const usedHub = structure.hubReferences || [];
  if (usedHub.length) {
    const endpoints = [...new Set(usedHub.map(item => item.ref.split('?')[0]))];
    issues.push(issue('warning', 'hub_bound_project',
      `This project calls the hub at runtime (${endpoints.join(', ')}), so it only runs inside this hub — exported on its own it loses those features.`,
      { endpoints }));
  } else if (hubServices.length) {
    issues.push(issue('warning', 'hub_services_unused',
      `The brief offers hub services (${hubServices.join(', ')}) but the project never calls one.`));
  }

  // Lane C — the emulated session. Skipped only when the entry itself is missing.
  let xr = { ran: false, reason: 'No entry point to run.', report: null, entered: null };
  if (structure.entry) {
    xr = await runXrDiagnostics(projectHandle, {
      config, manifest: manifestInfo.manifest, onProgress,
    });
  }
  if (!xr.ran) {
    issues.push(issue('error', 'xr_lane_unavailable', `The emulated XR session could not be run: ${xr.reason}`));
  } else {
    issues.push(...evaluateXrReport(xr.report, {
      manifest: manifestInfo.manifest, brief, config, entered: xr.entered,
    }));
  }

  let libraryIntegrity;
  if (libraries.length) {
    const integrity = await projectLibraryValidationIssues(projectHandle, libraries);
    issues.push(...integrity.issues);
    libraryIntegrity = integrity.records;
  }
  if (stopReason && stopReason !== 'done') {
    issues.push(issue('warning', 'generation_stopped_early',
      `Generation stopped with reason "${stopReason}" before validation.`));
  }

  const summary = xr.report ? summarizeXrReport(xr.report, config) : null;
  return {
    schemaVersion: 1,
    kind: 'vr',
    profile: 'webxr-quest3-v1',
    checkedAt: new Date().toISOString(),
    status: statusFromIssues(issues),
    structure: { ...structure, issues: undefined },
    runtime: { errors: runtime.errors, warnings: runtime.warnings, dimensions: runtime.dimensions },
    projectManifest: manifestInfo.manifest,
    previewAdapter: manifestInfo.manifest.runtime,
    xr: {
      lane: 'emulated-quest3',
      ran: xr.ran,
      reason: xr.reason,
      entered: xr.entered,
      summary,
      report: xr.report ? boundedReport(xr.report) : null,
    },
    // Provenance, never evidence: the hub cannot see what the headset did.
    device: device || { opened: false, at: null, target: null },
    hub: {
      declared: hubServices,
      used: [...new Set((structure.hubReferences || []).map(item => item.ref.split('?')[0]))],
      portable: (structure.hubReferences || []).length === 0,
    },
    libraryIntegrity,
    issues,
    // A VR run's evidence image is the eye capture: what the headset would have
    // shown. It is also what the run saves as preview.png, because a DOM
    // screenshot of a full-viewport WebGL canvas shows nothing at all.
    screenshot: null,
    eyeCapture: xr.report?.captures?.at(-1)?.dataUrl || null,
  };
}

/** Keep the persisted report small: the per-frame series is a sample, not a log. */
function boundedReport(report) {
  const costs = report.frameCosts || [];
  return {
    ...report,
    frameCosts: costs.length > 240 ? costs.slice(0, 240) : costs,
    captures: (report.captures || []).map(({ dataUrl, ...rest }) => rest),
  };
}

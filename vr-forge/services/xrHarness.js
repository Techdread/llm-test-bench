// One place that boots a project with the emulated Quest 3 attached.
//
// Both users of the probe run through here: the validator (off-screen, scripted,
// produces evidence) and the Build view's XR pane (on-screen, driven by hand).
// Keeping them on the same harness is the point — what the user pokes at and
// what the report measures are the same session, not two approximations.

import { readProjectTree } from './previewer.js';
import { buildPreview } from '../../shared/forge/services/previewer.js';
import { XR_PROBE_DEFAULTS, loadEmulatorSource, xrProbeSource } from './xrProbe.js';

/**
 * @param {FileSystemDirectoryHandle} projectHandle
 * @param {object} options
 * @param {HTMLElement} [options.mount]  where to put the frame; off-screen when omitted
 * @param {Function} [options.onEvent]   every probe message, as it arrives
 * @returns {Promise<{ok, reason?, send, waitFor, state, dispose, url}>}
 */
export async function createXrHarness(projectHandle, {
  mount = null, manifest = null, config = XR_PROBE_DEFAULTS, onEvent = null, fetchImpl,
} = {}) {
  const token = `vrx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let emulator;
  try {
    emulator = await loadEmulatorSource(fetchImpl);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  const files = await readProjectTree(projectHandle);
  const preview = await buildPreview(projectHandle, {
    files,
    entry: manifest?.entry || null,
    bootstrap: [emulator, xrProbeSource(token, config)],
  });
  if (!preview.ok) return { ok: false, reason: `Preview could not be assembled (${preview.reason}).` };

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  // Harmless with the emulator installed, and correct if this ever runs on a
  // machine with a real headset attached.
  frame.setAttribute('allow', 'xr-spatial-tracking');
  if (mount) {
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000;';
    mount.appendChild(frame);
  } else {
    // Off-screen, but laid out and composited: a display:none or detached frame
    // gets no requestAnimationFrame, and the whole lane depends on the loop
    // actually running.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;opacity:0;pointer-events:none;border:0;';
    document.body.appendChild(frame);
  }

  const state = {
    installed: false, entered: null, report: null, fatal: null,
    frames: 0, lastCostMs: null, session: null,
  };
  const waiters = new Set();

  const onMessage = (event) => {
    const data = event.data;
    if (!data || data.__vrForgeXr !== token) return;
    switch (data.kind) {
      case 'installed': state.installed = true; break;
      case 'entered': state.entered = { via: data.via, exact: data.exact }; break;
      case 'session': state.session = { ...data.request, granted: data.granted }; break;
      case 'progress': state.frames = data.frames; state.lastCostMs = data.cost; break;
      case 'report': state.report = data.report; break;
      case 'ended': state.ended = true; break;
      case 'fatal': state.fatal = data.message; break;
      default: break;
    }
    onEvent?.(data, state);
    for (const waiter of [...waiters]) waiter();
  };
  window.addEventListener('message', onMessage);

  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  frame.src = preview.url;
  await loaded;

  const send = (cmd, args = {}) => frame.contentWindow?.postMessage({ __vrForgeCmd: token, cmd, args }, '*');

  /** Resolve true when `predicate()` holds, false on timeout. */
  const waitFor = (predicate, timeoutMs) => new Promise((resolve) => {
    if (predicate()) { resolve(true); return; }
    const check = () => { if (predicate()) { cleanup(); resolve(true); } };
    const cleanup = () => { clearTimeout(timer); clearInterval(poll); waiters.delete(check); };
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const poll = setInterval(check, 60);
    waiters.add(check);
  });

  return {
    ok: true,
    frame,
    url: preview.url,
    state,
    send,
    waitFor,
    dispose() {
      window.removeEventListener('message', onMessage);
      frame.remove();
      preview.revoke?.();
    },
  };
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

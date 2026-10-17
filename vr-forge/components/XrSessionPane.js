import { html } from 'htm/preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createXrHarness } from '../services/xrHarness.js';
import { XR_PROBE_DEFAULTS, summarizeXrReport } from '../services/xrProbe.js';

/**
 * The emulated Quest 3, live and on screen.
 *
 * This is the same harness the validator drives, so what you poke at here is
 * what the report measures. It is an emulator: it proves a project enters an
 * immersive session and renders two different eye views, and it says nothing
 * about how the thing performs on the actual device.
 */
export function XrSessionPane({ projectHandle, manifest, nonce = 0, running = false }) {
  const mountRef = useRef(null);
  const harnessRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | booting | ready | entered | error
  const [reason, setReason] = useState('');
  const [live, setLive] = useState({ frames: 0, cost: null });
  const [summary, setSummary] = useState(null);
  const [inputMode, setInputMode] = useState('controller');

  const teardown = useCallback(() => {
    harnessRef.current?.dispose();
    harnessRef.current = null;
    setLive({ frames: 0, cost: null });
    setSummary(null);
    setStatus('idle');
    setReason('');
  }, []);

  useEffect(() => teardown, [teardown]);
  // A rebuilt project is a different project: drop the session rather than
  // leaving a stale one running against files that no longer exist.
  useEffect(() => { if (harnessRef.current) teardown(); }, [projectHandle, nonce, teardown]);

  const boot = useCallback(async () => {
    if (!projectHandle || harnessRef.current) return;
    setStatus('booting'); setReason('');
    const harness = await createXrHarness(projectHandle, {
      mount: mountRef.current,
      manifest,
      config: XR_PROBE_DEFAULTS,
      onEvent: (event, state) => {
        if (event.kind === 'progress') setLive({ frames: state.frames, cost: event.cost });
        if (event.kind === 'entered') setStatus(event.via ? 'entered' : 'ready');
        if (event.kind === 'report') setSummary(summarizeXrReport(event.report));
        if (event.kind === 'fatal') { setStatus('error'); setReason(event.message); }
      },
    });
    if (!harness.ok) { setStatus('error'); setReason(harness.reason); return; }
    harnessRef.current = harness;
    const installed = await harness.waitFor(() => harness.state.installed || harness.state.fatal, 5000);
    setStatus(installed && !harness.state.fatal ? 'ready' : 'error');
    if (!installed) setReason('The emulator installed, but the project never loaded it.');
  }, [projectHandle, manifest]);

  const send = (cmd, args) => harnessRef.current?.send(cmd, args);
  const enterSession = () => send('enter', { selector: manifest?.xr?.entryControl || '[data-forge-id="enter-xr"]' });
  const pressTrigger = (value) => send('press', { hand: 'right', button: 'trigger', value });
  const report = async () => {
    send('report');
    await harnessRef.current?.waitFor(() => harnessRef.current?.state.report, 1500);
    const raw = harnessRef.current?.state.report;
    if (raw) setSummary(summarizeXrReport(raw));
  };

  const entered = status === 'entered';
  return html`
    <div class="vr-xr-pane">
      <div class="vr-pane-bar">
        <span><i class="fas fa-vr-cardboard"></i> Emulated Quest 3</span>
        <div class="vr-pane-actions">
          ${status === 'idle'
            ? html`<button class="gf-btn" disabled=${!projectHandle} onClick=${boot}
                title="Boot the project against an emulated Quest 3 in this page">
                <i class="fas fa-play"></i> Start emulator</button>`
            : html`<button class="gf-btn" onClick=${teardown} title="Tear the emulated session down">
                <i class="fas fa-stop"></i> Stop</button>`}
          ${status !== 'idle' && html`
            <button class="gf-btn" disabled=${status === 'booting'} onClick=${enterSession}
              title=${`Click the project's declared entry control (${manifest?.xr?.entryControl || '[data-forge-id="enter-xr"]'})`}>
              <i class="fas fa-door-open"></i> Enter XR</button>`}
        </div>
      </div>

      <div class="vr-xr-stage" ref=${mountRef}>
        ${status === 'idle' && html`<div class="gf-preview-msg">
          ${projectHandle ? 'Start the emulator to enter an immersive session without a headset.' : 'Build a project to run it here.'}
        </div>`}
        ${status === 'booting' && html`<div class="gf-preview-msg"><i class="fas fa-spinner fa-spin"></i> Installing the emulated device…</div>`}
        ${status === 'error' && html`<div class="gf-preview-msg vr-bad"><i class="fas fa-triangle-exclamation"></i> ${reason}</div>`}
      </div>

      ${status !== 'idle' && status !== 'error' && html`
        <div class="vr-xr-controls">
          <div class="vr-xr-stats">
            <span title="Frames presented through XRSession.requestAnimationFrame"><b>${live.frames}</b> XR frames</span>
            <span title="Time spent inside the project's own frame callback — the honest half of the measurement">
              <b>${live.cost == null ? '—' : `${live.cost} ms`}</b> callback</span>
            ${summary && html`<span class=${summary.stereo?.ok ? 'vr-good' : 'vr-bad'}>
              <b>${summary.stereo?.views || 0}</b> views${summary.stereo?.separationM ? ` · ${(summary.stereo.separationM * 100).toFixed(1)} cm apart` : ''}</span>`}
          </div>
          <div class="vr-xr-inputs">
            <button class="gf-btn" disabled=${!entered}
              onMouseDown=${() => pressTrigger(1)} onMouseUp=${() => pressTrigger(0)} onMouseLeave=${() => pressTrigger(0)}
              title="Hold to press the emulated right trigger">
              <i class="fas fa-hand-pointer"></i> Trigger</button>
            <button class="gf-btn" disabled=${!entered} onClick=${() => send('axes', { hand: 'right', x: 0, y: -1 })}
              title="Push the right thumbstick forward">
              <i class="fas fa-arrow-up"></i> Stick</button>
            <button class="gf-btn" disabled=${!entered} onClick=${() => send('recenter')}
              title="Recentre the emulated headset"><i class="fas fa-crosshairs"></i> Recentre</button>
            <label class="gf-toggle" title="Quest 3 reports either controllers or hands as the primary input">
              <input type="checkbox" checked=${inputMode === 'hand'} onChange=${(e) => {
                const mode = e.target.checked ? 'hand' : 'controller';
                setInputMode(mode); send('inputMode', { mode });
              }} />
              <i class="fas fa-hand"></i> Hands
            </label>
            <button class="gf-btn" onClick=${report} title="Read the session report so far">
              <i class="fas fa-clipboard-check"></i> Snapshot</button>
          </div>
        </div>`}

      ${summary && html`
        <div class="vr-xr-summary">
          <span class=${summary.granted ? 'vr-good' : 'vr-bad'}>
            ${summary.granted ? `Session granted · ${summary.mode}` : 'No session was granted'}</span>
          ${summary.requiredFeatures?.length ? html`<span>required: ${summary.requiredFeatures.join(', ')}</span>` : ''}
          <span>${summary.frames} frames · mean ${summary.meanFrameCostMs ?? '—'} ms · p95 ${summary.p95FrameCostMs ?? '—'} ms</span>
          ${summary.selectEvents ? html`<span>${summary.selectEvents} select events</span>` : ''}
          ${summary.hapticPulses ? html`<span>${summary.hapticPulses} haptic pulses</span>` : ''}
        </div>`}

      <p class="vr-honesty">
        <i class="fas fa-circle-info"></i>
        An emulator, not a headset: it proves the project enters immersive mode and renders two different eye
        views, and measures the project's own per-frame cost. Frame <em>rate</em> here is this browser's, so it
        says nothing about performance on a Quest 3${running ? ' — and the build is still writing files.' : '.'}
      </p>
    </div>`;
}

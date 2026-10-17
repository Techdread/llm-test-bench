import { html } from 'htm/preact';
import { formatBudget } from '../services/budgets.js';

const META = {
  created: ['fa-circle', 'Created'],
  generating: ['fa-wand-magic-sparkles', 'Generating'],
  stopped: ['fa-stop', 'Generation stopped'],
  validating: ['fa-magnifying-glass fa-spin', 'Validating'],
  passed: ['fa-circle-check', 'Passed'],
  warned: ['fa-triangle-exclamation', 'Passed with warnings'],
  failed: ['fa-circle-xmark', 'Failed validation'],
};

export function ValidationPanel({
  lifecycleStatus, stopReason, validation, budget, onExplain, onHeal, running = false,
}) {
  const [icon, label] = META[lifecycleStatus] || META.created;
  const issues = validation?.issues || [];
  const remaining = budget?.remaining;
  // Only offer a heal where there is something to work from: a run that failed
  // or warned AND actually wrote files. Healing an empty project is asking the
  // backend to build from nothing, which is a build, not a repair.
  const healable = Boolean(onHeal)
    && ['failed', 'warned'].includes(lifecycleStatus)
    && (validation?.structure?.fileCount || 0) > 0;
  return html`
    <div class=${`gf-trust gf-trust-${lifecycleStatus || 'created'}`}>
      <div class="gf-trust-head">
        <span class="gf-status-pill"><i class=${`fas ${icon}`}></i> ${label}</span>
        ${stopReason && html`<span class="gf-stop-reason">stop: ${stopReason}</span>`}
        ${validation?.structure && html`
          <span>${validation.structure.fileCount} files · ${(validation.structure.totalBytes / 1024).toFixed(1)} KB · ${validation.structure.checkedReferences} refs checked</span>`}
        ${healable && html`
          <button class="gf-btn gf-heal-btn" disabled=${running} onClick=${onHeal}
            title="Copy this run into a new one and ask the backend to fix the recorded failures. This run is never modified.">
            <i class="fas fa-kit-medical"></i> Heal
          </button>`}
      </div>
      ${remaining && html`
        <div class="gf-budget-remaining">
          Remaining:
          <span>${formatBudget(remaining.turns)} turns</span>
          <span>${formatBudget(remaining.files)} files</span>
          <span>${formatBudget(remaining.bytes, n => (n / 1024 / 1024).toFixed(2))} MB</span>
          <span>${formatBudget(remaining.images)} images</span>
          <span>${formatBudget(remaining.tokens)} tokens</span>
        </div>`}
      ${budget?.decision && budget.decision.allowed === false && html`
        <div class="gf-trust-issue error"><i class="fas fa-ban"></i> ${budget.decision.reason}</div>`}
      ${validation?.xr && html`<${XrEvidence} xr=${validation.xr} eyeCapture=${validation.eyeCapture} />`}
      ${validation?.hub && (validation.hub.used?.length || validation.hub.declared?.length) && html`
        <div class="vr-hub-row">
          <i class=${`fas ${validation.hub.portable ? 'fa-box' : 'fa-plug'}`}></i>
          ${validation.hub.portable
            ? html`<span>Hub services offered (${validation.hub.declared.join(', ')}) but never called — the project is portable.</span>`
            : html`<span><b>Hub-bound:</b> calls ${validation.hub.used.join(', ')} at runtime. It runs inside this hub; exported on its own it loses those features.</span>`}
        </div>`}
      ${issues.length > 0 && html`
        <details class="gf-validation-details" open=${lifecycleStatus === 'failed'}>
          <summary>${issues.length} validation issue${issues.length === 1 ? '' : 's'}</summary>
          ${issues.map(item => html`
            <div class=${`gf-trust-issue ${item.severity}`}>
              <i class=${`fas ${item.severity === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}`}></i>
              <span><b>${item.code}</b> — ${item.message}</span>
              ${onExplain && html`<button class="gf-btn gf-explain-btn" onClick=${() => onExplain(item)}>
                <i class="fas fa-robot"></i> Explain
              </button>`}
            </div>`)}
        </details>`}
    </div>`;
}

/**
 * The VR-specific half of a report: what the emulated session did.
 *
 * Deliberately states its own limits — a badge that says "verified" without
 * saying verified *how* is how a Forge starts lying.
 */
function XrEvidence({ xr, eyeCapture }) {
  if (!xr) return null;
  if (!xr.ran) {
    return html`<div class="gf-trust-issue error vr-xr-evidence">
      <i class="fas fa-vr-cardboard"></i>
      <span><b>No XR evidence</b> — ${xr.reason || 'the emulated session did not run.'}</span>
    </div>`;
  }
  const s = xr.summary || {};
  const stereo = s.stereo || {};
  const chip = (ok, label, title) => html`<span class=${ok ? 'vr-good' : 'vr-bad'} title=${title}>
    <i class=${`fas ${ok ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i> ${label}</span>`;
  return html`
    <div class="vr-xr-evidence">
      <div class="vr-xr-evidence-row">
        ${chip(s.granted, s.granted ? `session · ${s.mode}` : 'no session', 'Whether an immersive session was granted')}
        ${chip(s.frames >= (s.targetFrames || 120), `${s.frames} frames`, 'Frames presented through XRSession.requestAnimationFrame')}
        ${chip(stereo.ok, stereo.ok ? `stereo · ${(stereo.separationM * 100 || 0).toFixed(1)} cm` : `stereo failed (${stereo.reason || 'unknown'})`,
          'Two views with different transforms — not one view shown to both eyes')}
        ${s.p95FrameCostMs != null && html`<span class=${s.p95FrameCostMs > (s.frameBudgetMs || 13.9) ? 'vr-warn' : 'vr-good'}
          title="Time inside the project's own frame callback. Emulated frame RATE is this browser's, so only the cost is meaningful.">
          <i class="fas fa-gauge-high"></i> p95 ${s.p95FrameCostMs} ms</span>`}
        ${s.distinctColors != null && html`<span class=${s.distinctColors >= 3 ? 'vr-good' : 'vr-bad'}
          title="Distinct colours read back from the eye framebuffer"><i class="fas fa-eye"></i> ${s.distinctColors} colours</span>`}
        ${s.selectEvents ? html`<span title="select events the project received"><i class="fas fa-hand-pointer"></i> ${s.selectEvents}</span>` : ''}
        ${s.hapticPulses ? html`<span title="haptic pulses requested"><i class="fas fa-wave-square"></i> ${s.hapticPulses}</span>` : ''}
      </div>
      ${eyeCapture && html`<img class="vr-eye-capture" src=${eyeCapture} alt="Left eye capture from the emulated session" />`}
      <div class="vr-xr-evidence-note">
        Emulator-verified on an emulated Quest 3${xr.entered?.exact === false ? ` (entry control found by fallback: ${xr.entered.via})` : ''}.
        Nothing here measures on-device performance, comfort or tracking.
        ${xr.device?.opened ? ' Opened on the headset — that is provenance, not evidence.' : ''}
      </div>
    </div>`;
}

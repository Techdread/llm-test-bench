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

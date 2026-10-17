import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  UNLIMITED_KEYS, defaultBudgets, isUnlimitedBudget,
  normalizeBudgets as sharedNormalize, validateBudgets,
} from '../services/budgets.js';

// Every Forge's Build budgets dialog. Each field has a "No limit" toggle: time
// budgets store 0, count/size budgets store Infinity, cost stores null. There
// are no ceilings — type whatever number you want.
export const BUDGET_FIELDS = [
  ['maxTurns', 'Model turns', 1],
  ['maxAgentSeconds', 'Agent time (seconds)', 10],
  ['idleTimeoutSeconds', 'Idle timeout (seconds)', 10],
  ['maxFiles', 'Files', 1],
  ['maxTotalBytes', 'Project bytes', 1024],
  ['maxFileBytes', 'Single-file bytes', 256],
  ['maxImages', 'Generated images', 1],
  ['maxImagePixels', 'Total image pixels', 1024],
  ['maxTokens', 'Total input + output tokens', 100],
  ['maxNativeSeconds', 'Native validation seconds', 1],
  ['maxCostUsd', 'Maximum cost (USD)', 0.01],
];

/** BUDGET_FIELDS minus the image budgets, for Forges that never generate images. */
export const BUDGET_FIELDS_NO_IMAGES = BUDGET_FIELDS
  .filter(([key]) => key !== 'maxImages' && key !== 'maxImagePixels');

function initialDraft(value, fields) {
  const defaults = defaultBudgets();
  const numbers = {}, unlimited = {};
  for (const [key] of fields) {
    unlimited[key] = isUnlimitedBudget(key, value[key]);
    // An unlimited field still shows a sensible number to come back to.
    numbers[key] = unlimited[key] ? (defaults[key] ?? 1) : value[key];
  }
  return { numbers, unlimited };
}

export function BudgetDialog({
  value, onSave, onClose, fields = BUDGET_FIELDS, normalize = sharedNormalize, intro,
}) {
  const [draft, setDraft] = useState(() => initialDraft(value, fields));
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);

  const setNumber = (key, next) => setDraft(d => ({ ...d, numbers: { ...d.numbers, [key]: next } }));
  const setUnlimited = (key, next) => setDraft(d => ({ ...d, unlimited: { ...d.unlimited, [key]: next } }));

  const save = () => {
    const out = { ...value };
    for (const [key] of fields) {
      if (!draft.unlimited[key]) out[key] = draft.numbers[key];
      else out[key] = key === 'maxCostUsd' ? null : UNLIMITED_KEYS.includes(key) ? 0 : Infinity;
    }
    const found = validateBudgets(out);
    setErrors(found);
    if (!found.length) onSave(normalize(out));
  };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-budget-dialog" onClick=${event => event.stopPropagation()}>
        <div class="gf-batch-head">
          <h2><i class="fas fa-gauge-high"></i> Build budgets</h2>
          <button class="gf-icon-btn" onClick=${onClose}><i class="fas fa-xmark"></i></button>
        </div>
        <p class="gf-muted">${intro || 'Hard limits are enforced by the in-app tools and by the local agent bridge. They are saved for future builds and copied into every run.'}</p>
        <p class="gf-muted">There are no maximums: type any number, or tick <b>No limit</b> to switch a budget off. With everything off, a build ends when the model reports done, when loop detection sees it stuck, or when you press <b>Cancel</b> / <b>Hard stop</b>. Cost is still recorded and shown for every generation either way.</p>
        <div class="gf-budget-grid">
          ${fields.map(([key, label, step]) => {
            const off = !!draft.unlimited[key];
            return html`
              <div class=${`gf-budget-field${off ? ' gf-budget-unlimited' : ''}`} key=${key}>
                <span>${label}</span>
                <div class="forge-limit">
                  <input type="number" min="0" step=${step} value=${off ? '' : draft.numbers[key]}
                    placeholder=${off ? 'no limit' : ''} disabled=${off} aria-label=${label}
                    onInput=${event => setNumber(key, event.target.value)} />
                  <label class="forge-limit-none">
                    <input type="checkbox" checked=${off} onChange=${event => setUnlimited(key, event.target.checked)} />
                    No limit
                  </label>
                </div>
              </div>`;
          })}
        </div>
        ${errors.length > 0 && html`
          <div class="gf-warn">${errors.map(error => html`<div>${error}</div>`)}</div>`}
        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${onClose}>Cancel</button>
          <button class="gf-btn gf-primary" onClick=${save}>Save budgets</button>
        </div>
      </div>
    </div>`;
}

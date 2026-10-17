import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { useDialogDismiss } from './useDialogDismiss.js';
import { JOINT_NAMES, validateHumanoid } from '../services/humanoid.js';

const AXES = ['X', 'Y', 'Z'];

/**
 * Edit the 18 joint positions by hand and save a new version.
 *
 * Validation runs on Apply, not on every keystroke: a rig is inconsistent for
 * most of the time you spend editing it, and refusing input mid-edit makes it
 * impossible to move a joint past another one.
 */
export function RigDialog({ joints, onClose, onApply, canReview }) {
  const [values, setValues] = useState(() => Object.fromEntries(
    JOINT_NAMES.map(name => [name, [...(joints?.[name] || [0, 0, 0])]]),
  ));
  const [error, setError] = useState('');
  // Escape or the buttons, never a backdrop click: this dialog holds 54
  // hand-typed numbers, and a stray click outside it would discard the lot.
  useDialogDismiss(onClose);

  const set = (name, axis, raw) => {
    setValues(current => {
      const next = { ...current, [name]: [...current[name]] };
      next[name][axis] = raw;
      return next;
    });
  };

  const apply = () => {
    const parsed = {};
    for (const name of JOINT_NAMES) {
      const point = values[name].map(Number);
      if (point.some(n => !Number.isFinite(n))) { setError(`${name} needs three numbers.`); return; }
      parsed[name] = point;
    }
    const rig = { type: 'humanoid', joints: parsed };
    try {
      validateHumanoid(rig);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }
    onApply(rig);
  };

  return html`
    <div class="us-modal-backdrop">
      <div class="us-modal">
        <h2>Adjust humanoid joints</h2>
        <p class="us-note">
          Joint positions use the character's own coordinates: X left/right (anatomical left is +X),
          Y up, Z front/back. Apply rebuilds the rig and saves a new version.
          ${canReview
            ? ' The selected model will review its movement.'
            : ' No model is selected, so the new version stays explicitly unreviewed.'}
        </p>
        <div class="us-joints">
          ${JOINT_NAMES.map(name => html`
            <div class="us-joint" key=${name}>
              <span title=${name}>${name}</span>
              ${AXES.map((axis, index) => html`
                <input key=${axis} type="number" step="0.01" aria-label=${`${name} ${axis}`}
                       value=${values[name][index]}
                       onInput=${event => set(name, index, event.target.value)} />`)}
            </div>`)}
        </div>
        ${error && html`<div class="us-error" style="border-radius:6px">${error}</div>`}
        <div class="us-card-actions" style="margin-top:12px">
          <button class="us-btn us-primary" onClick=${apply}>
            ${canReview ? 'Apply & review rig' : 'Apply rig · save unreviewed'}
          </button>
          <button class="us-btn" onClick=${onClose}>Cancel</button>
        </div>
      </div>
    </div>`;
}

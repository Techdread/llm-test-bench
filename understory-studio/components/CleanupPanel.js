import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  CLEANUP_LEVELS, COMMON_POSE_CLIPS, describeHidden, describeSimplify, describeWeld,
} from '../services/meshCleanup.js';

const LEVEL_LABELS = { master: 'Master', lod0: 'LOD 0', lod1: 'LOD 1', lod2: 'LOD 2', lod3: 'LOD 3' };
const STEP_LABELS = { weld: 'welding seams', hidden: 'removing hidden triangles', simplify: 'simplifying' };

/** A 0–1 strength slider that commits on release (the rebuild is not free)
 *  but shows its value live while dragging. */
function Strength({ value, onCommit, disabled, low, high, describe }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return html`
    <div class="us-strength">
      <input type="range" min="0" max="100" step="5" value=${Math.round(draft * 100)} disabled=${disabled}
             aria-label=${`Strength, ${low} to ${high}`}
             onInput=${e => setDraft(Number(e.target.value) / 100)}
             onChange=${e => onCommit(Number(e.target.value) / 100)} />
      <div class="us-strength-scale"><span>${low}</span><span>${high}</span></div>
      <p class="us-note">${describe(draft)}</p>
    </div>`;
}

function progressText(progress) {
  if (!progress) return 'Starting…';
  const level = LEVEL_LABELS[progress.level] || progress.level || '';
  const step = STEP_LABELS[progress.step] || 'preparing';
  const poses = progress.step === 'hidden' && progress.poses > 1
    ? ` · pose ${Math.min(progress.pose + 1, progress.poses)} of ${progress.poses}` : '';
  const levels = progress.levels > 1 ? ` · ${progress.done} of ${progress.levels} levels done` : '';
  return `${level ? `${level} · ` : ''}${step}${poses}${levels}`;
}

/**
 * The switchable triangle clean-up for the selected version: three steps in a
 * fixed order, each with an on/off and a strength. Settings live on the
 * version; the geometry is always derived, so the originals stay intact.
 */
export function CleanupPanel({
  settings, onChange, disabled, rigging,
  running, progress, summary, error, onCancel,
  variant, onVariant,
}) {
  const set = (step, patch) => onChange({ ...settings, [step]: { ...settings[step], ...patch } });
  const off = disabled || !settings.enabled;
  const perLevel = Boolean(settings.simplify.levels);

  return html`
    <div class="us-section us-cleanup">
      <h3>Triangle clean-up</h3>
      <label class="us-check">
        <input type="checkbox" checked=${settings.enabled} disabled=${disabled}
               onChange=${e => onChange({ ...settings, enabled: e.target.checked })} />
        Clean up this version
      </label>
      <p class="us-note">
        Builds cleaned copies of every level beside the originals. The original Master and LODs are never
        changed; switch this off and you see exactly what was generated.
      </p>

      ${settings.enabled && html`
        <div class="us-seg" role="group" aria-label="Show in viewport">
          ${[['original', 'Original'], ['cleaned', 'Cleaned']].map(([id, label]) => html`
            <button key=${id} class=${`us-seg-btn ${variant === id ? 'active' : ''}`}
                    disabled=${disabled || (id === 'cleaned' && !summary)}
                    onClick=${() => onVariant(id)}>${label}</button>`)}
        </div>

        <ol class="us-steps">
          <li>
            <label class="us-check">
              <input type="checkbox" checked=${settings.weld.enabled || settings.simplify.enabled}
                     disabled=${off || settings.simplify.enabled}
                     onChange=${e => set('weld', { enabled: e.target.checked })} />
              Weld seams
            </label>
            ${settings.simplify.enabled && html`<p class="us-note">Always on while Simplify is on — without it, seams tear open.</p>`}
            <${Strength} value=${settings.weld.strength} disabled=${off || !(settings.weld.enabled || settings.simplify.enabled)}
                         low="Tight" high="Loose" describe=${describeWeld}
                         onCommit=${strength => set('weld', { strength })} />
          </li>

          <li>
            <label class="us-check">
              <input type="checkbox" checked=${settings.hidden.enabled} disabled=${off}
                     onChange=${e => set('hidden', { enabled: e.target.checked })} />
              Remove hidden triangles
            </label>
            <${Strength} value=${settings.hidden.strength} disabled=${off || !settings.hidden.enabled}
                         low="Careful" high="Thorough" describe=${describeHidden}
                         onCommit=${strength => set('hidden', { strength })} />
            ${rigging === 'animated' && html`
              <label class="us-field">Poses a triangle must stay hidden in
                <select value=${settings.hidden.poses} disabled=${off || !settings.hidden.enabled}
                        onChange=${e => set('hidden', { poses: e.target.value })}>
                  <option value="common">Rest + ${COMMON_POSE_CLIPS.length} wide-range clips (4 frames each)</option>
                  <option value="all">Rest + all 87 clips (slow)</option>
                </select>
              </label>`}
            ${rigging === 'mixamo' && html`
              <p class="us-note us-warn">
                This character is rigged later, in Mixamo, so its poses cannot be checked here. A joint buried at
                rest can show once it bends — keep this near Careful, or leave it off.
              </p>`}
          </li>

          <li>
            <label class="us-check">
              <input type="checkbox" checked=${settings.simplify.enabled} disabled=${off}
                     onChange=${e => set('simplify', { enabled: e.target.checked })} />
              Simplify
            </label>
            <${Strength} value=${settings.simplify.strength} disabled=${off || !settings.simplify.enabled || perLevel}
                         low="Light" high="Strong" describe=${s => `${describeSimplify(s)} at Master; heavier on lower levels`}
                         onCommit=${strength => set('simplify', { strength })} />
            <label class="us-check">
              <input type="checkbox" checked=${perLevel} disabled=${off || !settings.simplify.enabled}
                     onChange=${e => set('simplify', {
                       levels: e.target.checked
                         ? Object.fromEntries(CLEANUP_LEVELS.map(id => [id, settings.simplify.strength]))
                         : null,
                     })} />
              Set each level separately
            </label>
            ${perLevel && CLEANUP_LEVELS.map((id, index) => html`
              <div key=${id} class="us-level-strength">
                <span>${LEVEL_LABELS[id]}</span>
                <${Strength} value=${settings.simplify.levels[id]} disabled=${off || !settings.simplify.enabled}
                             low="Light" high="Strong" describe=${s => describeSimplify(s, index)}
                             onCommit=${strength => set('simplify', { levels: { ...settings.simplify.levels, [id]: strength } })} />
              </div>`)}
          </li>
        </ol>

        ${running && html`
          <div class="us-cleanup-progress">
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>${progressText(progress)}</span>
            <button class="us-btn us-btn-sm" onClick=${onCancel}>Cancel</button>
          </div>`}
        ${error && html`<p class="us-note us-warn"><i class="fas fa-triangle-exclamation"></i> ${error}</p>`}

        ${summary && html`
          <table class="us-cleanup-table">
            <thead><tr><th>Level</th><th>Original</th><th>Cleaned</th><th></th></tr></thead>
            <tbody>
              ${summary.levels.map(level => html`
                <tr key=${level.id}
                    title=${level.stats ? `Hidden ${level.stats.hidden.toLocaleString()} · simplified ${level.stats.simplified.toLocaleString()} · degenerate ${level.stats.degenerate.toLocaleString()} · ${level.stats.posesChecked > 1 ? `${level.stats.posesChecked} poses checked · ` : ''}${(level.stats.ms / 1000).toFixed(1)}s` : ''}>
                  <td>${level.label}</td>
                  <td>${level.original.toLocaleString()}</td>
                  <td>${level.cleaned.toLocaleString()}</td>
                  <td>−${(100 * (1 - level.cleaned / level.original)).toFixed(0)}%</td>
                </tr>`)}
            </tbody>
          </table>`}
      `}
    </div>`;
}

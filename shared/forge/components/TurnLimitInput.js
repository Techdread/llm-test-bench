import { html } from 'htm/preact';
import { useRef } from 'preact/hooks';

/**
 * A turn cap with an ∞ toggle. `value` is a number, or Infinity for "no turn
 * limit" (JSON writes that as null; normalizeBudgets reads it back as Infinity).
 * There is no maximum: the build still stops when the model reports done, when
 * loop detection fires, or when you press Cancel / Hard stop.
 *
 * The toggle is a button, not a checkbox, so it can sit inside the existing
 * `<label class="gf-maxturns">` wrappers without nesting labels.
 */
export function TurnLimitInput({ value, onChange, min = 1, fallback = 40, disabled = false, inputStyle }) {
  const unlimited = value === Infinity || value === null;
  const lastFinite = useRef(Number.isFinite(Number(value)) && value !== null ? Number(value) : fallback);
  if (!unlimited && Number.isFinite(Number(value))) lastFinite.current = Number(value);

  const onInput = (event) => {
    const n = Math.round(Number(event.target.value));
    if (event.target.value !== '' && Number.isFinite(n)) onChange(Math.max(min, n));
  };
  const toggle = () => onChange(unlimited ? lastFinite.current : Infinity);

  return html`
    <span class="forge-limit">
      <input type="number" min=${min} value=${unlimited ? '' : value} placeholder="∞"
        disabled=${disabled || unlimited} style=${inputStyle} onInput=${onInput} />
      <button type="button" class=${`forge-limit-inf${unlimited ? ' active' : ''}`}
        aria-pressed=${unlimited} disabled=${disabled} onClick=${toggle}
        title=${unlimited ? 'No turn limit — click to set a number again' : 'Remove the turn limit'}>∞</button>
    </span>`;
}

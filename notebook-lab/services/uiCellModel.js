// uiCellModel — the shared value model for UI cells.
//
// Deliberately free of preact/DOM so it can be imported by the runtime
// (to seed defaults on a headless run), the renderer (to coerce/format/clamp
// live values), and the form editors (to keep coercion consistent). The
// geometry-injecting parse used while *editing* lives in UiCellFormEditor;
// this module only cares about the value semantics of controls.

export const NUMERIC_TYPES = new Set(['number', 'slider']);

// Everything except pure display controls binds to an nb variable.
const DISPLAY_TYPES = new Set(['label', 'markdown']);

export function isBoundType(type) {
  return !DISPLAY_TYPES.has(type || 'text');
}

/**
 * Parse the controls + meta straight from a UI cell's JSON source, exactly as
 * authored (no geometry defaults injected). Returns `{ error }` set on bad JSON
 * rather than throwing, so callers can degrade gracefully.
 */
export function parseUiSource(source) {
  const empty = { controls: [], title: '', description: '', width: null, height: null, error: null };
  if (!source || !String(source).trim()) return empty;
  try {
    const parsed = JSON.parse(source);
    return {
      controls: Array.isArray(parsed.controls) ? parsed.controls : [],
      title: parsed.title || '',
      description: parsed.description || '',
      width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : null,
      height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : null,
      error: null,
    };
  } catch (e) {
    return { ...empty, error: e.message || String(e) };
  }
}

export function optionValue(option) {
  return option && typeof option === 'object' ? option.value : option;
}

export function optionLabel(option) {
  return option && typeof option === 'object' ? (option.label ?? option.value) : option;
}

/** True when every option of a select/radio parses as a finite number. */
export function optionsAllNumeric(control) {
  const options = Array.isArray(control.options) ? control.options : [];
  if (options.length === 0) return false;
  return options.every(o => Number.isFinite(Number(optionValue(o))));
}

/** Clamp a numeric value into a control's [min, max], when they are set. */
export function clampToControl(value, control) {
  if (!NUMERIC_TYPES.has(control.type)) return value;
  let v = Number(value);
  if (!Number.isFinite(v)) return v;
  if (Number.isFinite(Number(control.min))) v = Math.max(Number(control.min), v);
  if (Number.isFinite(Number(control.max))) v = Math.min(Number(control.max), v);
  return v;
}

/**
 * Coerce a raw DOM value to the type the control should publish to nb.
 * Numbers are clamped; selects/radios of numeric options become numbers
 * (opt out with `valueType: "string"`, force it with `valueType: "number"`).
 */
export function coerceControlValue(raw, control) {
  const type = control.type || 'text';
  if (type === 'checkbox') return !!raw;
  if (NUMERIC_TYPES.has(type)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      const min = Number(control.min);
      return Number.isFinite(min) ? min : 0;
    }
    return clampToControl(n, control);
  }
  if (type === 'select' || type === 'radio') {
    const wantsNumber = control.valueType === 'number'
      || (control.valueType !== 'string' && optionsAllNumeric(control));
    if (wantsNumber) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return raw;
  }
  return raw;
}

function fallbackFor(type) {
  if (type === 'checkbox') return false;
  if (NUMERIC_TYPES.has(type)) return 0;
  return '';
}

/**
 * The current value a control should display: the bound nb var if present,
 * else the control's own `default`, else a type-appropriate empty value.
 * Sliders/numbers with no bound value fall back to `min` rather than a blank
 * (a range input with value '' silently jumps to its midpoint).
 */
export function displayValue(control, vars) {
  const type = control.type || 'text';
  if (control.bind && Object.prototype.hasOwnProperty.call(vars, control.bind)) {
    return vars[control.bind];
  }
  if (Object.prototype.hasOwnProperty.call(control, 'default')) return control.default;
  if (NUMERIC_TYPES.has(type) && Number.isFinite(Number(control.min))) return Number(control.min);
  return fallbackFor(type);
}

/**
 * Format a value for a *display* surface (slider readout label, readout
 * control). `precision` fixes decimals; `prefix`/`suffix` wrap the text.
 * Non-display uses (input `value`) should use the raw value, not this.
 */
export function formatDisplay(value, control) {
  let text;
  const precision = Number(control.precision);
  if (Number.isFinite(precision) && Number.isFinite(Number(value))) {
    text = Number(value).toFixed(precision);
  } else if (value === null || value === undefined) {
    text = '';
  } else {
    text = String(value);
  }
  if (control.prefix) text = String(control.prefix) + text;
  if (control.suffix) text = text + String(control.suffix);
  return text;
}

/**
 * Seed nb with every control's default that isn't already set. Used by the
 * runtime when a UI cell is "run" so defaults exist even if the cell was never
 * rendered (headless runs, off-screen Run-All). `bridge` needs `hasKey` +
 * `setValue`. Returns the count applied.
 */
export function applyUiDefaults(source, bridge) {
  const { controls, error } = parseUiSource(source);
  if (error) return 0;
  let applied = 0;
  for (const control of controls) {
    if (!control.bind || !isBoundType(control.type)) continue;
    if (bridge.hasKey(control.bind)) continue;
    if (!Object.prototype.hasOwnProperty.call(control, 'default')) continue;
    bridge.setValue(control.bind, coerceControlValue(control.default, control));
    applied += 1;
  }
  return applied;
}

/** Phones narrower than this, and than the form, get the controls in one column. */
export const STACK_CONTROLS_BELOW = 640;

/**
 * Whether a UI cell should drop its pixel layout and stack its controls. A form
 * laid out for 620+ pixels scrolled sideways on a phone, hiding controls off to
 * the right. The designer always keeps the real layout, since it edits x and y.
 */
export function shouldStackControls({ availableWidth = 0, formWidth = 0, designer = false } = {}) {
  return !designer && availableWidth > 0 && availableWidth < STACK_CONTROLS_BELOW && availableWidth < formWidth;
}

/** Control indices in reading order (top to bottom, then left to right), for the stacked layout. */
export function readingOrder(controls = []) {
  return controls
    .map((control, index) => ({ index, y: Number(control?.y) || 0, x: Number(control?.x) || 0 }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index)
    .map((entry) => entry.index);
}

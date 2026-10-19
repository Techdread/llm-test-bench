import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { coerceControlValue, isBoundType } from '../services/uiCellModel.js';

const CONTROL_TYPES = ['label', 'readout', 'text', 'textarea', 'number', 'checkbox', 'select', 'radio', 'slider', 'color', 'date', 'button'];
const DEFAULT_FORM_WIDTH = 720;
const DEFAULT_FORM_HEIGHT = 160;
const GRID_SIZE = 20;
const SURFACE_PAD = GRID_SIZE;

function defaultDefinition() {
  return {
    title: 'Controls',
    description: '',
    width: DEFAULT_FORM_WIDTH,
    height: DEFAULT_FORM_HEIGHT,
    controls: [
      { type: 'text', label: 'Name', bind: 'name', default: '', placeholder: 'Enter value', x: 12, y: 42, width: 220, height: 64 },
      { type: 'slider', label: 'Value', bind: 'value', default: 50, min: 0, max: 100, step: 1, x: 252, y: 42, width: 240, height: 64 },
    ],
  };
}

function defaultGeometry(type, index = 0) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const base = { x: 12 + col * 240, y: 42 + row * 82, width: 220, height: 64 };
  if (type === 'textarea') return { ...base, height: 112 };
  if (type === 'button' || type === 'checkbox' || type === 'label') return { ...base, height: 42 };
  if (type === 'readout') return { ...base, height: 56 };
  if (type === 'radio') return { ...base, height: 84 };
  return base;
}

export function defaultControl(type = 'text', index = 0) {
  const base = { type, label: labelForType(type), ...defaultGeometry(type, index) };
  if (type === 'label') return { ...base, text: 'Helpful instructions for this section.' };
  if (type === 'readout') return { ...base, label: 'Result', bind: 'result', suffix: '' };
  if (type === 'textarea') return { ...base, bind: 'notes', default: '', rows: 4, placeholder: 'Enter notes' };
  if (type === 'number') return { ...base, bind: 'count', default: 0, min: 0, max: 100, step: 1 };
  if (type === 'checkbox') return { ...base, bind: 'enabled', default: false };
  if (type === 'select') return { ...base, bind: 'mode', default: 'balanced', options: ['fast', 'balanced', 'careful'] };
  if (type === 'radio') return { ...base, bind: 'choice', default: 'medium', options: ['low', 'medium', 'high'] };
  if (type === 'slider') return { ...base, bind: 'value', default: 50, min: 0, max: 100, step: 1 };
  if (type === 'color') return { ...base, bind: 'color', default: '#7c3aed' };
  if (type === 'date') return { ...base, bind: 'due_date', default: new Date().toISOString().slice(0, 10) };
  if (type === 'button') return { ...base, bind: 'clicked', value: true, icon: 'fa-bolt' };
  return { ...base, bind: 'value', default: '', placeholder: 'Enter value' };
}

// Grow a definition's surface so every control fits inside it (used after
// add/duplicate/tidy so new controls are never clipped by `overflow: hidden`).
export function growToFit(definition) {
  let maxRight = 240;
  let maxBottom = 100;
  for (const c of definition.controls || []) {
    maxRight = Math.max(maxRight, Number(c.x || 0) + Number(c.width || 220) + SURFACE_PAD);
    maxBottom = Math.max(maxBottom, Number(c.y || 0) + Number(c.height || 64) + SURFACE_PAD);
  }
  return {
    ...definition,
    width: clampNumber(Math.max(definition.width || 0, maxRight), 240, 2000, DEFAULT_FORM_WIDTH),
    height: clampNumber(Math.max(definition.height || 0, maxBottom), 100, 1600, DEFAULT_FORM_HEIGHT),
  };
}

// Grid-pack controls left→right then wrap, keeping each control's own size.
// Pairs with growToFit to give the designer a one-click "clean up this mess".
export function tidyDefinition(definition) {
  const pad = GRID_SIZE;
  const surfaceWidth = definition.width || DEFAULT_FORM_WIDTH;
  let x = pad;
  let y = pad;
  let rowHeight = 0;
  const controls = (definition.controls || []).map((c) => {
    const w = Number(c.width || 220);
    const h = Number(c.height || 64);
    if (x > pad && x + w + pad > surfaceWidth) {
      x = pad;
      y += rowHeight + GRID_SIZE;
      rowHeight = 0;
    }
    const placed = { ...c, x: snap(x), y: snap(y) };
    x += w + GRID_SIZE;
    rowHeight = Math.max(rowHeight, h);
    return placed;
  });
  return { ...definition, controls };
}

// Build the control that replaces `prev` when the user switches its type,
// keeping label, binding, geometry and a compatible default rather than
// resetting everything.
export function controlWithType(prev, newType, index) {
  const base = defaultControl(newType, index);
  const merged = {
    ...base,
    x: prev.x ?? base.x,
    y: prev.y ?? base.y,
    width: prev.width ?? base.width,
    height: prev.height ?? base.height,
  };
  if (prev.label) merged.label = prev.label;
  if (isBoundType(newType) && prev.bind) merged.bind = prev.bind;
  if (Object.prototype.hasOwnProperty.call(prev, 'default')
    && Object.prototype.hasOwnProperty.call(base, 'default')) {
    merged.default = coerceControlValue(prev.default, merged);
  }
  return merged;
}

function labelForType(type) {
  return type.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function parseUiDefinition(source) {
  if (!source?.trim()) return { definition: defaultDefinition(), error: null };
  try {
    const parsed = JSON.parse(source);
    const controls = Array.isArray(parsed.controls) ? parsed.controls : [];
    return {
      definition: {
        title: parsed.title || '',
        description: parsed.description || '',
        width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : DEFAULT_FORM_WIDTH,
        height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : DEFAULT_FORM_HEIGHT,
        controls: controls.map((control, index) => ({
          ...defaultGeometry(control.type || 'text', index),
          ...control,
        })),
      },
      error: null,
    };
  } catch (e) {
    return { definition: defaultDefinition(), error: e.message || String(e) };
  }
}

function cleanControl(control) {
  const next = {};
  for (const [key, value] of Object.entries(control)) {
    if (value === '' || value == null) continue;
    if (key === 'valueType' && value === 'auto') continue; // 'auto' is the implicit default
    if (key === 'action' && value === 'set') continue;     // 'set' is the implicit default
    next[key] = value;
  }
  return next;
}

export function stringifyDefinition(definition) {
  return JSON.stringify({
    title: definition.title || '',
    description: definition.description || '',
    width: clampNumber(definition.width, 240, 2000, DEFAULT_FORM_WIDTH),
    height: clampNumber(definition.height, 100, 1600, DEFAULT_FORM_HEIGHT),
    controls: (definition.controls || []).map(cleanControl),
  }, null, 2);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function snap(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function formatOptions(options) {
  if (!Array.isArray(options)) return '';
  return options.map(option => {
    if (option && typeof option === 'object') return `${option.label ?? option.value}=${option.value ?? option.label}`;
    return String(option);
  }).join('\n');
}

function parseOptions(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const eq = line.indexOf('=');
      if (eq === -1) return line;
      return { label: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
    });
}

function coerceFieldValue(value, field, control) {
  if (field === 'default' && control.type === 'checkbox') return !!value;
  if (field === 'value' && control.type === 'button') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const n = Number(value);
    return value !== '' && Number.isFinite(n) ? n : value;
  }
  if (['default', 'min', 'max', 'step'].includes(field) && ['number', 'slider'].includes(control.type)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (['x', 'y', 'width', 'height'].includes(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  if (field === 'rows') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 4;
  }
  if (field === 'precision') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : ''; // '' → cleanControl drops it (auto precision)
  }
  return value;
}

function isBoundControl(type) {
  return type !== 'label';
}

function controlTitle(control, index) {
  return control.label || control.bind || `${labelForType(control.type || 'text')} ${index + 1}`;
}

export function UiCellFormEditor({ source, onChange, onRawEdit, selectedIndex, onSelectControl }) {
  const [newType, setNewType] = useState('text');
  const { definition, error } = parseUiDefinition(source);

  const commit = (nextDefinition) => onChange(stringifyDefinition(nextDefinition));

  const moveControl = (index, offset) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= definition.controls.length) return;
    const controls = definition.controls.slice();
    const [control] = controls.splice(index, 1);
    controls.splice(nextIndex, 0, control);
    commit({ ...definition, controls });
    onSelectControl(nextIndex);
  };

  const addControl = () => {
    const controls = [...definition.controls, defaultControl(newType, definition.controls.length)];
    commit(growToFit({ ...definition, controls }));
    onSelectControl(controls.length - 1);
  };

  const duplicateControl = (index) => {
    const src = definition.controls[index];
    if (!src) return;
    const copy = { ...src, x: snap(Number(src.x || 0) + GRID_SIZE), y: snap(Number(src.y || 0) + GRID_SIZE) };
    const controls = definition.controls.slice();
    controls.splice(index + 1, 0, copy);
    commit(growToFit({ ...definition, controls }));
    onSelectControl(index + 1);
  };

  return html`
    <div class="ui-form-editor ui-form-editor-compact">
      <div class="ui-form-header">
        <div>
          <strong>${definition.title || 'UI controls'}</strong>
          <span>${definition.description || 'Select a control to edit it in the right panel.'}</span>
        </div>
        <button class="btn btn-small" onClick=${onRawEdit}>
          <i class="fa-solid fa-code"></i> Raw JSON
        </button>
      </div>

      ${error && html`
        <div class="ui-form-warning">Invalid JSON: ${error}. Add or edit a control to replace it with valid UI cell JSON.</div>
      `}

      <div class="ui-control-list">
        ${definition.controls.length === 0
          ? html`<div class="ui-form-empty">No controls yet.</div>`
          : definition.controls.map((control, index) => html`
              <button
                class=${`ui-control-list-item ${selectedIndex === index ? 'active' : ''}`}
                onClick=${() => onSelectControl(index)}
              >
                <span>
                  <i class="fa-solid fa-sliders"></i>
                  ${controlTitle(control, index)}
                </span>
                <small>${labelForType(control.type || 'text')}${control.bind ? ` · ${control.bind}` : ''}</small>
              </button>
              <div class="ui-control-list-actions">
                <button class="btn-icon" title="Move up" disabled=${index === 0} onClick=${() => moveControl(index, -1)}>
                  <i class="fa-solid fa-arrow-up"></i>
                </button>
                <button class="btn-icon" title="Move down" disabled=${index === definition.controls.length - 1} onClick=${() => moveControl(index, 1)}>
                  <i class="fa-solid fa-arrow-down"></i>
                </button>
                <button class="btn-icon" title="Duplicate control" onClick=${() => duplicateControl(index)}>
                  <i class="fa-solid fa-clone"></i>
                </button>
                <button
                  class="btn-icon"
                  title="Remove control"
                  onClick=${() => {
                    commit({ ...definition, controls: definition.controls.filter((_, i) => i !== index) });
                    onSelectControl(Math.max(0, index - 1));
                  }}
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            `)
        }
      </div>

      <div class="ui-form-add-row">
        <select value=${newType} onChange=${(e) => setNewType(e.currentTarget.value)}>
          ${CONTROL_TYPES.map(type => html`<option value=${type}>${labelForType(type)}</option>`)}
        </select>
        <button class="btn" onClick=${addControl}>
          <i class="fa-solid fa-plus"></i> Add control
        </button>
      </div>
    </div>
  `;
}

export function UiFormPanel({ cell, selectedIndex, onChange, onSelectControl }) {
  const [newType, setNewType] = useState('text');
  const { definition, error } = parseUiDefinition(cell?.source || '');
  const control = definition.controls[selectedIndex] || null;

  if (!cell) {
    return html`<div class="variables-empty">Select a UI cell to edit its controls.</div>`;
  }

  const commit = (nextDefinition) => onChange(cell.id, { source: stringifyDefinition(nextDefinition) });
  const updateMeta = (field, value) => commit({ ...definition, [field]: value });
  const addControl = () => {
    const controls = [...definition.controls, defaultControl(newType, definition.controls.length)];
    commit(growToFit({ ...definition, controls }));
    onSelectControl(controls.length - 1);
  };
  const duplicateControl = () => {
    if (!control) return;
    const copy = { ...control, x: snap(Number(control.x || 0) + GRID_SIZE), y: snap(Number(control.y || 0) + GRID_SIZE) };
    const controls = definition.controls.slice();
    controls.splice(selectedIndex + 1, 0, copy);
    commit(growToFit({ ...definition, controls }));
    onSelectControl(selectedIndex + 1);
  };
  const tidy = () => commit(growToFit(tidyDefinition(definition)));
  const removeControl = () => {
    if (!control) return;
    const controls = definition.controls.filter((_, index) => index !== selectedIndex);
    commit({ ...definition, controls });
    onSelectControl(Math.max(0, selectedIndex - 1));
  };
  const updateControl = (nextControl) => {
    if (!control) return;
    const controls = definition.controls.slice();
    controls[selectedIndex] = nextControl;
    commit({ ...definition, controls });
  };
  const update = (field, value) => updateControl({ ...control, [field]: coerceFieldValue(value, field, control) });

  return html`
    <div class="ui-side-form">
      ${error && html`<div class="ui-form-warning">Invalid JSON: ${error}</div>`}

      ${definition.controls.length > 0 && html`
        <label>
          <span>Control</span>
          <select value=${selectedIndex} onChange=${(e) => onSelectControl(Number(e.currentTarget.value))}>
            ${definition.controls.map((item, index) => html`
              <option value=${index}>${controlTitle(item, index)}</option>
            `)}
          </select>
        </label>
      `}

      ${control ? html`
        <label>
          <span>Label</span>
          <input type="text" value=${control.label || ''} onInput=${(e) => update('label', e.currentTarget.value)} />
        </label>

        ${isBoundControl(control.type || 'text') && html`
          <label>
            <span>Variable</span>
            <input type="text" value=${control.bind || ''} placeholder="nb variable name" onInput=${(e) => update('bind', e.currentTarget.value)} />
          </label>
        `}

        <div class="ui-side-inline">
          <label>
            <span>X</span>
            <input type="number" min="0" step=${GRID_SIZE} value=${control.x ?? 0} onInput=${(e) => update('x', snap(e.currentTarget.value))} />
          </label>
          <label>
            <span>Y</span>
            <input type="number" min="0" step=${GRID_SIZE} value=${control.y ?? 0} onInput=${(e) => update('y', snap(e.currentTarget.value))} />
          </label>
        </div>
        <div class="ui-side-inline">
          <label>
            <span>Width</span>
            <input type="number" min="40" step=${GRID_SIZE} value=${control.width ?? 220} onInput=${(e) => update('width', snap(e.currentTarget.value))} />
          </label>
          <label>
            <span>Height</span>
            <input type="number" min="24" step=${GRID_SIZE} value=${control.height ?? 64} onInput=${(e) => update('height', snap(e.currentTarget.value))} />
          </label>
        </div>

        <div class="ui-side-control-actions">
          <button class="btn" disabled=${!control} onClick=${duplicateControl} title="Duplicate this control">
            <i class="fa-solid fa-clone"></i> Duplicate
          </button>
          <button class="btn" disabled=${!control} onClick=${removeControl}>
            <i class="fa-solid fa-trash"></i> Remove
          </button>
        </div>
        <div class="ui-side-control-actions">
          <button class="btn" onClick=${tidy} title="Grid-pack controls and grow the surface to fit">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Tidy layout
          </button>
        </div>

        <div class="ui-side-add">
          <select value=${newType} onChange=${(e) => setNewType(e.currentTarget.value)}>
            ${CONTROL_TYPES.map(type => html`<option value=${type}>${labelForType(type)}</option>`)}
          </select>
          <button class="btn" onClick=${addControl}>
            <i class="fa-solid fa-plus"></i> Another Control
          </button>
        </div>

        <div class="ui-side-divider"></div>

        <label>
          <span>Type</span>
          <select value=${control.type || 'text'} onChange=${(e) => updateControl(controlWithType(control, e.currentTarget.value, selectedIndex))}>
            ${CONTROL_TYPES.map(type => html`<option value=${type}>${labelForType(type)}</option>`)}
          </select>
        </label>

        ${(control.type || 'text') === 'label' && html`
          <label>
            <span>Text</span>
            <textarea rows="4" value=${control.text || ''} onInput=${(e) => update('text', e.currentTarget.value)}></textarea>
          </label>
        `}

        ${(control.type || 'text') === 'textarea' && html`
          <label>
            <span>Rows</span>
            <input type="number" min="1" max="16" step="1" value=${control.rows || 4} onInput=${(e) => update('rows', e.currentTarget.value)} />
          </label>
        `}

        ${['text', 'textarea', 'number', 'slider', 'color', 'date', 'select', 'radio'].includes(control.type || 'text') && html`
          <label>
            <span>Default</span>
            <input
              type=${control.type === 'color' ? 'color' : control.type === 'date' ? 'date' : control.type === 'number' || control.type === 'slider' ? 'number' : 'text'}
              value=${control.default ?? ''}
              onInput=${(e) => update('default', e.currentTarget.value)}
            />
          </label>
        `}

        ${(control.type || 'text') === 'checkbox' && html`
          <label class="ui-side-checkbox">
            <input type="checkbox" checked=${!!control.default} onChange=${(e) => update('default', e.currentTarget.checked)} />
            <span>Checked by default</span>
          </label>
        `}

        ${['text', 'textarea', 'number'].includes(control.type || 'text') && html`
          <label>
            <span>Placeholder</span>
            <input type="text" value=${control.placeholder || ''} onInput=${(e) => update('placeholder', e.currentTarget.value)} />
          </label>
        `}

        ${['number', 'slider'].includes(control.type || 'text') && html`
          <div class="ui-side-inline">
            <label>
              <span>Min</span>
              <input type="number" value=${control.min ?? 0} onInput=${(e) => update('min', e.currentTarget.value)} />
            </label>
            <label>
              <span>Max</span>
              <input type="number" value=${control.max ?? 100} onInput=${(e) => update('max', e.currentTarget.value)} />
            </label>
          </div>
          <label>
            <span>Step</span>
            <input type="number" value=${control.step ?? 1} onInput=${(e) => update('step', e.currentTarget.value)} />
          </label>
        `}

        ${(control.type || 'text') === 'readout' && html`
          <label>
            <span>Variable</span>
            <input type="text" value=${control.bind || ''} placeholder="nb variable to display" onInput=${(e) => update('bind', e.currentTarget.value)} />
          </label>
        `}

        ${['number', 'slider', 'readout'].includes(control.type || 'text') && html`
          <div class="ui-side-inline">
            <label>
              <span>Precision</span>
              <input type="number" min="0" max="12" step="1" value=${control.precision ?? ''} placeholder="auto" onInput=${(e) => update('precision', e.currentTarget.value)} />
            </label>
            <label>
              <span>Suffix</span>
              <input type="text" value=${control.suffix || ''} placeholder="e.g. % or ms" onInput=${(e) => update('suffix', e.currentTarget.value)} />
            </label>
          </div>
        `}

        ${['select', 'radio'].includes(control.type || 'text') && html`
          <label>
            <span>Options</span>
            <textarea
              rows="5"
              value=${formatOptions(control.options)}
              placeholder=${'One option per line\nLabel=value for custom values'}
              onInput=${(e) => update('options', parseOptions(e.currentTarget.value))}
            ></textarea>
          </label>
          <label>
            <span>Value type</span>
            <select value=${control.valueType || 'auto'} onChange=${(e) => update('valueType', e.currentTarget.value)}>
              <option value="auto">Auto (number if all options are numeric)</option>
              <option value="number">Number</option>
              <option value="string">String</option>
            </select>
          </label>
        `}

        ${(control.type || 'text') === 'button' && html`
          <label>
            <span>On press</span>
            <select value=${control.action || 'set'} onChange=${(e) => update('action', e.currentTarget.value)}>
              <option value="set">Set a value</option>
              <option value="increment">Increment a counter</option>
              <option value="toggle">Toggle true/false</option>
            </select>
          </label>
          <label>
            <span>Icon</span>
            <input type="text" value=${control.icon || ''} placeholder="fa-bolt" onInput=${(e) => update('icon', e.currentTarget.value)} />
          </label>
          ${(control.action || 'set') === 'set' && html`
            <label>
              <span>Value</span>
              <input type="text" value=${String(control.value ?? true)} onInput=${(e) => update('value', e.currentTarget.value)} />
            </label>
          `}
        `}
      ` : html`
        <div class="variables-empty">Add a control in the selected UI cell.</div>
        <div class="ui-side-add">
          <select value=${newType} onChange=${(e) => setNewType(e.currentTarget.value)}>
            ${CONTROL_TYPES.map(type => html`<option value=${type}>${labelForType(type)}</option>`)}
          </select>
          <button class="btn" onClick=${addControl}>
            <i class="fa-solid fa-plus"></i> Another Control
          </button>
        </div>
      `}

      <div class="ui-side-divider"></div>

      <div class="ui-side-inline">
        <label>
          <span>Form width</span>
          <input type="number" min="240" max="2000" step=${GRID_SIZE} value=${definition.width} onInput=${(e) => updateMeta('width', snap(e.currentTarget.value))} />
        </label>
        <label>
          <span>Form height</span>
          <input type="number" min="100" max="1600" step=${GRID_SIZE} value=${definition.height} onInput=${(e) => updateMeta('height', snap(e.currentTarget.value))} />
        </label>
      </div>
      <label>
        <span>Title</span>
        <input type="text" value=${definition.title || ''} onInput=${(e) => updateMeta('title', e.currentTarget.value)} />
      </label>
      <label>
        <span>Description</span>
        <textarea rows="3" value=${definition.description || ''} onInput=${(e) => updateMeta('description', e.currentTarget.value)}></textarea>
      </label>
    </div>
  `;
}

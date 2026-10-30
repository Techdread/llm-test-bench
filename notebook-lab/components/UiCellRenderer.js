// Renders JSON-described notebook UI controls and binds them to nbBridge.

import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as nbBridge from '../services/nbBridge.js';
import { parseUiDefinition, stringifyDefinition, tidyDefinition, growToFit } from './UiCellFormEditor.js';
import {
  coerceControlValue,
  clampToControl,
  displayValue,
  formatDisplay,
  optionValue,
  optionLabel,
  applyUiDefaults,
  readingOrder,
  shouldStackControls,
} from '../services/uiCellModel.js';

const GRID_SIZE = 20;

// One id namespace per mounted UI cell, so control ids and radio-group names
// stay unique across cells sharing a document (fixes label/for + radio nav).
let cellUidSeq = 0;

function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function commitBound(control, raw) {
  if (!control.bind) return;
  nbBridge.setValue(control.bind, coerceControlValue(raw, control));
}

// Editing buffer: while the user drags a slider or types, we hold the raw
// value locally and *throttle* (slider, one commit per animation frame) or
// *debounce* (text/number, ~150ms) the write to nb — a single set fans out to
// every subscriber and every HTML-cell iframe, so per-pixel/per-keystroke
// writes are what made big-state notebooks stutter. The final value is always
// committed on release/blur.
function useEditableCommit(control) {
  const [buffer, setBuffer] = useState(null); // null → show the external value
  const latest = useRef(null);
  const rafRef = useRef(0);
  const timerRef = useRef(0);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const throttled = (raw) => {
    latest.current = raw;
    setBuffer(raw);
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        commitBound(control, latest.current);
      });
    }
  };
  const debounced = (raw) => {
    latest.current = raw;
    setBuffer(raw);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commitBound(control, latest.current), 150);
  };
  const finish = (raw) => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = 0; }
    commitBound(control, raw);
    setBuffer(null);
  };

  return { buffer, throttled, debounced, finish };
}

function Control({ control, vars, inputId, groupName }) {
  const type = control.type || 'text';
  const external = displayValue(control, vars);
  const { buffer, throttled, debounced, finish } = useEditableCommit(control);
  const shown = buffer === null ? external : buffer;
  const disabled = !!control.disabled;

  if (type === 'label' || type === 'markdown') {
    return html`
      <div class="ui-control ui-control-label">
        ${control.label && html`<div class="ui-label">${control.label}</div>`}
        <div class="ui-static-text">${control.text || control.value || ''}</div>
      </div>
    `;
  }

  if (type === 'readout') {
    return html`
      <div class="ui-control ui-control-readout">
        <span class="ui-label">${control.label || control.bind}</span>
        <output class="ui-readout-value">${formatDisplay(external, control)}</output>
      </div>
    `;
  }

  if (type === 'textarea') {
    return html`
      <label class="ui-control" for=${inputId}>
        <span class="ui-label">${control.label || control.bind}</span>
        <textarea
          id=${inputId}
          disabled=${disabled}
          rows=${control.rows || 4}
          placeholder=${control.placeholder || ''}
          value=${shown}
          onInput=${(e) => debounced(e.currentTarget.value)}
          onBlur=${(e) => finish(e.currentTarget.value)}
        ></textarea>
      </label>
    `;
  }

  if (type === 'number') {
    return html`
      <label class="ui-control" for=${inputId}>
        <span class="ui-label">${control.label || control.bind}</span>
        <input
          id=${inputId}
          type="number"
          disabled=${disabled}
          min=${control.min}
          max=${control.max}
          step=${control.step || 'any'}
          value=${shown}
          placeholder=${control.placeholder || ''}
          onInput=${(e) => debounced(e.currentTarget.value)}
          onBlur=${(e) => finish(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') finish(e.currentTarget.value); }}
        />
      </label>
    `;
  }

  if (type === 'slider') {
    const numeric = clampToControl(Number(shown), control);
    return html`
      <label class="ui-control" for=${inputId}>
        <span class="ui-label">
          ${control.label || control.bind}
          <strong>${formatDisplay(numeric, control)}</strong>
        </span>
        <input
          id=${inputId}
          type="range"
          disabled=${disabled}
          min=${control.min ?? 0}
          max=${control.max ?? 100}
          step=${control.step ?? 1}
          value=${Number.isFinite(numeric) ? numeric : (control.min ?? 0)}
          aria-valuetext=${formatDisplay(numeric, control)}
          onInput=${(e) => throttled(e.currentTarget.value)}
          onChange=${(e) => finish(e.currentTarget.value)}
          onPointerUp=${(e) => finish(e.currentTarget.value)}
          onKeyUp=${(e) => finish(e.currentTarget.value)}
        />
      </label>
    `;
  }

  if (type === 'checkbox') {
    return html`
      <label class="ui-control ui-control-inline" for=${inputId}>
        <input
          id=${inputId}
          type="checkbox"
          disabled=${disabled}
          checked=${!!shown}
          onChange=${(e) => finish(e.currentTarget.checked)}
        />
        <span class="ui-label">${control.label || control.bind}</span>
      </label>
    `;
  }

  if (type === 'select') {
    const options = Array.isArray(control.options) ? control.options : [];
    return html`
      <label class="ui-control" for=${inputId}>
        <span class="ui-label">${control.label || control.bind}</span>
        <select
          id=${inputId}
          disabled=${disabled}
          value=${shown}
          onChange=${(e) => finish(e.currentTarget.value)}
        >
          ${options.map(option => html`
            <option value=${optionValue(option)}>${optionLabel(option)}</option>
          `)}
        </select>
      </label>
    `;
  }

  if (type === 'radio') {
    const options = Array.isArray(control.options) ? control.options : [];
    return html`
      <fieldset class="ui-control ui-control-fieldset">
        <legend class="ui-label">${control.label || control.bind}</legend>
        <div class="ui-radio-group">
          ${options.map((option, i) => {
            const optValue = optionValue(option);
            const radioId = `${inputId}-o${i}`;
            return html`
              <label class="ui-radio-option" for=${radioId}>
                <input
                  id=${radioId}
                  type="radio"
                  name=${groupName}
                  value=${optValue}
                  checked=${String(shown) === String(optValue)}
                  disabled=${disabled}
                  onChange=${() => finish(optValue)}
                />
                <span>${optionLabel(option)}</span>
              </label>
            `;
          })}
        </div>
      </fieldset>
    `;
  }

  if (type === 'button') {
    const onPress = () => {
      // action modes make buttons dependable triggers; the default (no bind
      // value) writes a fresh timestamp so listeners always see a change.
      if (control.bind) {
        if (control.action === 'increment') {
          const cur = Number(nbBridge.getValue(control.bind)) || 0;
          nbBridge.setValue(control.bind, cur + 1);
        } else if (control.action === 'toggle') {
          nbBridge.setValue(control.bind, !nbBridge.getValue(control.bind));
        } else {
          nbBridge.setValue(control.bind, control.value ?? Date.now());
        }
      }
      if (control.set && typeof control.set === 'object') {
        for (const [key, val] of Object.entries(control.set)) nbBridge.setValue(key, val);
      }
    };
    return html`
      <div class="ui-control">
        <button class="btn" disabled=${disabled} onClick=${onPress}>
          ${control.icon && html`<i class=${`fa-solid ${control.icon}`}></i>`}
          ${control.label || 'Set'}
        </button>
      </div>
    `;
  }

  // text (default), color, date
  return html`
    <label class="ui-control" for=${inputId}>
      <span class="ui-label">${control.label || control.bind}</span>
      <input
        id=${inputId}
        type=${type === 'color' || type === 'date' ? type : 'text'}
        disabled=${disabled}
        value=${shown}
        placeholder=${control.placeholder || ''}
        onInput=${(e) => (type === 'color' || type === 'date') ? undefined : debounced(e.currentTarget.value)}
        onChange=${(e) => finish(e.currentTarget.value)}
        onBlur=${(e) => (type === 'color' || type === 'date') ? undefined : finish(e.currentTarget.value)}
      />
    </label>
  `;
}

export function UiCellRenderer({ source, designer = false, selectedIndex = -1, onSelectControl, onDefinitionChange }) {
  const [vars, setVars] = useState(() => nbBridge.snapshot());
  const uid = useMemo(() => `uic${++cellUidSeq}`, []);
  const parsed = parseUiDefinition(source);
  const definition = parsed.definition;
  const error = parsed.error;

  useEffect(() => nbBridge.subscribe(setVars), []);

  // How much room the cell has, so a phone can stack the controls.
  const wrapRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const measure = () => setAvailableWidth(node.clientWidth);
    measure();
    if (!window.ResizeObserver) {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Seed defaults on first render too, so an on-screen UI cell primes nb even
  // before it (or its downstream cells) is run. The runtime does the same on
  // a headless / Run-All pass.
  useEffect(() => {
    if (error) return;
    applyUiDefaults(source, nbBridge);
  }, [source]);

  if (error) {
    return html`<div class="cell-output output-error">Invalid UI cell JSON: ${error}</div>`;
  }

  const updateDefinition = (nextDefinition) => {
    if (!onDefinitionChange) return;
    onDefinitionChange(stringifyDefinition(nextDefinition));
  };

  const updateControl = (index, patch) => {
    const controls = definition.controls.slice();
    controls[index] = { ...controls[index], ...patch };
    updateDefinition({ ...definition, controls });
  };

  const startControlDrag = (e, index) => {
    if (!designer || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectControl && onSelectControl(index);
    const control = definition.controls[index];
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = Number(control.x || 0);
    const baseY = Number(control.y || 0);

    const onMove = (moveEvent) => {
      const x = clamp(snap(baseX + moveEvent.clientX - startX), 0, Math.max(0, definition.width - 40));
      const y = clamp(snap(baseY + moveEvent.clientY - startY), 0, Math.max(0, definition.height - 24));
      updateControl(index, { x, y });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const startControlResize = (e, index) => {
    if (!designer || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectControl && onSelectControl(index);
    const control = definition.controls[index];
    const startX = e.clientX;
    const startY = e.clientY;
    const baseWidth = Number(control.width || 220);
    const baseHeight = Number(control.height || 64);
    const baseX = Number(control.x || 0);
    const baseY = Number(control.y || 0);

    const onMove = (moveEvent) => {
      const width = clamp(snap(baseWidth + moveEvent.clientX - startX), 40, Math.max(40, definition.width - baseX));
      const height = clamp(snap(baseHeight + moveEvent.clientY - startY), 24, Math.max(24, definition.height - baseY));
      updateControl(index, { width, height });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const startSurfaceResize = (e) => {
    if (!designer || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseWidth = Number(definition.width || 720);
    const baseHeight = Number(definition.height || 160);

    const onMove = (moveEvent) => {
      updateDefinition({
        ...definition,
        width: clamp(snap(baseWidth + moveEvent.clientX - startX), 240, 2000),
        height: clamp(snap(baseHeight + moveEvent.clientY - startY), 100, 1600),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  // Keyboard nudging for the selected control: arrows move by the grid step,
  // shift+arrows resize. Gives the designer a pointer-free path.
  const onControlKeyDown = (e, index) => {
    if (!designer) return;
    const control = definition.controls[index];
    const resize = e.shiftKey;
    let handled = true;
    if (resize) {
      let width = Number(control.width || 220);
      let height = Number(control.height || 64);
      if (e.key === 'ArrowRight') width += GRID_SIZE;
      else if (e.key === 'ArrowLeft') width -= GRID_SIZE;
      else if (e.key === 'ArrowDown') height += GRID_SIZE;
      else if (e.key === 'ArrowUp') height -= GRID_SIZE;
      else handled = false;
      if (handled) {
        updateControl(index, {
          width: clamp(width, 40, definition.width - Number(control.x || 0)),
          height: clamp(height, 24, definition.height - Number(control.y || 0)),
        });
      }
    } else {
      let x = Number(control.x || 0);
      let y = Number(control.y || 0);
      if (e.key === 'ArrowRight') x += GRID_SIZE;
      else if (e.key === 'ArrowLeft') x -= GRID_SIZE;
      else if (e.key === 'ArrowDown') y += GRID_SIZE;
      else if (e.key === 'ArrowUp') y -= GRID_SIZE;
      else handled = false;
      if (handled) {
        updateControl(index, {
          x: clamp(x, 0, Math.max(0, definition.width - 40)),
          y: clamp(y, 0, Math.max(0, definition.height - 24)),
        });
      }
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  const hasHeader = !!(definition.title || definition.description);
  const stacked = shouldStackControls({ availableWidth, formWidth: definition.width, designer });
  const order = stacked ? readingOrder(definition.controls) : definition.controls.map((_, index) => index);

  return html`
    <div ref=${wrapRef} class=${`ui-cell-rendered ui-cell-absolute ${designer ? 'ui-cell-has-designer' : ''} ${stacked ? 'ui-cell-stacked' : ''}`}>
      ${hasHeader && html`
        <div class="ui-cell-header">
          ${definition.title && html`<div class="ui-cell-title">${definition.title}</div>`}
          ${definition.description && html`<div class="ui-cell-description">${definition.description}</div>`}
        </div>
      `}
      <div
        class=${`ui-control-canvas ${designer ? 'ui-cell-designer' : ''}`}
        style=${stacked ? undefined : { width: `${definition.width}px`, height: `${definition.height}px` }}
        onClick=${designer ? () => onSelectControl && onSelectControl(Math.max(0, selectedIndex)) : undefined}
      >
        ${order.map((index) => {
          const control = definition.controls[index];
          const inputId = `${uid}-c${index}`;
          const rendered = html`<${Control} control=${control} vars=${vars} inputId=${inputId} groupName=${inputId} />`;
          return html`
            <div
              key=${inputId}
              class=${`ui-designer-control ${designer && selectedIndex === index ? 'selected' : ''}`}
              tabIndex=${designer && selectedIndex === index ? 0 : undefined}
              style=${stacked ? undefined : {
                left: `${control.x || 0}px`,
                top: `${control.y || 0}px`,
                width: `${control.width || 220}px`,
                height: `${control.height || 64}px`,
              }}
              onPointerDown=${designer ? (e) => startControlDrag(e, index) : undefined}
              onKeyDown=${designer ? (e) => onControlKeyDown(e, index) : undefined}
              onClick=${(e) => {
                if (designer) {
                  e.stopPropagation();
                  onSelectControl && onSelectControl(index);
                }
              }}
            >
              ${rendered}
              ${designer && selectedIndex === index && html`
                <span
                  class="ui-resize-handle"
                  title="Resize control"
                  onPointerDown=${(e) => startControlResize(e, index)}
                ></span>
              `}
            </div>
          `;
        })}
        ${designer && html`
          <span
            class="ui-surface-resize-handle"
            title="Resize UI cell"
            onPointerDown=${startSurfaceResize}
          ></span>
        `}
      </div>
      ${designer && onDefinitionChange && html`
        <div class="ui-designer-toolbar">
          <button
            class="btn btn-small"
            title="Grid-pack controls and grow the surface to fit"
            onClick=${() => updateDefinition(growToFit(tidyDefinition(definition)))}
          >
            <i class="fa-solid fa-wand-magic-sparkles"></i> Tidy
          </button>
        </div>
      `}
    </div>
  `;
}

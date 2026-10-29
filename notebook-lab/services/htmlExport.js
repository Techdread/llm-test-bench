// htmlExport — build a self-contained HTML document of a notebook.
//
// The export has to survive being opened from anywhere (usually ~/Downloads,
// over file://), so it links to nothing: markdown and charts are rendered
// *here*, at export time, with the libraries the app already has loaded, and
// only their output is baked in. Nothing in the produced document fetches.
//
// UI cells are exported as real, working controls. They drive the same
// `__nbHtmlBridge` postMessage protocol the app uses (see htmlNbBridge.js), so
// an exported notebook whose HTML cell reads nb.get()/nb.onChange() stays
// interactive: drag a slider in the export and the sketch responds.

import { htmlPreviewForCell } from './htmlPreview.js';
import { buildHtmlCellSrcdoc, HTML_NB_BRIDGE_MARKER } from './htmlNbBridge.js';
import { parseUiDefinition } from '../components/UiCellFormEditor.js';
import { ensureVega } from '../components/OutputRenderer.js';
import { displayValue, formatDisplay, optionValue, optionLabel, clampToControl } from './uiCellModel.js';
import { isVegaLiteSpec, prepareVegaLiteSpec } from './vegaSpec.js';
import { exportCodeBlock } from './codeVisibility.js';
import { exportValueFrame, HTML_VALUE_MARKER, looksLikeHtml, MAX_AUTO_HEIGHT } from './htmlValueOutput.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// JSON destined for an inline <script>: neutralise "</script>" and the HTML
// comment openers that would otherwise end the element early.
const jsonForScript = (value) => JSON.stringify(value ?? null)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e');

// ── markdown / chart baking ────────────────────────────────────────────────

async function loadMarked() {
  try {
    const mod = await import('../../shared/lib/marked/12/index.mjs');
    return typeof mod.parse === 'function' ? mod.parse : null;
  } catch {
    return null;
  }
}

async function renderChartSvg(spec) {
  await ensureVega();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;';
  document.body.appendChild(holder);
  try {
    const result = await window.vegaEmbed(holder, prepareVegaLiteSpec(spec), { actions: false, renderer: 'svg' });
    const svg = holder.querySelector('svg');
    const markup = svg ? svg.outerHTML : null;
    try { result?.finalize?.(); } catch { /* finalize is best-effort */ }
    return markup;
  } finally {
    holder.remove();
  }
}

// ── UI cells ───────────────────────────────────────────────────────────────

function optionsOf(control) {
  return Array.isArray(control.options) ? control.options : [];
}

// Mirrors UiCellRenderer's Control(), minus the designer affordances. `ref` is
// the "cellIndex.controlIndex" address the runtime uses to find the control's
// definition again.
function renderControl(control, vars, ref, inputId) {
  const type = control.type || 'text';
  const label = esc(control.label || control.bind || '');
  const value = displayValue(control, vars);
  const disabled = control.disabled ? ' disabled' : '';
  const data = ` data-ui="${ref}"`;

  if (type === 'label' || type === 'markdown') {
    return `<div class="ui-control ui-control-label">`
      + (control.label ? `<div class="ui-label">${label}</div>` : '')
      + `<div class="ui-static-text">${esc(control.text || control.value || '')}</div></div>`;
  }

  if (type === 'readout') {
    return `<div class="ui-control ui-control-readout"><span class="ui-label">${label}</span>`
      + `<output class="ui-readout-value"${data}>${esc(formatDisplay(value, control))}</output></div>`;
  }

  if (type === 'textarea') {
    return `<label class="ui-control" for="${inputId}"><span class="ui-label">${label}</span>`
      + `<textarea id="${inputId}"${data}${disabled} rows="${Number(control.rows) || 4}"`
      + ` placeholder="${esc(control.placeholder || '')}">${esc(value)}</textarea></label>`;
  }

  if (type === 'number') {
    const min = control.min == null ? '' : ` min="${esc(control.min)}"`;
    const max = control.max == null ? '' : ` max="${esc(control.max)}"`;
    return `<label class="ui-control" for="${inputId}"><span class="ui-label">${label}</span>`
      + `<input id="${inputId}"${data} type="number"${disabled}${min}${max}`
      + ` step="${esc(control.step ?? 'any')}" value="${esc(value)}"`
      + ` placeholder="${esc(control.placeholder || '')}" /></label>`;
  }

  if (type === 'slider') {
    const numeric = clampToControl(Number(value), control);
    const shown = Number.isFinite(numeric) ? numeric : (control.min ?? 0);
    return `<label class="ui-control" for="${inputId}">`
      + `<span class="ui-label">${label}`
      + `<strong data-ui-readout="${ref}">${esc(formatDisplay(shown, control))}</strong></span>`
      + `<input id="${inputId}"${data} type="range"${disabled}`
      + ` min="${esc(control.min ?? 0)}" max="${esc(control.max ?? 100)}" step="${esc(control.step ?? 1)}"`
      + ` value="${esc(shown)}" /></label>`;
  }

  if (type === 'checkbox') {
    return `<label class="ui-control ui-control-inline" for="${inputId}">`
      + `<input id="${inputId}"${data} type="checkbox"${disabled}${value ? ' checked' : ''} />`
      + `<span class="ui-label">${label}</span></label>`;
  }

  if (type === 'select') {
    const options = optionsOf(control).map((option) => {
      const optValue = optionValue(option);
      const selected = String(value) === String(optValue) ? ' selected' : '';
      return `<option value="${esc(optValue)}"${selected}>${esc(optionLabel(option))}</option>`;
    }).join('');
    return `<label class="ui-control" for="${inputId}"><span class="ui-label">${label}</span>`
      + `<select id="${inputId}"${data}${disabled}>${options}</select></label>`;
  }

  if (type === 'radio') {
    const options = optionsOf(control).map((option, i) => {
      const optValue = optionValue(option);
      const radioId = `${inputId}-o${i}`;
      const checked = String(value) === String(optValue) ? ' checked' : '';
      return `<label class="ui-radio-option" for="${radioId}">`
        + `<input id="${radioId}"${data} type="radio" name="${inputId}"`
        + ` value="${esc(optValue)}"${checked}${disabled} />`
        + `<span>${esc(optionLabel(option))}</span></label>`;
    }).join('');
    return `<fieldset class="ui-control ui-control-fieldset"><legend class="ui-label">${label}</legend>`
      + `<div class="ui-radio-group">${options}</div></fieldset>`;
  }

  if (type === 'button') {
    return `<div class="ui-control"><button class="ui-btn"${data}${disabled}>`
      + `${esc(control.label || 'Set')}</button></div>`;
  }

  const inputType = (type === 'color' || type === 'date') ? type : 'text';
  return `<label class="ui-control" for="${inputId}"><span class="ui-label">${label}</span>`
    + `<input id="${inputId}"${data} type="${inputType}"${disabled} value="${esc(value)}"`
    + ` placeholder="${esc(control.placeholder || '')}" /></label>`;
}

function renderUiCell(cell, cellIndex, vars) {
  const { definition, error } = parseUiDefinition(cell.source || '');
  if (error) {
    return `<div class="c-error">Invalid UI cell JSON: ${esc(error)}</div>`
      + `<pre class="c-src"><code>${esc(cell.source || '')}</code></pre>`;
  }

  const header = (definition.title || definition.description)
    ? `<div class="ui-cell-header">`
      + (definition.title ? `<div class="ui-cell-title">${esc(definition.title)}</div>` : '')
      + (definition.description ? `<div class="ui-cell-description">${esc(definition.description)}</div>` : '')
      + `</div>`
    : '';

  const controls = definition.controls.map((control, i) => {
    const ref = `${cellIndex}.${i}`;
    const inputId = `uic${cellIndex}-c${i}`;
    const style = `left:${control.x || 0}px;top:${control.y || 0}px;`
      + `width:${control.width || 220}px;height:${control.height || 64}px;`;
    return `<div class="ui-designer-control" style="${style}">`
      + `${renderControl(control, vars, ref, inputId)}</div>`;
  }).join('');

  return `<div class="ui-cell-rendered">${header}`
    + `<div class="ui-control-canvas" style="width:${definition.width}px;height:${definition.height}px">`
    + `${controls}</div></div>`;
}

// ── document assembly ──────────────────────────────────────────────────────

async function renderOutputs(cell, theme) {
  const rendered = [];
  for (const output of cell.outputs || []) {
    if (output.type === 'image') {
      rendered.push(`<img src="data:${output.mime || 'image/png'};base64,${output.data}" />`);
    } else if (output.type === 'text') {
      rendered.push(`<pre>${esc(output.value)}</pre>`);
    } else if (output.type === 'value' && isVegaLiteSpec(output.value)) {
      try {
        rendered.push(`<div class="c-chart">${await renderChartSvg(output.value)}</div>`);
      } catch (error) {
        rendered.push(`<div class="c-error">Chart could not be rendered: ${esc(error.message || String(error))}</div>`);
      }
    } else if (output.type === 'value' && looksLikeHtml(output.value)) {
      rendered.push(exportValueFrame(output.value, theme));
    } else if (output.type === 'value') {
      try { rendered.push(`<pre>${esc(typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2))}</pre>`); }
      catch { rendered.push(`<pre>${esc(String(output.value))}</pre>`); }
    }
  }
  return rendered.join('');
}

// The theme the export opens in. Falls back to whatever the app is currently
// wearing, so an export looks like the notebook the author was just reading.
function initialTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Build the standalone document. Async because markdown and charts are
 * rendered up front — the export links to no scripts at all.
 *
 * `options.theme` ('light' | 'dark') sets the theme the file opens in; the
 * reader can flip it with the toggle in the exported page either way.
 */
export async function buildStandaloneHtml(nb, options = {}) {
  const theme = initialTheme(options.theme);
  const state = nb.state || {};
  const parseMarkdown = nb.cells.some(c => c.kind === 'md') ? await loadMarked() : null;

  // UI cell definitions the runtime needs for coercion/formatting, indexed by
  // the same cell index the control refs carry.
  const uiDefinitions = {};

  const rendered = [];
  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i];
    const header = `<div class="c-head">[${i + 1}] ${esc(cell.kind.toUpperCase())}</div>`;
    let body;

    if (cell.kind === 'md') {
      const source = cell.source || '';
      body = parseMarkdown
        ? `<div class="c-md">${parseMarkdown(source)}</div>`
        : `<pre class="c-md">${esc(source)}</pre>`;
    } else if (cell.kind === 'ui') {
      uiDefinitions[i] = parseUiDefinition(cell.source || '').definition;
      body = renderUiCell(cell, i, state);
    } else if (cell.kind === 'html') {
      const preview = htmlPreviewForCell(cell);
      // The saved variables are baked into the srcdoc so the cell renders
      // correctly on load; UI controls then patch it live over postMessage.
      const srcdoc = buildHtmlCellSrcdoc(cell.source || '', state);
      body = `<div class="c-html-shell" data-width="${preview.width}" data-height="${preview.height}"`
        + ` data-scale="${preview.scale}">`
        + `<iframe class="c-html" sandbox="allow-scripts" srcdoc="${esc(srcdoc)}"></iframe></div>`
        + `<div class="c-html-status">Rendering ${preview.width}x${preview.height}</div>`;
    } else if (cell.kind === 'chart') {
      let svg = null;
      let chartError = null;
      try {
        svg = await renderChartSvg(JSON.parse(cell.source || '{}'));
      } catch (e) {
        chartError = e.message || String(e);
      }
      body = svg
        ? `<div class="c-chart">${svg}</div>`
        : `<div class="c-error">Chart could not be rendered: ${esc(chartError || 'unknown error')}</div>`
          + `<pre class="c-src"><code>${esc(cell.source || '')}</code></pre>`;
    } else {
      const outputs = await renderOutputs(cell, theme);
      body = exportCodeBlock(cell)
        + (outputs ? `<div class="c-out">${outputs}</div>` : '');
    }

    rendered.push(`<div class="cell">${header}${body}</div>`);
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(nb.title || 'Notebook')}</title>
<script>
// Apply a remembered choice before first paint, so revisiting the file doesn't
// flash the exported theme first. localStorage is unavailable on some file://
// setups — the baked theme stands in that case.
try {
  var saved = localStorage.getItem('notebook-export-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
} catch (e) { /* baked theme it is */ }
<\/script>
<style>
${DOCUMENT_CSS}
</style></head><body>
<header class="doc-head">
  <h1>${esc(nb.title || 'Notebook')}</h1>
  <button type="button" class="theme-toggle" id="theme-toggle" aria-live="polite"></button>
</header>
${rendered.join('\n')}
<script>
var NB_UI = ${jsonForScript(uiDefinitions)};
var NB_STATE = ${jsonForScript(state)};
${THEME_JS}
${RUNTIME_JS}
<\/script>
</body></html>`;
}

const DOCUMENT_CSS = `
/* Palette lifted from the hub's shared/styles/base.css, so an exported
   notebook reads like the app it came from in either theme. */
:root, :root[data-theme="light"] {
  color-scheme: light;
  --bg-primary: #ffffff; --bg-secondary: #f5f5f5; --bg-tertiary: #e8e8e8;
  --text-primary: #1a1a1a; --text-secondary: #555555;
  --border-color: #d0d0d0; --accent: #2563eb; --danger: #dc2626;
  --danger-bg: #fef2f2; --code-bg: #f6f8fa;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-primary: #1e1e1e; --bg-secondary: #252526; --bg-tertiary: #2d2d2d;
  --text-primary: #d4d4d4; --text-secondary: #aaaaaa;
  --border-color: #3e3e3e; --accent: #3b82f6; --danger: #ef4444;
  --danger-bg: #3a1d1d; --code-bg: #1e1e1e;
}
body { font-family: -apple-system, system-ui, sans-serif; max-width: 1440px; margin: 0 auto;
  padding: 40px 20px; color: var(--text-primary); background: var(--bg-primary); }
.doc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin: 0 0 24px; }
h1 { margin: 0; }
.theme-toggle { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
  border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary);
  color: var(--text-secondary); font: 600 12px/1 -apple-system, system-ui, sans-serif; cursor: pointer; }
.theme-toggle:hover { border-color: var(--accent); color: var(--text-primary); }
.cell { border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
.c-head { background: var(--bg-tertiary); padding: 4px 10px; font: 11px/1 monospace;
  color: var(--text-secondary); text-transform: uppercase; }
.c-code > summary { padding: 6px 14px; background: var(--bg-secondary); color: var(--text-secondary);
  font: 12px/1.4 -apple-system, system-ui, sans-serif; cursor: pointer; }
.c-code[open] > summary { border-bottom: 1px solid var(--border-color); }
.c-src { margin: 0; padding: 10px 14px; background: var(--bg-secondary); font: 13px/1.5 monospace; overflow: auto; }
.c-out { padding: 10px 14px; background: var(--bg-primary); border-top: 1px solid var(--border-color); }
.c-value { display: block; width: 100%; height: 120px; border: 0; }
.c-error { padding: 10px 14px; background: var(--danger-bg); color: var(--danger); font: 13px/1.5 monospace; }
.c-md { padding: 10px 14px; line-height: 1.6; }
.c-md h1, .c-md h2, .c-md h3 { margin: 0.8em 0 0.4em; line-height: 1.25; }
.c-md h1 { font-size: 1.6em; } .c-md h2 { font-size: 1.3em; } .c-md h3 { font-size: 1.1em; }
.c-md p, .c-md ul, .c-md ol, .c-md blockquote, .c-md pre { margin: 0.6em 0; }
.c-md ul, .c-md ol { padding-left: 1.5em; }
.c-md code { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 3px;
  padding: 1px 4px; font: 0.9em monospace; }
.c-md pre { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px;
  padding: 10px 12px; overflow: auto; }
.c-md pre code { background: none; border: 0; padding: 0; }
.c-md blockquote { border-left: 3px solid var(--border-color); padding-left: 12px; color: var(--text-secondary); }
.c-md table { border-collapse: collapse; }
.c-md th, .c-md td { border: 1px solid var(--border-color); padding: 4px 8px; }
.c-html-shell { overflow: auto; background: #020617; }
.c-html { display: block; border: 0; background: #fff; transform-origin: top left; }
.c-html-status { padding: 5px 10px; border-top: 1px solid var(--border-color); background: var(--bg-secondary);
  color: var(--text-secondary); font: 11px/1.2 monospace; }
/* Vega bakes its axis/label colours into the SVG at export time, so the chart
   keeps a light card of its own rather than turning illegible in dark mode. */
.c-chart { padding: 10px; overflow: auto; }
.c-chart svg { background: #ffffff; border-radius: 6px; }
img { max-width: 100%; }
pre { white-space: pre-wrap; word-break: break-word; }

/* UI cells — kept in step with the .ui-* rules in styles.css */
.ui-cell-rendered { position: relative; background: var(--bg-primary); display: flex; flex-direction: column; }
.ui-cell-header { padding: 10px 12px 8px; }
.ui-cell-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.ui-cell-description { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
.ui-control-canvas { position: relative; overflow: hidden; max-width: 100%; }
.ui-designer-control { position: absolute; box-sizing: border-box; padding: 8px; border: 1px solid transparent;
  border-radius: 6px; overflow: hidden; }
.ui-designer-control .ui-control { height: 100%; }
.ui-control { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 13px; }
.ui-control-inline { flex-direction: row; align-items: center; }
.ui-label { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  color: var(--text-secondary); font-size: 12px; font-weight: 700; }
.ui-label strong { color: var(--accent); font-weight: 700; }
.ui-static-text { font-size: 13px; line-height: 1.5; }
.ui-readout-value { color: var(--accent); font-weight: 700; }
.ui-control input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
.ui-control textarea, .ui-control select { width: 100%; min-width: 0; background: var(--bg-secondary);
  color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 7px 8px;
  font: inherit; box-sizing: border-box; }
.ui-control input[type="range"] { width: 100%; }
.ui-control input[type="color"] { width: 100%; height: 34px; padding: 3px; background: var(--bg-secondary);
  border: 1px solid var(--border-color); border-radius: 4px; box-sizing: border-box; cursor: pointer; }
.ui-control-fieldset { border: 0; margin: 0; padding: 0; }
.ui-radio-group { display: flex; flex-wrap: wrap; gap: 8px; }
.ui-radio-option { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.ui-btn { padding: 7px 12px; border: 1px solid var(--border-color); border-radius: 4px;
  background: var(--bg-secondary); color: var(--text-primary); font: inherit; cursor: pointer; }
.ui-btn:hover { border-color: var(--accent); }
`;

// Theme switch. The choice is remembered per file:// or http origin where
// storage is available, and is otherwise just for this visit.
const THEME_JS = `
(function () {
  var button = document.getElementById('theme-toggle');
  var root = document.documentElement;
  function paint() {
    var dark = root.getAttribute('data-theme') === 'dark';
    button.textContent = dark ? '\\u263C Light' : '\\u263E Dark';
    button.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
    button.setAttribute('aria-label', button.title);
  }
  button.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('notebook-export-theme', next); } catch (e) { /* this visit only */ }
    paint();
  });
  paint();
})();
`;

// The exported document's own little runtime: keeps notebook state, drives the
// controls, and relays state into every HTML cell iframe using the same
// message shapes as the app (htmlNbBridge.js).
const RUNTIME_JS = `
var MARKER = '${HTML_NB_BRIDGE_MARKER}';
var NUMERIC = { number: 1, slider: 1 };

function controlFor(ref) {
  var parts = String(ref).split('.');
  var def = NB_UI[parts[0]];
  return def && def.controls ? def.controls[Number(parts[1])] : null;
}

function optValue(option) { return option && typeof option === 'object' ? option.value : option; }

function allNumericOptions(control) {
  var options = Array.isArray(control.options) ? control.options : [];
  return options.length > 0 && options.every(function (o) { return isFinite(Number(optValue(o))); });
}

function clampToControl(value, control) {
  if (!NUMERIC[control.type]) return value;
  var v = Number(value);
  if (!isFinite(v)) return v;
  if (isFinite(Number(control.min))) v = Math.max(Number(control.min), v);
  if (isFinite(Number(control.max))) v = Math.min(Number(control.max), v);
  return v;
}

function coerce(raw, control) {
  var type = control.type || 'text';
  if (type === 'checkbox') return !!raw;
  if (NUMERIC[type]) {
    var n = Number(raw);
    if (!isFinite(n)) { var min = Number(control.min); return isFinite(min) ? min : 0; }
    return clampToControl(n, control);
  }
  if (type === 'select' || type === 'radio') {
    var wantsNumber = control.valueType === 'number'
      || (control.valueType !== 'string' && allNumericOptions(control));
    if (wantsNumber) { var num = Number(raw); if (isFinite(num)) return num; }
  }
  return raw;
}

function formatDisplay(value, control) {
  var text;
  var precision = Number(control.precision);
  if (isFinite(precision) && isFinite(Number(value))) text = Number(value).toFixed(precision);
  else if (value === null || value === undefined) text = '';
  else text = String(value);
  if (control.prefix) text = String(control.prefix) + text;
  if (control.suffix) text = text + String(control.suffix);
  return text;
}

function frames() { return Array.prototype.slice.call(document.querySelectorAll('iframe.c-html')); }

function broadcast(key, value, except) {
  frames().forEach(function (frame) {
    var win = frame.contentWindow;
    if (!win || win === except) return;
    var message = { key: key, value: value };
    message[MARKER] = 'patch';
    try { win.postMessage(message, '*'); } catch (e) { /* frame not ready yet */ }
  });
}

function sendSnapshot(frame) {
  var win = frame.contentWindow;
  if (!win) return;
  var message = { values: NB_STATE };
  message[MARKER] = 'update';
  try { win.postMessage(message, '*'); } catch (e) { /* frame not ready yet */ }
}

// Refresh every surface that displays \`key\` other than the element the user is
// currently editing.
function refreshDisplays(key, source) {
  document.querySelectorAll('[data-ui]').forEach(function (el) {
    if (el === source) return;
    var control = controlFor(el.dataset.ui);
    if (!control || control.bind !== key) return;
    var value = NB_STATE[key];
    var type = control.type || 'text';
    if (type === 'readout') el.textContent = formatDisplay(value, control);
    else if (type === 'checkbox') el.checked = !!value;
    else if (type === 'radio') el.checked = String(el.value) === String(value);
    else if (el.value !== String(value)) el.value = value;
  });
  document.querySelectorAll('[data-ui-readout]').forEach(function (el) {
    var control = controlFor(el.dataset.uiReadout);
    if (!control || control.bind !== key) return;
    el.textContent = formatDisplay(NB_STATE[key], control);
  });
}

function publish(key, value, source, sourceWindow) {
  if (!key) return;
  NB_STATE[key] = value;
  broadcast(key, value, sourceWindow);
  refreshDisplays(key, source);
}

// Slider drags commit once per frame; typing commits on a short debounce.
function makeCommitter(el, control) {
  var pending = null;
  var raf = 0;
  var timer = 0;
  function flush() {
    raf = 0; timer = 0;
    publish(control.bind, coerce(pending, control), el, null);
  }
  return {
    throttled: function (raw) {
      pending = raw;
      if (control.type === 'slider') {
        var strong = el.closest('.ui-control') ? el.closest('.ui-control').querySelector('[data-ui-readout]') : null;
        if (strong) strong.textContent = formatDisplay(clampToControl(Number(raw), control), control);
      }
      if (!raf) raf = requestAnimationFrame(flush);
    },
    debounced: function (raw) {
      pending = raw;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 150);
    },
    now: function (raw) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (timer) { clearTimeout(timer); timer = 0; }
      pending = raw;
      flush();
    }
  };
}

document.querySelectorAll('[data-ui]').forEach(function (el) {
  var control = controlFor(el.dataset.ui);
  if (!control) return;
  var type = control.type || 'text';
  if (type === 'readout') return;

  if (type === 'button') {
    el.addEventListener('click', function () {
      if (control.bind) {
        if (control.action === 'increment') publish(control.bind, (Number(NB_STATE[control.bind]) || 0) + 1, el, null);
        else if (control.action === 'toggle') publish(control.bind, !NB_STATE[control.bind], el, null);
        else publish(control.bind, control.value === undefined ? Date.now() : control.value, el, null);
      }
      if (control.set && typeof control.set === 'object') {
        Object.keys(control.set).forEach(function (k) { publish(k, control.set[k], el, null); });
      }
    });
    return;
  }
  if (!control.bind) return;

  var commit = makeCommitter(el, control);
  if (type === 'checkbox') {
    el.addEventListener('change', function () { commit.now(el.checked); });
  } else if (type === 'radio' || type === 'select' || type === 'color' || type === 'date') {
    el.addEventListener('change', function () { commit.now(el.value); });
  } else if (type === 'slider') {
    el.addEventListener('input', function () { commit.throttled(el.value); });
    el.addEventListener('change', function () { commit.now(el.value); });
  } else {
    el.addEventListener('input', function () { commit.debounced(el.value); });
    el.addEventListener('change', function () { commit.now(el.value); });
  }
});

// nb.set() coming back up from an HTML cell.
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d[MARKER] !== 'set' || typeof d.key !== 'string') return;
  publish(d.key, d.value, null, e.source);
});

// Fit HTML cell iframes while preserving their saved viewport and scale.
function fitHtmlFrames() {
  document.querySelectorAll('.c-html-shell').forEach(function (shell) {
    var width = Math.max(320, Number(shell.dataset.width) || 1920);
    var height = Math.max(240, Number(shell.dataset.height) || 1080);
    var userScale = Math.min(2, Math.max(0.25, Number(shell.dataset.scale) || 1));
    var fitScale = Math.min(1, Math.max(1, shell.clientWidth) / width);
    var scale = fitScale * userScale;
    var frame = shell.querySelector('iframe');
    if (!frame) return;
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    shell.style.height = Math.ceil(height * scale) + 'px';
    var status = shell.nextElementSibling;
    if (status && status.classList.contains('c-html-status')) {
      status.textContent = 'Rendering ' + width + 'x' + height + ' at ' + Math.round(scale * 100) + '%';
    }
  });
}

// HTML returned by a cell reports its own height, as it does in the app.
window.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d['${HTML_VALUE_MARKER}'] !== 'height') return;
  document.querySelectorAll('iframe.c-value').forEach(function (frame) {
    if (frame.contentWindow !== e.source) return;
    frame.style.height = Math.min(${MAX_AUTO_HEIGHT}, Math.max(24, Math.ceil(Number(d.height) || 0))) + 'px';
  });
});

frames().forEach(function (frame) {
  frame.addEventListener('load', function () { sendSnapshot(frame); });
});
fitHtmlFrames();
window.addEventListener('resize', fitHtmlFrames);
`;

// Renders cell output payloads: text, value, image, html-iframe, vega-lite.

import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { HTML_PREVIEW_DEFAULTS, normaliseHtmlPreview } from '../services/htmlPreview.js';
import * as nbBridge from '../services/nbBridge.js';
import { buildHtmlCellSrcdoc, HTML_NB_BRIDGE_MARKER, toJsonSafe } from '../services/htmlNbBridge.js';
import {
  buildValueSrcdoc,
  clampHeight,
  HTML_VALUE_MARKER,
  looksLikeHtml,
} from '../services/htmlValueOutput.js';
import { isVegaLiteSpec, prepareVegaLiteSpec } from '../services/vegaSpec.js';
import { trackVegaView } from '../services/vegaRuntime.js';

let vegaLoadPromise = null;
const VEGA_URL = new URL('../../shared/lib/vega/5/vega.min.js', import.meta.url).href;
const VEGA_LITE_URL = new URL('../../shared/lib/vega-lite/5/vega-lite.min.js', import.meta.url).href;
const VEGA_EMBED_URL = new URL('../../shared/lib/vega-embed/6/vega-embed.min.js', import.meta.url).href;

export function ensureVega() {
  if (vegaLoadPromise) return vegaLoadPromise;
  vegaLoadPromise = (async () => {
    const load = (src) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
    if (!window.vega) await load(VEGA_URL);
    if (!window.vegaLite) await load(VEGA_LITE_URL);
    if (!window.vegaEmbed) await load(VEGA_EMBED_URL);
  })();
  return vegaLoadPromise;
}

function looksLikeBase64Image(s) {
  return typeof s === 'string' && /^[A-Za-z0-9+/=\s]{100,}$/.test(s.slice(0, 200));
}

function formatValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function HtmlFrame({ source, preview, onPreviewChange }) {
  const ref = useRef(null);
  const shellRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const settings = normaliseHtmlPreview(preview);
  const displayScale = fitScale * settings.scale;
  const displayHeight = Math.max(1, Math.ceil(settings.height * displayScale));

  useEffect(() => {
    if (ref.current) ref.current.srcdoc = buildHtmlCellSrcdoc(source, nbBridge.snapshot());
  }, [source]);

  // Relay nb state into the sandboxed document and accept nb.set writes back.
  // A single-key change is posted as a lightweight `patch` so a slider drag
  // never re-clones the whole (possibly large) state into the iframe; only
  // bulk changes (replace/clear/initial) send the full snapshot.
  useEffect(() => {
    const unsubscribe = nbBridge.subscribe((values, change) => {
      const win = ref.current?.contentWindow;
      if (!win) return;
      if (change && change.type === 'set') {
        win.postMessage({ [HTML_NB_BRIDGE_MARKER]: 'patch', key: change.key, value: change.value }, '*');
      } else if (change && change.type === 'delete') {
        win.postMessage({ [HTML_NB_BRIDGE_MARKER]: 'patch', key: change.key, remove: true }, '*');
      } else {
        win.postMessage({ [HTML_NB_BRIDGE_MARKER]: 'update', values }, '*');
      }
    });
    const onMessage = (e) => {
      const win = ref.current?.contentWindow;
      if (!win || e.source !== win) return;
      const d = e.data;
      if (!d || d[HTML_NB_BRIDGE_MARKER] !== 'set' || typeof d.key !== 'string') return;
      try {
        nbBridge.setValue(d.key, toJsonSafe(d.value));
      } catch { /* non-JSON value — drop the write */ }
    };
    window.addEventListener('message', onMessage);
    return () => {
      unsubscribe();
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const updateFit = () => {
      const availableWidth = Math.max(1, node.clientWidth);
      setFitScale(Math.min(1, availableWidth / settings.width));
    };

    updateFit();
    if (!window.ResizeObserver) {
      window.addEventListener('resize', updateFit);
      return () => window.removeEventListener('resize', updateFit);
    }
    const observer = new ResizeObserver(updateFit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [settings.width]);

  function updatePreview(patch) {
    onPreviewChange?.(normaliseHtmlPreview({ ...settings, ...patch }));
  }

  return html`
    <div class="html-preview-toolbar">
      <span>Viewport</span>
      <input
        type="number"
        min="320"
        max="3840"
        step="10"
        value=${settings.width}
        title="HTML iframe viewport width"
        onChange=${(e) => updatePreview({ width: e.currentTarget.value })}
      />
      <span>x</span>
      <input
        type="number"
        min="240"
        max="2160"
        step="10"
        value=${settings.height}
        title="HTML iframe viewport height"
        onChange=${(e) => updatePreview({ height: e.currentTarget.value })}
      />
      <label class="html-preview-scale">
        <span>Scale ${Math.round(settings.scale * 100)}%</span>
        <input
          type="range"
          min="0.25"
          max="2"
          step="0.05"
          value=${settings.scale}
          title="Display scale relative to fit-to-width"
          onInput=${(e) => updatePreview({ scale: e.currentTarget.value })}
        />
      </label>
      <button
        class="btn btn-small"
        title="Reset to full HD viewport"
        onClick=${() => updatePreview(HTML_PREVIEW_DEFAULTS)}
      >
        HD
      </button>
    </div>
    <div
      class="html-preview-shell"
      ref=${shellRef}
      tabindex="0"
      role="region"
      aria-label="HTML cell preview"
      style=${{
        height: `${displayHeight}px`,
      }}
    >
      <iframe
        class="html-output-frame"
        title="HTML cell output"
        sandbox="allow-scripts"
        ref=${ref}
        onLoad=${() => {
          const win = ref.current?.contentWindow;
          if (win) win.postMessage({ [HTML_NB_BRIDGE_MARKER]: 'update', values: nbBridge.snapshot() }, '*');
        }}
        style=${{
          width: `${settings.width}px`,
          height: `${settings.height}px`,
          transform: `scale(${displayScale})`,
        }}
      ></iframe>
    </div>
    <div class="html-preview-status">
      Rendering ${settings.width}x${settings.height} at ${Math.round(displayScale * 100)}%
      ${settings.scale !== 1 ? ` (${Math.round(settings.scale * 100)}% user scale)` : ''}
    </div>
  `;
}

/**
 * A cell value that is HTML, rendered as HTML — in its own sandboxed document
 * so a returned `<style>` block cannot reach the notebook, and auto-sized to
 * the content so the output box hugs the render. **Source** shows the markup
 * that produced it, which is what this output used to display.
 */
function HtmlValueFrame({ value }) {
  const ref = useRef(null);
  const shellRef = useRef(null);
  const [height, setHeight] = useState(24);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (showSource) return undefined;
    const onMessage = (e) => {
      const win = ref.current?.contentWindow;
      if (!win || e.source !== win) return;
      if (e.data?.[HTML_VALUE_MARKER] !== 'height') return;
      setHeight(clampHeight(e.data.height));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [showSource]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame || showSource) return;
    // Read the theme off the live output element rather than hardcoding it, so
    // the sandbox matches whichever notebook theme is active.
    const host = shellRef.current || frame;
    const computed = window.getComputedStyle(host);
    // Colour from the output box, but font from the page: cell output is
    // monospace because it prints source, and a *render* wants the UI font.
    const page = window.getComputedStyle(document.body);
    frame.srcdoc = buildValueSrcdoc(value, {
      color: computed.color,
      fontFamily: page.fontFamily,
      fontSize: page.fontSize,
      colorScheme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    });
  }, [value, showSource]);

  return html`
    <div class="html-value-output" ref=${shellRef}>
      <div class="html-value-toolbar">
        <button
          class=${`btn btn-small ${showSource ? '' : 'active'}`}
          onClick=${() => setShowSource(false)}
          title="Render the returned HTML"
        >Rendered</button>
        <button
          class=${`btn btn-small ${showSource ? 'active' : ''}`}
          onClick=${() => setShowSource(true)}
          title="Show the HTML source the cell returned"
        >Source</button>
      </div>
      ${showSource
        ? html`<div class="html-value-source">${value}</div>`
        : html`
          <iframe
            class="html-value-frame"
            title="Rendered HTML value"
            sandbox="allow-scripts"
            ref=${ref}
            style=${{ height: `${height}px` }}
          ></iframe>
        `}
    </div>
  `;
}

function VegaChart({ spec }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let release = null;
    const node = ref.current;
    if (node) node.replaceChildren();
    (async () => {
      await ensureVega();
      if (cancelled || !node) return;
      try {
        const result = await window.vegaEmbed(node, prepareVegaLiteSpec(spec), { actions: false });
        if (cancelled) {
          try { result?.finalize?.(); } catch { /* view was superseded */ }
          return;
        }
        release = trackVegaView(result);
      } catch (err) {
        if (!cancelled && node) node.textContent = 'Vega error: ' + err.message;
      }
    })();
    return () => {
      cancelled = true;
      release?.();
      if (node) node.replaceChildren();
    };
  }, [JSON.stringify(spec)]);
  return html`<div class="vega-chart" ref=${ref}></div>`;
}

export function OutputRenderer({ outputs, error, hidden, kind, source, metadata, onHtmlPreviewChange }) {
  if (hidden) return null;
  if (kind === 'html') {
    return html`
      <div class="cell-output cell-output-html">
        <${HtmlFrame}
          source=${source}
          preview=${metadata?.htmlPreview}
          onPreviewChange=${onHtmlPreviewChange}
        />
      </div>
    `;
  }
  if (kind === 'chart') {
    let spec = null;
    try { spec = JSON.parse(source); } catch (e) {
      return html`<div class="cell-output output-error">Invalid Vega-Lite JSON: ${e.message}</div>`;
    }
    return html`<div class="cell-output" tabindex="0" role="region" aria-label="Chart"><${VegaChart} spec=${spec} /></div>`;
  }
  if (error) {
    return html`<div class="cell-output output-error">${error}</div>`;
  }
  if (!outputs || outputs.length === 0) return null;
  return html`
    <div class="cell-output">
      ${outputs.map((o, i) => {
        if (o.type === 'image') {
          return html`<img key=${i} src=${`data:${o.mime || 'image/png'};base64,${o.data}`} />`;
        }
        if (o.type === 'text') {
          if (looksLikeBase64Image(o.value)) {
            return html`<img key=${i} src=${`data:image/png;base64,${o.value.trim()}`} />`;
          }
          return html`<div key=${i} class=${o.role ? `output-${o.role}` : ''}>${o.value}</div>`;
        }
        if (o.type === 'value') {
          const v = o.value;
          if (isVegaLiteSpec(v)) {
            return html`<${VegaChart} key=${i} spec=${v} />`;
          }
          if (looksLikeHtml(v)) {
            return html`<${HtmlValueFrame} key=${i} value=${v} />`;
          }
          return html`<div key=${i}>${formatValue(v)}</div>`;
        }
        return null;
      })}
    </div>
  `;
}

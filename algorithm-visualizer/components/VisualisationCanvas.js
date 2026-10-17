// Canvas that dispatches to the right renderer based on `kind`. Renders via a
// simple effect on every snapshot change — fine for the scales this app cares
// about. DPR-aware for crisp drawing on high-DPI displays.

import { html } from 'htm/preact';
import { useRef, useEffect } from 'preact/hooks';

import { renderArrayBars } from '../services/renderers/arrayBars.js';
import { renderGraphView, resetGraphCache } from '../services/renderers/graphView.js';
import { renderTreeView, resetTreeCache } from '../services/renderers/treeView.js';
import { renderGridView } from '../services/renderers/gridView.js';

export function VisualisationCanvas({ snapshot, kind, mapping, theme }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const kindRef = useRef(null);

  useEffect(() => {
    if (kindRef.current !== kind) {
      resetGraphCache();
      resetTreeCache();
      kindRef.current = kind;
    }
  }, [kind]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const draw = () => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(100, Math.floor(rect.width * dpr));
      canvas.height = Math.max(100, Math.floor(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const args = {
        snapshot: snapshot || { t: -1, line: null, vars: new Map() },
        mapping: mapping || {},
        width: rect.width,
        height: rect.height,
        theme,
      };

      if (!snapshot) {
        drawEmpty(ctx, rect.width, rect.height, theme);
        return;
      }

      switch (kind) {
        case 'graph': renderGraphView(ctx, args); break;
        case 'tree':  renderTreeView(ctx, args); break;
        case 'grid':  renderGridView(ctx, args); break;
        case 'array':
        default:      renderArrayBars(ctx, args); break;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [snapshot, kind, mapping, theme]);

  return html`
    <div class="viz-wrapper" ref=${wrapperRef}>
      <canvas ref=${canvasRef} class="viz-canvas"></canvas>
    </div>
  `;
}

function drawEmpty(ctx, width, height, theme) {
  ctx.fillStyle = theme === 'dark' ? '#0b1020' : '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme === 'dark' ? '#64748b' : '#94a3b8';
  ctx.font = '14px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Press Run to trace the algorithm', width / 2, height / 2);
}

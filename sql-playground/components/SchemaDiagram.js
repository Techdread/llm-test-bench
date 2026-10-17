// Simple SVG ER diagram. Tables render as boxes listing columns; foreign keys
// render as arrows between tables.

import { html } from 'htm/preact';
import { useMemo, useRef, useState, useEffect } from 'preact/hooks';
import { layoutSchema } from '../services/erDiagram.js';

const BOX_W = 170;
const ROW_H = 16;
const HEADER_H = 22;
const PAD = 10;

export function SchemaDiagram({ schema }) {
  const hostRef = useRef(null);
  const [size, setSize] = useState({ width: 640, height: 440 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: Math.max(el.clientWidth, 320), height: Math.max(el.clientHeight, 320) });
    });
    ro.observe(el);
    setSize({ width: Math.max(el.clientWidth, 320), height: Math.max(el.clientHeight, 320) });
    return () => ro.disconnect();
  }, []);

  const { nodes, edges, positions } = useMemo(() => {
    if (!schema || (schema.tables || []).length === 0) {
      return { nodes: [], edges: [], positions: new Map() };
    }
    return layoutSchema(schema, { width: size.width, height: size.height });
  }, [schema, size.width, size.height]);

  function boxHeight(node) {
    return HEADER_H + Math.min(node.columns.length, 10) * ROW_H + PAD;
  }

  function edgePath(from, to) {
    // simple curve between box centres
    const x1 = from.x + BOX_W / 2;
    const y1 = from.y + HEADER_H / 2;
    const x2 = to.x + BOX_W / 2;
    const y2 = to.y + HEADER_H / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }

  return html`
    <div class="schema-diagram" ref=${hostRef}>
      ${(!schema || !schema.tables || schema.tables.length === 0)
        ? html`<div class="muted side-empty">Diagram is empty — add tables to see the ER layout.</div>`
        : html`
          <svg width=${size.width} height=${size.height}>
            <defs>
              <marker id="er-arrow" viewBox="0 -5 10 10" refX="8" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,-5L10,0L0,5" fill="currentColor" />
              </marker>
            </defs>
            <g class="er-edges">
              ${edges.map((e, i) => {
                const p1 = positions.get(e.source);
                const p2 = positions.get(e.target);
                if (!p1 || !p2) return null;
                return html`
                  <path key=${i} d=${edgePath(p1, p2)} stroke="currentColor" stroke-width="1.2"
                        fill="none" marker-end="url(#er-arrow)" opacity="0.55" />
                `;
              })}
            </g>
            <g class="er-nodes">
              ${nodes.map(node => {
                const p = positions.get(node.id);
                if (!p) return null;
                const h = boxHeight(node);
                const shown = node.columns.slice(0, 10);
                const moreCount = node.columns.length - shown.length;
                return html`
                  <g key=${node.id} transform=${`translate(${p.x}, ${p.y})`} class="er-node">
                    <rect width=${BOX_W} height=${h} rx="6" ry="6" />
                    <rect class="er-header" width=${BOX_W} height=${HEADER_H} rx="6" ry="6" />
                    <text x=${BOX_W / 2} y=${HEADER_H / 2 + 4} text-anchor="middle" class="er-title">${node.id}</text>
                    ${shown.map((col, i) => html`
                      <text key=${col.name} x="8" y=${HEADER_H + ROW_H * i + 12} class="er-col">
                        ${col.pk ? '★ ' : ''}${col.name}
                        <tspan class="er-type" dx="6">${col.type || ''}</tspan>
                      </text>
                    `)}
                    ${moreCount > 0 && html`
                      <text x="8" y=${HEADER_H + ROW_H * shown.length + 12} class="er-col er-more">
                        +${moreCount} more…
                      </text>
                    `}
                  </g>
                `;
              })}
            </g>
          </svg>
        `}
    </div>
  `;
}

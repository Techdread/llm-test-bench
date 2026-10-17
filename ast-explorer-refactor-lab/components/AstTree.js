// AST tree viewer — renders a virtualised flat list of visible rows derived
// from the expand/collapse state. Only rows within the scroll viewport are
// painted (simple windowing: ~40 extra rows above/below).

import { html } from 'htm/preact';
import { useMemo, useState, useRef, useEffect, useCallback } from 'preact/hooks';

const ROW_HEIGHT = 22;
const OVERSCAN = 40;

export function AstTree({ tree, selectedId, onSelect, expandedIds, onToggleExpand, expandAllToken }) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(500);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => flatten(tree?.root, expandedIds), [tree, expandedIds, expandAllToken]);

  // Auto-scroll to keep the selected row visible.
  useEffect(() => {
    if (!selectedId) return;
    const idx = rows.findIndex(r => r.entry.id === selectedId);
    if (idx < 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const top = idx * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top - 20;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 20;
  }, [selectedId, rows]);

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(startIdx, endIdx);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (!tree?.root) {
    return html`<div class="ast-scroll"><div class="muted" style=${{ padding: '20px' }}>No AST yet.</div></div>`;
  }

  const totalH = rows.length * ROW_HEIGHT;

  return html`
    <div class="ast-scroll" ref=${scrollRef} onScroll=${handleScroll}>
      <div style=${{ height: totalH + 'px', position: 'relative' }}>
        ${visible.map((row, i) => html`
          <div
            key=${row.entry.id}
            class=${`ast-row ${row.entry.id === selectedId ? 'selected' : ''}`}
            style=${{
              position: 'absolute',
              top: ((startIdx + i) * ROW_HEIGHT) + 'px',
              left: 0, right: 0,
              paddingLeft: (8 + row.depth * 14) + 'px',
              height: ROW_HEIGHT + 'px',
            }}
            onClick=${() => onSelect(row.entry)}
          >
            <span
              class=${`ast-toggle ${row.entry.children.length === 0 ? 'leaf' : ''}`}
              onClick=${(e) => { e.stopPropagation(); if (row.entry.children.length) onToggleExpand(row.entry.id); }}
            >${row.entry.children.length === 0 ? '•' : (row.expanded ? '▾' : '▸')}</span>
            ${row.entry.field && html`<span class="ast-field">${row.entry.field}:</span>`}
            <span class="ast-kind">${row.entry.kind}</span>
            ${row.entry.label && html`<span class="ast-val">${row.entry.label}</span>`}
            ${row.entry.loc && html`<span class="ast-loc">L${row.entry.loc.start.line}</span>`}
          </div>
        `)}
      </div>
    </div>
  `;
}

function flatten(root, expandedIds) {
  const out = [];
  if (!root) return out;
  function walk(entry, depth) {
    const expanded = expandedIds.has(entry.id);
    out.push({ entry, depth, expanded });
    if (!expanded) return;
    for (const group of entry.children) {
      for (const kid of group.nodes) walk(kid, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

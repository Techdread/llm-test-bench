// Virtualised results grid. Renders only the visible rows (+ a small buffer)
// so 100k+ row result sets stay snappy.

import { html } from 'htm/preact';
import { useRef, useState, useEffect, useMemo } from 'preact/hooks';

const ROW_HEIGHT = 26;
const BUFFER = 6;

function cellDisplay(v) {
  if (v == null) return html`<span class="cell-null">NULL</span>`;
  if (v instanceof Uint8Array) return `<BLOB ${v.byteLength} bytes>`;
  if (typeof v === 'number') return String(v);
  return String(v);
}

export function ResultsGrid({ result, error, status, duration }) {
  const scrollerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(240);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    el.addEventListener('scroll', onScroll);
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [result]);

  const columns = result?.columns || [];
  const rows = result?.rows || [];
  const rowCount = rows.length;
  const totalH = rowCount * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIdx = Math.min(rowCount, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + BUFFER);
  const slice = useMemo(() => rows.slice(startIdx, endIdx), [rows, startIdx, endIdx]);
  const padTop = startIdx * ROW_HEIGHT;
  const padBottom = Math.max(0, totalH - endIdx * ROW_HEIGHT);

  if (error) {
    return html`
      <div class="results-pane">
        <div class="results-error">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <pre>${error}</pre>
        </div>
      </div>
    `;
  }

  if (!result) {
    return html`
      <div class="results-pane">
        <div class="results-empty muted">${status || 'Run a query to see results.'}</div>
      </div>
    `;
  }

  return html`
    <div class="results-pane">
      <div class="results-meta">
        <span>${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}</span>
        ${duration != null && html`<span>· ${Math.round(duration)} ms</span>`}
        ${columns.length > 0 && html`<span>· ${columns.length} col${columns.length === 1 ? '' : 's'}</span>`}
      </div>
      <div class="results-grid-scroller" ref=${scrollerRef}>
        ${columns.length === 0 && rowCount === 0
          ? html`<div class="results-empty muted">Statement executed. No result set.</div>`
          : html`
            <table class="results-grid">
              <thead>
                <tr>
                  <th class="row-num-header">#</th>
                  ${columns.map((c, i) => html`<th key=${i}>${c}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${padTop > 0 && html`<tr style=${{ height: padTop + 'px' }}><td colspan=${columns.length + 1}></td></tr>`}
                ${slice.map((row, i) => html`
                  <tr key=${startIdx + i} style=${{ height: ROW_HEIGHT + 'px' }}>
                    <td class="row-num">${startIdx + i + 1}</td>
                    ${row.map((v, j) => html`<td key=${j}>${cellDisplay(v)}</td>`)}
                  </tr>
                `)}
                ${padBottom > 0 && html`<tr style=${{ height: padBottom + 'px' }}><td colspan=${columns.length + 1}></td></tr>`}
              </tbody>
            </table>
          `}
      </div>
    </div>
  `;
}

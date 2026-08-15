import { html } from 'htm/preact';
import { Fragment } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';

// Small inline SVG renderer (mirrors SvgPreview).
export function SvgLive({ svg }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = (svg && svg.trim()) ? svg : '';
  }, [svg]);
  return html`<div class="batch-svg-live" ref=${ref}></div>`;
}

// Full-screen lightbox for examining a single generation up close. Sits above
// everything (including the batch dialog) and closes on backdrop click, the X,
// or Escape. Uses a capture-phase key handler so Escape/arrows close the
// lightbox instead of leaking to the review's own nav underneath.
export function SvgLightbox({ svg, title, subtitle, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return html`
    <div class="svg-lightbox-overlay" onClick=${onClose}>
      <div class="svg-lightbox" onClick=${(e) => e.stopPropagation()}>
        <div class="svg-lightbox-head">
          <div class="svg-lightbox-title">
            <strong title=${title}>${title}</strong>
            ${subtitle ? html`<span title=${subtitle}>${subtitle}</span>` : null}
          </div>
          <button class="btn-icon" onClick=${onClose} title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="svg-lightbox-stage"><${SvgLive} svg=${svg} /></div>
      </div>
    </div>
  `;
}

// A results list + big preview with ‹ › arrows, shared by the just-finished run
// and the past-run browser.
//
// rows: [{ key, title, prompt, slug, svg, icon, cls, label, autoScore, healed, error }]
//       Rows without an `svg` (failed/skipped) still show in the list but are
//       skipped by the arrows.
// resetKey: changes when `rows` describes a different run — jumps back to the first.
// hideNav + onNav let a caller lift the ‹ › prev/next control out of the review
// column and render it elsewhere (e.g. the batch dialog's footer). onNav is
// called with { current, count, canStep, step } whenever the position changes.
export function BatchReview({ rows, resetKey, onOpenBenchmark, hideNav, onNav }) {
  const [pos, setPos] = useState(0);
  const [zoom, setZoom] = useState(null);

  const reviewable = useMemo(
    () => rows.map((_, i) => i).filter(i => (rows[i].svg || '').trim()),
    [rows],
  );

  useEffect(() => { setPos(0); }, [resetKey]);

  const idx = reviewable[Math.min(pos, Math.max(0, reviewable.length - 1))] ?? -1;

  const step = useCallback((delta) => {
    setPos(prev => {
      const n = reviewable.length;
      if (n === 0) return 0;
      return (prev + delta + n) % n; // wrap around
    });
  }, [reviewable.length]);

  useEffect(() => {
    if (reviewable.length < 2) return;
    const onKey = (e) => {
      if (e.target?.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewable.length, step]);

  // Report nav state up so a caller can render the control in its own footer.
  useEffect(() => {
    if (!onNav) return;
    onNav({
      current: idx < 0 ? 0 : reviewable.indexOf(idx) + 1,
      count: reviewable.length,
      canStep: reviewable.length >= 2,
      step,
    });
  }, [onNav, idx, reviewable, step]);

  const fmtScore = (s) => (s == null ? '' : `${Math.round(s * 100)}%`);
  const cur = idx < 0 ? null : rows[idx];

  // Per-generation telemetry: how fast, and whether the model actually thought.
  const statsBits = (s) => {
    if (!s) return null;
    const bits = [];
    if (s.tokensPerSecond != null) bits.push(`${s.tokensPerSecond} tok/s`);
    if (s.ttftMs != null) bits.push(`${(s.ttftMs / 1000).toFixed(1)}s to first token`);
    if (s.completionTokens != null) bits.push(`${s.completionTokens} tokens`);
    if (s.thought) bits.push(`thought${s.reasoningTokens ? ` (${s.reasoningTokens})` : ''}`);
    if (s.finishReason && s.finishReason !== 'stop') bits.push(s.finishReason);
    return bits.length ? bits.join(' · ') : null;
  };

  return html`
    <${Fragment}>
    <div class="batch-run-body">
      <div class="batch-run-left">
      <div class="batch-run-list batch-run-list-done">
        ${rows.map((r, i) => {
          const hasSvg = !!(r.svg || '').trim();
          return html`
            <div
              class=${`batch-run-item ${r.cls || ''} ${hasSvg ? 'is-reviewable' : ''} ${i === idx ? 'is-active' : ''}`}
              key=${r.key}
              onClick=${hasSvg ? () => setPos(reviewable.indexOf(i)) : null}
            >
              <i class=${`batch-run-icon fa ${r.icon || ''}`}></i>
              <span class="batch-run-title" title=${r.title}>${r.title}</span>
              <span class="batch-run-status">
                ${r.label}
                ${r.autoScore != null ? html` <span class="batch-score-chip">${fmtScore(r.autoScore)}</span>` : null}
                ${r.healed ? html` <span class="batch-healed-chip">fixed</span>` : null}
                ${r.error ? html`<span class="batch-run-err" title=${r.error}> — ${r.error}</span>` : null}
              </span>
            </div>
          `;
        })}
      </div>
      ${!hideNav && reviewable.length > 0 && html`
        <div class="batch-review-nav batch-review-nav-under">
          <button class="btn btn-sm" title="Previous (←)" onClick=${() => step(-1)} disabled=${reviewable.length < 2}>
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="batch-review-count">${reviewable.indexOf(idx) + 1} / ${reviewable.length}</span>
          <button class="btn btn-sm" title="Next (→)" onClick=${() => step(1)} disabled=${reviewable.length < 2}>
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      `}
      </div>

      <div class="batch-review">
        ${!cur ? html`
          <div class="batch-preview">
            <div class="batch-preview-empty">
              <i class="fa-solid fa-image"></i><span>Nothing to preview in this run</span>
            </div>
          </div>
        ` : html`
          <div class="batch-review-head">
            <span class="batch-review-title" title=${cur.prompt || cur.title}>${cur.title}</span>
            ${cur.autoScore != null ? html`<span class="batch-score-chip">${fmtScore(cur.autoScore)}</span>` : null}
            ${cur.healed ? html`<span class="batch-healed-chip">fixed</span>` : null}
            ${onOpenBenchmark && cur.slug && html`
              <button class="btn btn-xs" title="Open this benchmark" onClick=${() => onOpenBenchmark(cur.slug)}>
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
              </button>
            `}
          </div>
          ${(cur.paramsLabel || statsBits(cur.stats)) && html`
            <div class="batch-review-meta">
              ${cur.paramsLabel ? html`<span class="batch-params-chip"><i class="fa-solid fa-sliders"></i> ${cur.paramsLabel}</span>` : null}
              ${statsBits(cur.stats) ? html`<span class="batch-stats-line">${statsBits(cur.stats)}</span>` : null}
            </div>
          `}
          <div class="batch-preview is-zoomable" title="Click to enlarge" onClick=${() => setZoom(cur)}>
            <${SvgLive} svg=${cur.svg} />
            <span class="zoom-hint"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
          </div>
        `}
      </div>
    </div>
    ${zoom && html`<${SvgLightbox}
      svg=${zoom.svg}
      title=${zoom.title}
      subtitle=${zoom.prompt || ''}
      onClose=${() => setZoom(null)}
    />`}
    <//>
  `;
}

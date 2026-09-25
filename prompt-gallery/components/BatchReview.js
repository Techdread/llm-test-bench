import { html } from 'htm/preact';
import { Fragment } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { VerificationBadge, VerificationDetails } from './VerificationBadge.js';
import { RatingWidget } from './RatingWidget.js';
import { ratingFromKey, RATING_MAX } from '../services/rating.js';

// Live HTML preview in a sandboxed iframe. srcdoc is (re)applied after the
// element is laid out and cleared first, so swapping generations tears down the
// previous document's scripts/animations instead of leaving them running.
export function HtmlLive({ html: content }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.srcdoc = '';
    const id = requestAnimationFrame(() => { if (ref.current) ref.current.srcdoc = content || ''; });
    return () => cancelAnimationFrame(id);
  }, [content]);
  return html`<iframe class="batch-html-live" ref=${ref}
    sandbox="allow-scripts allow-modals allow-pointer-lock" title="Preview"></iframe>`;
}

// Full-screen lightbox for examining a single generation up close. Sits above
// everything and closes on backdrop click, the X, or Escape. A capture-phase
// key handler keeps Escape/arrows from leaking to the review nav underneath.
export function HtmlLightbox({ html: content, title, subtitle, emptyMessage = '', onClose }) {
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
    <div class="html-lightbox-overlay" onClick=${onClose}>
      <div class="html-lightbox" onClick=${(e) => e.stopPropagation()}>
        <div class="html-lightbox-head">
          <div class="html-lightbox-title">
            <strong title=${title}>${title}</strong>
            ${subtitle ? html`<span title=${subtitle}>${subtitle}</span>` : null}
          </div>
          <button class="btn-icon" onClick=${onClose} title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="html-lightbox-stage">
          ${content
            ? html`<${HtmlLive} html=${content} />`
            : html`<div class="html-lightbox-empty"><i class="fa-solid fa-spinner fa-spin"></i><span>${emptyMessage || 'Waiting for output…'}</span></div>`}
        </div>
      </div>
    </div>
  `;
}

// A results list + big preview with ‹ › arrows, shared by the just-finished run
// and the past-run browser.
//
// rows: [{ key, title, prompt, id, html, icon, cls, label, autoScore, healed, error, rating }]
//       Rows without `html` (failed/skipped) still show in the list but are
//       skipped by the arrows.
// resetKey: changes when `rows` describes a different run — jumps back to the first.
// onRate(id, value): when given, the shown generation can be judged 0–10 with
//       the stars or the number keys (1–9, 0 = 10).
export function BatchReview({ rows, resetKey, onOpen, onRate }) {
  const [pos, setPos] = useState(0);
  const [zoom, setZoom] = useState(null);

  const reviewable = useMemo(
    () => rows.map((_, i) => i).filter(i => (rows[i].html || '').trim()),
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

  const fmtScore = (s) => (s == null ? '' : `${Math.round(s * 100)}%`);
  const cur = idx < 0 ? null : rows[idx];
  const canRate = !!(onRate && cur?.id);

  // Judge while stepping through: number keys rate the generation on screen.
  const curId = cur?.id || '';
  useEffect(() => {
    if (!onRate || !curId) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('input, select, textarea, [contenteditable]')) return;
      const value = ratingFromKey(e.key);
      if (value == null) return;
      e.preventDefault();
      onRate(curId, value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRate, curId]);

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
          const hasHtml = !!(r.html || '').trim();
          return html`
            <div
              class=${`batch-run-item ${r.cls || ''} ${hasHtml ? 'is-reviewable' : ''} ${i === idx ? 'is-active' : ''}`}
              key=${r.key}
              onClick=${hasHtml ? () => setPos(reviewable.indexOf(i)) : null}
            >
              <i class=${`batch-run-icon fa ${r.icon || ''}`}></i>
              <div class="batch-run-label">
                <span class="batch-run-title" title=${r.prompt || r.title}>${r.title}</span>
                ${r.subtitle ? html`<span class="batch-run-sub" title=${`Generated: ${r.subtitle}`}>${r.subtitle}</span>` : null}
              </div>
              <span class="batch-run-status">
                ${r.label}
                ${r.rating > 0 ? html` <span class="batch-rating-chip" title=${`Rated ${r.rating}/${RATING_MAX}`}><i class="fa-solid fa-star"></i> ${r.rating}</span>` : null}
                ${r.autoScore != null ? html` <span class="batch-score-chip">${fmtScore(r.autoScore)}</span>` : null}
                ${r.healed ? html` <span class="batch-healed-chip">fixed</span>` : null}
                ${r.verification ? html` <${VerificationBadge} verification=${r.verification} />` : null}
                ${r.error ? html`<span class="batch-run-err" title=${r.error}> — ${r.error}</span>` : null}
              </span>
            </div>
          `;
        })}
      </div>
      ${reviewable.length > 0 && html`
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
            ${cur.subtitle ? html`<span class="batch-review-gen" title=${`Generated: ${cur.subtitle}`}>${cur.subtitle}</span>` : null}
            ${cur.autoScore != null ? html`<span class="batch-score-chip">${fmtScore(cur.autoScore)}</span>` : null}
            ${cur.healed ? html`<span class="batch-healed-chip">fixed</span>` : null}
            ${cur.verification ? html`<${VerificationBadge} verification=${cur.verification} />` : null}
            ${onOpen && cur.id && html`
              <button class="btn btn-xs" title="Open this generation" onClick=${() => onOpen(cur.id)}>
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
              </button>
            `}
          </div>
          ${canRate && html`
            <div class="batch-review-judge">
              <span class="batch-review-judge-label">Your rating</span>
              <${RatingWidget} rating=${cur.rating || 0} onChange=${(value) => onRate(cur.id, value)} size=${16} />
              <span class="batch-review-judge-hint">keys 1–9, 0 = 10 · click the lit star to clear</span>
            </div>
          `}
          ${(cur.paramsLabel || statsBits(cur.stats)) && html`
            <div class="batch-review-meta">
              ${cur.paramsLabel ? html`<span class="batch-params-chip"><i class="fa-solid fa-sliders"></i> ${cur.paramsLabel}</span>` : null}
              ${statsBits(cur.stats) ? html`<span class="batch-stats-line">${statsBits(cur.stats)}</span>` : null}
            </div>
          `}
          ${cur.verification && html`<${VerificationDetails}
            verification=${cur.verification}
            parentId=${cur.parentId}
            onOpenParent=${onOpen}
          />`}
          <div class="batch-preview is-zoomable" title="Click to enlarge" onClick=${() => setZoom(cur)}>
            <${HtmlLive} html=${cur.html} />
            <div class="preview-hitbox"></div>
            <span class="zoom-hint"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
          </div>
        `}
      </div>
    </div>
    ${zoom && html`<${HtmlLightbox}
      html=${zoom.html}
      title=${zoom.title}
      subtitle=${zoom.prompt || ''}
      onClose=${() => setZoom(null)}
    />`}
    <//>
  `;
}

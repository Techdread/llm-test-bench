import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CanvasPreview } from './CanvasPreview.js';

function statsLine(stats) {
  if (!stats) return '';
  const bits = [];
  if (stats.tokensPerSecond != null) bits.push(`${stats.tokensPerSecond} tok/s`);
  if (stats.ttftMs != null) bits.push(`${(stats.ttftMs / 1000).toFixed(1)}s first token`);
  if (stats.completionTokens != null) bits.push(`${stats.completionTokens} tokens`);
  if (stats.thought) bits.push(`thought${stats.reasoningTokens ? ` (${stats.reasoningTokens})` : ''}`);
  if (stats.finishReason && stats.finishReason !== 'stop') bits.push(stats.finishReason);
  return bits.join(' · ');
}

export function BatchReview({ rows, resetKey, onOpenProject }) {
  const [position, setPosition] = useState(0);
  const reviewable = useMemo(
    () => (rows || []).map((row, index) => ({ row, index })).filter(item => item.row.code?.trim()),
    [rows],
  );

  useEffect(() => setPosition(0), [resetKey]);

  const step = delta => {
    if (!reviewable.length) return;
    setPosition(current => (current + delta + reviewable.length) % reviewable.length);
  };

  useEffect(() => {
    if (reviewable.length < 2) return undefined;
    const onKey = event => {
      if (event.target?.closest?.('input, select, textarea')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewable.length]);

  const selected = reviewable[Math.min(position, Math.max(0, reviewable.length - 1))];
  const current = selected?.row || null;

  return html`
    <div class="batch-review-layout">
      <div class="batch-review-list">
        ${(rows || []).map((row, index) => {
          const reviewPosition = reviewable.findIndex(item => item.index === index);
          return html`
            <button
              type="button"
              key=${row.key || index}
              class=${`batch-run-item ${row.statusClass || ''} ${selected?.index === index ? 'is-active' : ''}`}
              disabled=${reviewPosition < 0}
              onClick=${() => reviewPosition >= 0 && setPosition(reviewPosition)}
            >
              <i class=${`batch-run-icon fa ${row.icon || 'fa-regular fa-circle'}`}></i>
              <span class="batch-run-title">${row.title}</span>
              <span class="batch-run-status">${row.statusLabel || ''}</span>
            </button>
          `;
        })}
      </div>

      <div class="batch-review-preview">
        ${current ? html`
          <div class="batch-review-head">
            <div>
              <strong>${current.title}</strong>
              ${current.paramsLabel && html`<span>${current.paramsLabel}</span>`}
              ${statsLine(current.stats) && html`<span>${statsLine(current.stats)}</span>`}
            </div>
            ${current.savedId && html`
              <button class="btn btn-sm" onClick=${() => onOpenProject?.(current.savedId)}>
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
              </button>
            `}
          </div>
          <div class="batch-canvas-stage">
            <${CanvasPreview}
              code=${current.code}
              params=${current.params || {}}
              seed=${current.seed || 1}
              playing=${true}
            />
          </div>
          <div class="batch-review-nav">
            <button class="btn btn-sm" onClick=${() => step(-1)} disabled=${reviewable.length < 2} title="Previous (←)">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span>${position + 1} / ${reviewable.length}</span>
            <button class="btn btn-sm" onClick=${() => step(1)} disabled=${reviewable.length < 2} title="Next (→)">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
        ` : html`
          <div class="batch-preview-empty"><i class="fa-solid fa-code"></i><span>No generated sketches to review</span></div>
        `}
      </div>
    </div>
  `;
}


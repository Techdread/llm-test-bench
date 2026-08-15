import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function CompareView({ submissions, referenceUrl, benchmarkPrompt, onBack }) {
  const [showCode, setShowCode] = useState(false);

  if (!submissions || submissions.length === 0) {
    return html`
      <div class="gallery-empty">
        <i class="fa-solid fa-columns"></i>
        <p>No submissions to compare</p>
        <button class="btn" onClick=${onBack}>
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
      </div>
    `;
  }

  const cols = Math.min(submissions.length, 4);

  return html`
    <div class="compare-view">
      <div class="compare-toolbar">
        <button class="btn" onClick=${onBack}>
          <i class="fa-solid fa-arrow-left"></i>
          <span class="btn-label">Back</span>
        </button>
        <span class="compare-title">${benchmarkPrompt || 'Compare Submissions'}</span>
        <div class="compare-actions">
          <button class=${`btn ${showCode ? 'btn-primary' : ''}`} onClick=${() => setShowCode(s => !s)}>
            <i class="fa-solid fa-code"></i>
            <span class="btn-label">Code</span>
          </button>
        </div>
      </div>

      <div class="compare-grid" style=${{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        ${submissions.map(sub => html`
          <div class="compare-col" key=${sub.id}>
            <div class="compare-col-header">
              <span class="compare-col-title">${sub.model || sub.id}</span>
              <div class="compare-col-scores">
                ${sub.autoScore != null && html`
                  <span class="score-badge-sm ${sub.autoScore >= 0.8 ? 'good' : sub.autoScore >= 0.5 ? 'ok' : 'poor'}">
                    ${Math.round(sub.autoScore * 100)}%
                  </span>
                `}
                ${sub.manualScore > 0 && html`
                  <span class="score-badge-sm manual">${sub.manualScore}/10</span>
                `}
              </div>
            </div>
            <div class="compare-col-svg">
              <div class="compare-svg-render" dangerouslySetInnerHTML=${{ __html: sub.svg || '' }}></div>
            </div>
            ${showCode && html`
              <div class="compare-col-code">
                <pre><code>${sub.svg || ''}</code></pre>
              </div>
            `}
          </div>
        `)}
      </div>

      ${referenceUrl && html`
        <div class="compare-reference">
          <div class="compare-ref-header">
            <span><i class="fa-solid fa-image"></i> Reference</span>
          </div>
          <div class="compare-ref-img-wrap">
            <img src=${referenceUrl} alt="Reference" class="compare-ref-img" />
          </div>
        </div>
      `}
    </div>
  `;
}

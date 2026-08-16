import { html } from 'htm/preact';
import { useState, useCallback } from 'preact/hooks';

export function ScorePanel({ autoScore, manualScore, svgAnalysis, onManualScoreChange, onRunAutoScore }) {
  const [hovered, setHovered] = useState(0);

  const handleStarClick = useCallback((rating) => {
    onManualScoreChange(manualScore === rating ? 0 : rating);
  }, [manualScore, onManualScoreChange]);

  const scorePercent = autoScore != null ? Math.round(autoScore * 100) : null;

  return html`
    <div class="score-panel">
      <div class="section-header">
        <span><i class="fa-solid fa-chart-bar"></i> Scoring</span>
      </div>
      <div class="score-panel-body">
        <div class="score-row">
          <span class="score-label">Auto Score</span>
          <div class="score-value-group">
            ${scorePercent != null
              ? html`
                <span class="score-percent ${scorePercent >= 80 ? 'good' : scorePercent >= 50 ? 'ok' : 'poor'}">
                  ${scorePercent}%
                </span>
              `
              : html`<span class="score-na">N/A</span>`
            }
            ${onRunAutoScore && html`
              <button class="btn btn-sm" onClick=${onRunAutoScore} title="Run pixel diff against reference">
                <i class="fa-solid fa-rotate"></i> Score
              </button>
            `}
          </div>
        </div>

        <div class="score-row">
          <span class="score-label">Manual Score</span>
          <div class="rating-widget">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => html`
              <button
                key=${n}
                class=${`rating-star ${n <= (hovered || manualScore || 0) ? 'filled' : ''} ${n <= hovered ? 'hovered' : ''}`}
                onClick=${() => handleStarClick(n)}
                onMouseEnter=${() => setHovered(n)}
                onMouseLeave=${() => setHovered(0)}
                title=${`${n}/10`}
              >
                <i class=${`fa-${n <= (manualScore || 0) ? 'solid' : 'regular'} fa-star`}></i>
              </button>
            `)}
            ${manualScore > 0 && html`<span class="rating-number">${manualScore}/10</span>`}
          </div>
        </div>

        ${svgAnalysis && html`
          <div class="score-stats">
            <div class="stat-item">
              <span class="stat-label">Elements</span>
              <span class="stat-value">${svgAnalysis.elementCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">File Size</span>
              <span class="stat-value">${formatFileSize(svgAnalysis.fileSize)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">viewBox</span>
              <span class=${`stat-value ${svgAnalysis.hasViewBox ? 'stat-ok' : 'stat-warn'}`}>
                ${svgAnalysis.hasViewBox ? 'Yes' : 'Missing'}
              </span>
            </div>
            ${svgAnalysis.hasAnimation && html`
              <div class="stat-item">
                <span class="stat-label">Animation</span>
                <span class="stat-value">Yes</span>
              </div>
            `}
            ${svgAnalysis.fileSize > 102400 && html`
              <div class="stat-item stat-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Large SVG (>100KB)</span>
              </div>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

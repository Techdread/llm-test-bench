import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { compareSvgToReference } from '../services/pixeldiff.js';

export function DiffOverlay({ svgContent, referenceUrl, onScoreComputed }) {
  const [diffDataUrl, setDiffDataUrl] = useState(null);
  const [svgDataUrl, setSvgDataUrl] = useState(null);
  const [refDataUrl, setRefDataUrl] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('diff'); // 'diff' | 'svg' | 'ref' | 'side'

  const runDiff = async () => {
    if (!svgContent || !referenceUrl) return;
    setLoading(true);
    setError(null);
    try {
      const result = await compareSvgToReference(svgContent, referenceUrl, 400);
      setDiffDataUrl(result.diffCanvas.toDataURL());
      setSvgDataUrl(result.svgCanvas.toDataURL());
      setRefDataUrl(result.refCanvas.toDataURL());
      setScore(result.score);
      if (onScoreComputed) onScoreComputed(result.score);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (svgContent && referenceUrl) {
      runDiff();
    }
  }, [svgContent, referenceUrl]);

  if (!svgContent || !referenceUrl) {
    return html`
      <div class="diff-overlay-empty">
        <i class="fa-solid fa-layer-group"></i>
        <p>Need both SVG and reference image to compute diff</p>
      </div>
    `;
  }

  if (loading) {
    return html`
      <div class="diff-overlay-loading">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <p>Computing pixel diff...</p>
      </div>
    `;
  }

  if (error) {
    return html`
      <div class="diff-overlay-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>${error}</p>
        <button class="btn" onClick=${runDiff}>Retry</button>
      </div>
    `;
  }

  return html`
    <div class="diff-overlay">
      <div class="diff-toolbar">
        <div class="diff-tabs">
          <button class=${`btn btn-sm ${view === 'diff' ? 'btn-primary' : ''}`} onClick=${() => setView('diff')}>
            Diff
          </button>
          <button class=${`btn btn-sm ${view === 'side' ? 'btn-primary' : ''}`} onClick=${() => setView('side')}>
            Side by Side
          </button>
          <button class=${`btn btn-sm ${view === 'svg' ? 'btn-primary' : ''}`} onClick=${() => setView('svg')}>
            SVG
          </button>
          <button class=${`btn btn-sm ${view === 'ref' ? 'btn-primary' : ''}`} onClick=${() => setView('ref')}>
            Reference
          </button>
        </div>
        ${score != null && html`
          <span class="diff-score ${score >= 0.8 ? 'good' : score >= 0.5 ? 'ok' : 'poor'}">
            Similarity: ${Math.round(score * 100)}%
          </span>
        `}
        <button class="btn btn-sm" onClick=${runDiff} title="Re-run diff">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>

      <div class="diff-content">
        ${view === 'diff' && diffDataUrl && html`
          <img class="diff-image" src=${diffDataUrl} alt="Pixel diff" />
        `}
        ${view === 'svg' && svgDataUrl && html`
          <img class="diff-image" src=${svgDataUrl} alt="SVG render" />
        `}
        ${view === 'ref' && refDataUrl && html`
          <img class="diff-image" src=${refDataUrl} alt="Reference" />
        `}
        ${view === 'side' && html`
          <div class="diff-side-by-side">
            <div class="diff-side-panel">
              <div class="diff-side-label">SVG</div>
              ${svgDataUrl && html`<img class="diff-image" src=${svgDataUrl} alt="SVG render" />`}
            </div>
            <div class="diff-side-panel">
              <div class="diff-side-label">Reference</div>
              ${refDataUrl && html`<img class="diff-image" src=${refDataUrl} alt="Reference" />`}
            </div>
            <div class="diff-side-panel">
              <div class="diff-side-label">Diff</div>
              ${diffDataUrl && html`<img class="diff-image" src=${diffDataUrl} alt="Diff" />`}
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

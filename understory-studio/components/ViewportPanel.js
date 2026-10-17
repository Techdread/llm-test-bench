import { html } from 'htm/preact';
import { DETAIL_LEVELS } from '../services/detailLevels.js';
import { LIGHTING_PRESETS } from '../services/studioViewer.js';

export function ViewportPanel({
  canvasRef, hasModel, detail, onDetail, surface, onSurface,
  lighting, onLighting, objects, focus, onFocus, stats, onFrame,
  status, busy, elapsed, error,
}) {
  return html`
    <div class="us-center">
      <div class="us-viewport">
        <canvas ref=${canvasRef} tabIndex="0"
                aria-label="Generated 3D model. Drag to orbit, scroll to zoom."></canvas>
        ${!hasModel && html`
          <div class="us-empty">
            <i class="fas fa-cube"></i>
            <h3>Start with a picture.</h3>
            <p>Your model takes shape here. Every revision is rendered from three
               angles and shown back to the model that built it.</p>
          </div>`}
        ${hasModel && html`<span class="us-canvas-hint">Drag to orbit · Scroll to zoom</span>`}
      </div>

      <div class="us-viewbar">
        <div class="us-levels">
          ${DETAIL_LEVELS.map(level => html`
            <button key=${level.id} title=${level.description}
                    class=${`us-level ${detail === level.id ? 'active' : ''}`}
                    disabled=${!hasModel}
                    onClick=${() => onDetail(level.id)}>${level.label}</button>`)}
        </div>
        <label>Surface
          <select value=${surface} disabled=${!hasModel} onChange=${e => onSurface(e.target.value)}>
            <option value="textured">Textured</option>
            <option value="clay">Clay</option>
            <option value="wireframe">Wireframe</option>
          </select>
        </label>
        <label>Light
          <select value=${lighting} disabled=${!hasModel} onChange=${e => onLighting(e.target.value)}>
            ${LIGHTING_PRESETS.map(preset => html`<option value=${preset.id}>${preset.label}</option>`)}
          </select>
        </label>
        <label>Focus
          <select value=${String(focus)} disabled=${!hasModel} onChange=${e => onFocus(Number(e.target.value))}>
            <option value="-1">Whole scene</option>
            ${objects.map((name, index) => html`<option key=${index} value=${String(index)}>${name}</option>`)}
          </select>
        </label>
        <button class="us-btn us-btn-sm" disabled=${!hasModel} onClick=${onFrame}>
          <i class="fas fa-expand"></i> Frame
        </button>
        <span class="us-stats">
          ${stats
            ? stats.variant === 'cleaned'
              ? `Cleaned · ${stats.triangles.toLocaleString()} tris (from ${stats.originalTriangles.toLocaleString()}, −${
                  (100 * (1 - stats.triangles / stats.originalTriangles)).toFixed(0)}%) · ${stats.meshCount} meshes`
              : `${stats.triangles.toLocaleString()} tris · ${stats.meshCount} meshes${
                  stats.detail === 'master' ? '' : ` · ${stats.reduction.toFixed(0)}% fewer than Master`}`
            : 'Five levels · Master through LOD 3'}
        </span>
      </div>

      <div class=${`us-status ${busy ? 'busy' : ''}`}>
        ${busy && html`<i class="fas fa-circle-notch fa-spin"></i>`}
        <span>${status}</span>
        ${busy && html`<span class="us-elapsed">${elapsed}</span>`}
      </div>
      ${error && html`<div class="us-error"><i class="fas fa-triangle-exclamation"></i> ${error}</div>`}
    </div>`;
}

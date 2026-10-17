// Timeline + transport controls. Pure presentation — the parent owns the
// frame index and play/pause state.

import { html } from 'htm/preact';

export function Timeline({
  total, index, onSeek,
  playing, onPlayToggle, onStep, onReset,
  speed, onSpeedChange,
  message,
}) {
  const pct = total > 0 ? (index / Math.max(total - 1, 1)) * 100 : 0;
  return html`
    <div class="timeline">
      <div class="timeline-controls">
        <button class="btn-icon" onClick=${onReset} title="Reset to start">
          <i class="fa-solid fa-backward-step"></i>
        </button>
        <button class="btn-icon" onClick=${() => onStep(-10)} title="Back 10">
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button class="btn-icon" onClick=${() => onStep(-1)} title="Step back">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button class="btn play" onClick=${onPlayToggle} title=${playing ? 'Pause' : 'Play'}>
          <i class=${`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
        </button>
        <button class="btn-icon" onClick=${() => onStep(1)} title="Step forward">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <button class="btn-icon" onClick=${() => onStep(10)} title="Forward 10">
          <i class="fa-solid fa-angles-right"></i>
        </button>
        <div class="timeline-sep"></div>
        <label class="speed-field">
          <span>Speed</span>
          <select value=${String(speed)} onChange=${(e) => onSpeedChange(Number(e.target.value))}>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
            <option value="8">8×</option>
          </select>
        </label>
        <div class="timeline-stats">${message || (total > 0 ? `${index + 1} / ${total}` : 'No trace yet')}</div>
      </div>
      <div class="timeline-scrub-wrap">
        <input
          type="range"
          class="timeline-scrub"
          aria-label="Trace step"
          min="0"
          max=${Math.max(total - 1, 0)}
          step="1"
          value=${index}
          disabled=${total <= 0}
          onInput=${(e) => onSeek(Number(e.target.value))}
        />
        <div class="timeline-bar" style=${{ width: pct + '%' }}></div>
      </div>
    </div>
  `;
}

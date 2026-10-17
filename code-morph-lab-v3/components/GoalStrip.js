import { html } from 'htm/preact';

export function GoalStrip({ goal, language, maxIterations, currentIteration, status, duration, actions }) {
  return html`
    <div class="goal-strip">
      <div class="goal-strip-goal" title=${goal}>${goal}</div>
      <div class="goal-strip-meta">
        <span>${language.toUpperCase()}</span>
        <span>·</span>
        <span>iter ${currentIteration}/${maxIterations}</span>
        <span>·</span>
        <span>${duration ? (duration / 1000).toFixed(1) + 's' : '—'}</span>
        <span>·</span>
        <span class=${`status-${status}`}>${status}</span>
      </div>
      ${actions && html`<div class="goal-strip-actions">${actions}</div>`}
    </div>
  `;
}

import { html } from 'htm/preact';

export function IterationTimeline({ iterations, currentIteration, pinnedIteration, onPin, running }) {
  return html`
    <div class="timeline">
      <div class="section-header">
        <span><i class="fa-solid fa-code-commit"></i> Iterations</span>
        ${running && html`<span class="section-meta">iter ${currentIteration}</span>`}
      </div>
      <div class="timeline-list">
        ${iterations.map(it => html`
          <div
            key=${it.number}
            class=${`timeline-card ${pinnedIteration === it.number ? 'timeline-pinned' : ''} ${it.success ? 'ok' : 'fail'}`}
            onClick=${() => onPin?.(it.number === pinnedIteration ? null : it.number)}
          >
            <div class="timeline-head-row">
              <span class="timeline-num">Iter ${it.number}</span>
              <span class=${`timeline-status ${it.success ? 'ok' : 'fail'}`}>
                <i class=${`fa-solid ${it.success ? 'fa-circle-check' : (it.runResult ? 'fa-circle-xmark' : 'fa-circle')}`}></i>
              </span>
              <span class="timeline-duration">${it.duration}ms</span>
            </div>
            ${it.filesChanged.length > 0 && html`
              <div class="timeline-files">${it.filesChanged.join(', ')}</div>
            `}
            ${it.errorInfo && html`
              <div class="timeline-error" style=${`color:${it.errorInfo.color}`}>
                ${it.errorInfo.label}${it.errorInfo.location ? ` · ${it.errorInfo.location.file}:${it.errorInfo.location.line}` : ''}
              </div>
            `}
            ${it.toolCalls.length > 0 && html`
              <details class="timeline-tools">
                <summary>${it.toolCalls.length} tool call${it.toolCalls.length > 1 ? 's' : ''}</summary>
                ${it.toolCalls.map((tc, i) => html`
                  <div key=${i} class="timeline-tool"><code>${tc.name}</code>${tc.args.filename ? ' ' + tc.args.filename : ''}</div>
                `)}
              </details>
            `}
          </div>
        `)}
        ${running && iterations.length < currentIteration && html`
          <div class="timeline-card running">
            <span><i class="fa-solid fa-spinner fa-spin"></i> Iter ${currentIteration} running…</span>
          </div>
        `}
        ${iterations.length === 0 && !running && html`
          <div class="timeline-empty">
            <i class="fa-solid fa-code-commit"></i>
            <p>No iterations yet</p>
          </div>
        `}
      </div>
    </div>
  `;
}

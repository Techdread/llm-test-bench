import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function OutputInspector({ runResult, errorInfo, language }) {
  const [tab, setTab] = useState('stderr');

  if (!runResult) {
    return html`<div class="output-inspector"><div class="output-empty">No run result yet</div></div>`;
  }

  return html`
    <div class="output-inspector">
      <div class="output-header">
        <span class=${`output-exit ${runResult.exitCode === 0 ? 'ok' : 'fail'}`}>
          exit ${runResult.exitCode}
        </span>
        ${errorInfo && html`
          <span class="output-kind" style=${`background:${errorInfo.color}22;color:${errorInfo.color}`}>
            ${errorInfo.label}
          </span>
        `}
        <span class="output-duration">${runResult.duration}ms${runResult.timedOut ? ' (timeout)' : ''}</span>
      </div>
      <div class="output-tabs">
        <button class=${tab==='stderr'?'active':''} onClick=${() => setTab('stderr')}>stderr</button>
        <button class=${tab==='stdout'?'active':''} onClick=${() => setTab('stdout')}>stdout</button>
      </div>
      <pre class="output-body">${tab === 'stderr' ? (runResult.stderr || '(empty)') : (runResult.stdout || '(empty)')}</pre>
    </div>
  `;
}

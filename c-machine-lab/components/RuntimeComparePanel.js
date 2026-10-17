import { html } from 'htm/preact';

export function RuntimeComparePanel({ machine, compareRun, isComparing }) {
  const vmStdout = machine?.stdout || '';
  const nativeStdout = compareRun?.stdout || '';
  const same = compareRun && vmStdout === nativeStdout;
  return html`
    <section class="panel compare-panel">
      <div class="panel-header">
        <span><i class="fa-solid fa-code-compare"></i> Runtime Compare</span>
        ${compareRun && html`<span class=${same ? 'compare-same' : 'compare-diff'}>${same ? 'same stdout' : 'different stdout'}</span>`}
      </div>
      ${isComparing ? html`
        <div class="empty-panel"><i class="fa-solid fa-spinner fa-spin"></i> Running comparison runtime...</div>
      ` : compareRun ? html`
        <div class="compare-grid">
          <div><div class="subhead">VM stdout</div><pre>${vmStdout}</pre></div>
          <div><div class="subhead">C runtime stdout</div><pre>${nativeStdout}</pre></div>
        </div>
        ${compareRun.stderr && html`<pre class="stderr has-content">${compareRun.stderr}</pre>`}
      ` : html`<div class="empty-panel">Compare runs compatible examples with the optional browser C runtime.</div>`}
    </section>
  `;
}

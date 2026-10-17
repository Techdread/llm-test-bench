import { html } from 'htm/preact';

export function OutputPanel({ machine }) {
  return html`
    <section class="panel micro-panel output-panel">
      <div class="panel-header"><span><i class="fa-solid fa-terminal"></i> Output</span></div>
      <div class="output-block">
        <div class="subhead">stdout</div>
        <pre>${machine?.stdout || ''}</pre>
      </div>
      <div class="output-block">
        <div class="subhead">stderr / warnings</div>
        <pre class=${machine?.stderr ? 'stderr has-content' : 'stderr'}>${machine?.stderr || ''}</pre>
      </div>
    </section>
  `;
}

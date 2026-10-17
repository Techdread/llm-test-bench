import { html } from 'htm/preact';

export function AiExplainPanel({ explanation, isExplaining }) {
  return html`
    <section class="panel ai-panel">
      <div class="panel-header"><span><i class="fa-solid fa-lightbulb"></i> AI Explanation</span></div>
      <div class="ai-output">
        ${isExplaining && html`<div class="loading-line"><i class="fa-solid fa-spinner fa-spin"></i> Explaining from trace facts...</div>`}
        <pre>${explanation || 'Use Explain to ask for a trace-grounded explanation of the current source line, instruction, stack frame, heap event, file event, or interrupt.'}</pre>
      </div>
    </section>
  `;
}

import { html } from 'htm/preact';
import { INTERRUPT_VECTORS } from '../services/vm/instructionSet.js';

export function InterruptsPanel({ lastEvent }) {
  const interrupt = lastEvent?.interruptEvent;
  return html`
    <section class="panel micro-panel interrupts-panel">
      <div class="panel-header"><span><i class="fa-solid fa-bell"></i> Interrupts</span></div>
      ${interrupt ? html`
        <div class=${`interrupt-current ${interrupt.ok === false ? 'trap' : ''}`}>
          <strong>${hex(interrupt.vector)} · ${interrupt.name}</strong>
          <span>${interrupt.runtimeHandlerExplanation}</span>
          <code>${JSON.stringify(interrupt.arguments)}</code>
        </div>
      ` : html`<div class="empty-panel">Step an INT instruction to see trap details.</div>`}
      <div class="vector-table">
        ${INTERRUPT_VECTORS.slice(0, 12).map(item => html`
          <div class=${interrupt?.vector === item.vector ? 'vector-row active' : 'vector-row'} key=${item.vector}>
            <code>${hex(item.vector)}</code>
            <span>${item.name}</span>
          </div>
        `)}
      </div>
    </section>
  `;
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(2, '0')}`;
}

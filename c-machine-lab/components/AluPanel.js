import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function AluPanel({ alu, lastEvent }) {
  const [mode, setMode] = useState('signed');
  const flagDiffs = new Set((lastEvent?.flagDiffs || []).map(diff => diff.flag));
  return html`
    <section class="panel micro-panel">
      <div class="panel-header">
        <span><i class="fa-solid fa-calculator"></i> ALU</span>
        <button class="mini-toggle" onClick=${() => setMode(mode === 'signed' ? 'unsigned' : 'signed')}>${mode}</button>
      </div>
      ${alu ? html`
        <div class="alu-card">
          <div class="alu-op">${alu.op}</div>
          <div class="alu-values">
            <span>A ${format(alu.a, mode)}</span>
            <span>B ${format(alu.b, mode)}</span>
            <strong>= ${format(alu.result, mode)}</strong>
          </div>
          <div class="flags-row">
            ${['Z', 'N', 'C', 'V'].map(flag => html`
              <span class=${`${alu.flags?.[flag] ? 'flag on' : 'flag'} ${flagDiffs.has(flag) ? 'changed' : ''}`} key=${flag}>${flag}</span>
            `)}
          </div>
        </div>
      ` : html`<div class="empty-panel">Step arithmetic or comparison to populate ALU state.</div>`}
    </section>
  `;
}

function format(value, mode) {
  const n = value | 0;
  const decimal = mode === 'unsigned' ? (n >>> 0) : n;
  return `${decimal} / 0x${(n >>> 0).toString(16).padStart(8, '0')}`;
}

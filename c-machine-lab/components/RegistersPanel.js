import { html } from 'htm/preact';

const ORDER = ['PC', 'SP', 'FP', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];

export function RegistersPanel({ machine, lastEvent, onInspectAddress }) {
  const changed = new Set((lastEvent?.registerDiffs || []).map(diff => diff.register));
  const registers = machine?.registers || {};
  const current = machine?.currentInstruction;
  return html`
    <section class="panel micro-panel">
      <div class="panel-header"><span><i class="fa-solid fa-table-cells"></i> Registers</span></div>
      <div class="register-grid">
        ${ORDER.map(name => {
          const value = name === 'PC' && current ? current.address : registers[name];
          return html`
            <button
              class=${`register-cell ${changed.has(name) ? 'changed' : ''}`}
              key=${name}
              onClick=${() => onInspectAddress(value)}
              title="Inspect as address"
            >
              <span>${name}</span>
              <strong>${formatValue(value)}</strong>
            </button>
          `;
        })}
      </div>
      <div class="flags-row">
        ${['Z', 'N', 'C', 'V'].map(flag => html`
          <span class=${machine?.flags?.[flag] ? 'flag on' : 'flag'} key=${flag}>${flag}</span>
        `)}
      </div>
      <div class="ir-line" title=${current?.explanationHint || ''}>IR: ${current?.text || 'HALT'}</div>
    </section>
  `;
}

function formatValue(value) {
  const n = Number(value) || 0;
  return `${n} / 0x${(n >>> 0).toString(16).padStart(4, '0')}`;
}

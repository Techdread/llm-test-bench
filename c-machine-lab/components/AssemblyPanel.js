import { html } from 'htm/preact';

export function AssemblyPanel({ assembly, currentInstruction, onSelectInstruction }) {
  return html`
    <section class="panel assembly-panel">
      <div class="panel-header">
        <span><i class="fa-solid fa-list-ol"></i> Teaching Assembly</span>
        <span>${assembly.length} instr</span>
      </div>
      <div class="assembly-list">
        ${assembly.map((instruction, index) => html`
          <button
            key=${instruction.id}
            class=${`assembly-row ${currentInstruction?.id === instruction.id ? 'active' : ''} ${instruction.op === 'LABEL' ? 'label-row' : ''}`}
            onClick=${() => onSelectInstruction(instruction)}
            title=${instruction.explanationHint}
          >
            <span class="asm-address">${hex(instruction.address)}</span>
            <span class="asm-text">${instruction.text}</span>
            <span class="asm-line">L${instruction.sourceLine || 1}</span>
          </button>
        `)}
      </div>
    </section>
  `;
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(4, '0')}`;
}

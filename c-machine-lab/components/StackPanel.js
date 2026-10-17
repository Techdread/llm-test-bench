import { html } from 'htm/preact';

export function StackPanel({ machine, onInspectAddress }) {
  const frames = machine?.callStack || [];
  return html`
    <section class="panel micro-panel stack-panel">
      <div class="panel-header"><span><i class="fa-solid fa-layer-group"></i> Stack Frames</span><span>${frames.length}</span></div>
      <div class="stack-list">
        ${frames.slice().reverse().map(frame => html`
          <div class="frame-card" key=${frame.id}>
            <div class="frame-title">
              <strong>${frame.functionName}</strong>
              <span>FP ${hex(frame.fp)} SP ${hex(frame.sp)}</span>
            </div>
            <div class="frame-meta">return ${frame.returnAddress < 0 ? 'HALT' : frame.returnAddress} · saved FP ${hex(frame.savedFP)}</div>
            ${frame.variables.map(variable => html`
              <button class="variable-row" key=${`${frame.id}:${variable.name}`} onClick=${() => onInspectAddress(variable.address)}>
                <span>${variable.kind} ${variable.name}</span>
                <code>${hex(variable.address)}</code>
                <strong>${String(variable.value)}</strong>
              </button>
            `)}
          </div>
        `)}
      </div>
    </section>
  `;
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(4, '0')}`;
}

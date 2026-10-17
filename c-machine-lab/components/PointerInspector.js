import { html } from 'htm/preact';

export function PointerInspector({ machine, onInspectAddress }) {
  const pointers = [];
  for (const frame of machine?.callStack || []) {
    for (const variable of frame.variables || []) {
      if ((variable.type?.pointerDepth || 0) > 0 || variable.type?.base === 'FILE') {
        pointers.push({ frame, variable });
      }
    }
  }

  return html`
    <section class="panel micro-panel pointer-panel">
      <div class="panel-header"><span><i class="fa-solid fa-location-dot"></i> Pointer Inspector</span><span>${pointers.length}</span></div>
      <div class="pointer-list">
        ${pointers.length ? pointers.map(({ frame, variable }) => html`
          <button class=${`pointer-row ${variable.pointerInfo?.valid ? 'valid' : 'invalid'}`} key=${`${frame.id}:${variable.name}`} onClick=${() => onInspectAddress(variable.value)}>
            <span>${variable.name}</span>
            <code>${formatAddress(variable.value)}</code>
            <small>${variable.pointerInfo?.status || 'not decoded'}</small>
          </button>
        `) : html`<div class="empty-panel">Pointer variables appear after declarations like int *p.</div>`}
      </div>
    </section>
  `;
}

function formatAddress(value) {
  const n = Number(value) || 0;
  return `0x${(n >>> 0).toString(16).padStart(4, '0')}`;
}

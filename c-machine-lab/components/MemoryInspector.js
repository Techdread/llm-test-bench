import { html } from 'htm/preact';

export function MemoryInspector({ inspection }) {
  return html`
    <section class="panel micro-panel inspector-panel">
      <div class="panel-header"><span><i class="fa-solid fa-magnifying-glass-location"></i> Memory Inspector</span></div>
      ${inspection ? html`
        <div class="inspector-card">
          <div class="kv"><span>address</span><strong>${inspection.hex}</strong></div>
          <div class="kv"><span>segment</span><strong>${inspection.segment}</strong></div>
          <div class="kv"><span>int32</span><strong>${inspection.intValue ?? 'n/a'}</strong></div>
          <div class="kv"><span>cstring</span><strong>${inspection.charString || '""'}</strong></div>
          <div class=${`pointer-status ${inspection.pointer?.valid ? 'valid' : 'invalid'}`}>${inspection.pointer?.status}</div>
          <div class="byte-preview">
            ${inspection.bytes.slice(0, 16).map(byte => html`<code key=${byte.address}>${byte.value.toString(16).padStart(2, '0')}</code>`)}
          </div>
        </div>
      ` : html`<div class="empty-panel">Click a register, variable, heap block, or byte.</div>`}
    </section>
  `;
}

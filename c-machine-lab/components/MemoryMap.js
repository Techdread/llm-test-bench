import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

const MODES = ['bytes', 'words', 'chars', 'pointers'];

export function MemoryMap({ machine, config, selectedAddress, onInspectAddress, lastEvent }) {
  const [mode, setMode] = useState('bytes');
  const reads = new Set((lastEvent?.memoryReads || []).map(item => item.address));
  const writes = new Set((lastEvent?.memoryWrites || []).map(item => item.address));
  const focus = Number.isFinite(selectedAddress) ? selectedAddress : config.segments.stack.start;
  const start = Math.max(0, Math.min(config.memorySize - 64, focus - 24));
  const bytes = machine?.memory?.dump(start, 64) || [];

  return html`
    <section class="panel memory-panel">
      <div class="panel-header">
        <span><i class="fa-solid fa-border-all"></i> Memory Map</span>
        <div class="segmented">
          ${MODES.map(item => html`
            <button key=${item} class=${mode === item ? 'active' : ''} onClick=${() => setMode(item)}>${item}</button>
          `)}
        </div>
      </div>
      <div class="segment-map">
        ${Object.entries(config.segments).map(([name, segment]) => {
          const width = ((segment.end - segment.start + 1) / config.memorySize) * 100;
          return html`
            <button
              key=${name}
              class=${`segment segment-${name}`}
              style=${{ width: `${width}%` }}
              onClick=${() => onInspectAddress(segment.start)}
              title=${`${hex(segment.start)} - ${hex(segment.end)}`}
            >
              ${name}
            </button>
          `;
        })}
      </div>
      <div class="memory-grid">
        ${bytes.map(cell => html`
          <button
            key=${cell.address}
            class=${`memory-byte ${reads.has(cell.address) ? 'read' : ''} ${writes.has(cell.address) ? 'write' : ''} ${cell.address === selectedAddress ? 'selected' : ''}`}
            onClick=${() => onInspectAddress(cell.address)}
            title=${`${hex(cell.address)} ${cell.segment}`}
          >
            <span>${hex(cell.address, 4)}</span>
            <strong>${formatCell(cell, mode)}</strong>
          </button>
        `)}
      </div>
    </section>
  `;
}

function formatCell(cell, mode) {
  if (mode === 'chars') return cell.char;
  if (mode === 'pointers') return cell.value ? '·' : '0';
  return cell.value.toString(16).padStart(2, '0');
}

function hex(value, width = 4) {
  return `0x${(value >>> 0).toString(16).padStart(width, '0')}`;
}

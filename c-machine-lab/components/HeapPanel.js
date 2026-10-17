import { html } from 'htm/preact';

export function HeapPanel({ machine, lastEvent, onInspectAddress }) {
  const blocks = machine?.heap?.blocks || [];
  const heapEvents = lastEvent?.heapEvents || [];
  return html`
    <section class="panel heap-panel">
      <div class="panel-header"><span><i class="fa-solid fa-boxes-stacked"></i> Heap</span><span>${blocks.length} blocks</span></div>
      <div class="heap-blocks">
        ${blocks.length ? blocks.map(block => html`
          <button class=${`heap-block ${block.free ? 'free' : 'live'}`} key=${block.id} onClick=${() => onInspectAddress(block.payload)}>
            <span>#${block.id} ${block.free ? 'free' : 'live'}</span>
            <strong>${hex(block.payload)}</strong>
            <small>${block.requestedSize} bytes</small>
          </button>
        `) : html`<div class="empty-panel">No heap allocations yet. Step through malloc.</div>`}
      </div>
      ${heapEvents.length > 0 && html`
        <div class="event-strip">
          ${heapEvents.map((event, index) => html`<span key=${index}>${event.type} ${event.address ? hex(event.address) : ''}</span>`)}
        </div>
      `}
    </section>
  `;
}

function hex(value) {
  return `0x${(value >>> 0).toString(16).padStart(4, '0')}`;
}

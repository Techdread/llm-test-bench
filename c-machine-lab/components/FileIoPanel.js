import { html } from 'htm/preact';

export function FileIoPanel({ machine, virtualFiles, onVirtualFilesChange, lastEvent }) {
  const handles = machine?.files?.handles || [];
  const files = virtualFiles || [];

  const updateFile = (name, content) => {
    onVirtualFilesChange((virtualFiles || []).map(file => file.name === name ? { ...file, content } : file));
  };

  return html`
    <section class="panel file-panel">
      <div class="panel-header"><span><i class="fa-solid fa-folder-open"></i> File I/O + Interrupts</span></div>
      <div class="file-grid">
        <div class="virtual-files">
          <div class="subhead">Virtual files</div>
          ${files.map(file => html`
            <label class="virtual-file" key=${file.name}>
              <span>${file.name}</span>
              <textarea
                value=${file.content}
                onInput=${e => updateFile(file.name, e.target.value)}
                spellcheck="false"
              ></textarea>
            </label>
          `)}
          ${!files.length && html`<div class="empty-panel">This lesson has no virtual files.</div>`}
        </div>
        <div class="file-handles">
          <div class="subhead">Handles</div>
          ${handles.length ? handles.map(handle => html`
            <div class=${`handle-row ${handle.open ? 'open' : 'closed'}`} key=${handle.id}>
              <strong>${handle.id}</strong>
              <span>${handle.filename}</span>
              <code>${handle.mode}</code>
              <span>off ${handle.offset}</span>
              <small>${handle.eof ? 'EOF' : handle.open ? 'open' : 'closed'}</small>
            </div>
          `) : html`<div class="empty-panel">fopen creates visible handles here.</div>`}
          ${(lastEvent?.fileEvents || []).map((event, index) => html`
            <div class="file-event" key=${index}>${event.type} ${event.filename || ''} ${event.char || event.text || ''}</div>
          `)}
        </div>
      </div>
    </section>
  `;
}

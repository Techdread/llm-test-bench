import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function PromoteToStudioButton({ run, disabled = false, onPromote }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const failed = run?.meta?.status === 'failed';

  const begin = () => {
    setTitle(`${run?.meta?.gameTitle || run?.gameSlug || 'Game'} — refinement`);
    setError('');
    setOpen(true);
  };
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await onPromote({ run, title: title.trim() });
      setOpen(false);
    } catch (cause) { setError(cause.message || String(cause)); }
    finally { setBusy(false); }
  };

  return html`
    <button class="gf-btn" disabled=${disabled} onClick=${begin} title="Preserve this exact run as an immutable Studio baseline">
      <i class="fas fa-arrow-up-right-from-square"></i> Promote to Studio
    </button>
    ${open && html`
      <div class="modal-overlay">
        <form class="modal gf-promote-dialog" onSubmit=${submit} onClick=${event => event.stopPropagation()}>
          <div class="modal-header">
            <h2>Promote immutable baseline</h2>
            <button type="button" class="btn-icon" disabled=${busy} onClick=${() => setOpen(false)}><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p>This copies the selected run and its evidence into a new refinement project. The run is never changed or re-run.</p>
            ${failed && html`<div class="gf-warn"><i class="fas fa-triangle-exclamation"></i> This run failed validation. Its failed status will be preserved, but it can still be promoted for a later repair.</div>`}
            <label class="gf-promote-field">Project title
              <input required value=${title} onInput=${event => setTitle(event.target.value)} autofocus />
            </label>
            ${error && html`<div class="gf-warn">${error}</div>`}
          </div>
          <div class="modal-footer">
            <button type="button" class="gf-btn" disabled=${busy} onClick=${() => setOpen(false)}>Cancel</button>
            <button class="gf-btn gf-primary" disabled=${busy || !title.trim()}>
              <i class=${`fas ${busy ? 'fa-spinner fa-spin' : 'fa-arrow-up-right-from-square'}`}></i> ${busy ? 'Promoting…' : 'Promote and open intake'}
            </button>
          </div>
        </form>
      </div>`}
  `;
}

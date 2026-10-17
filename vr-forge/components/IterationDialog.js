import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

const COPY = {
  fork: {
    title: 'Fork saved run',
    hint: 'Creates a new append-only run containing an exact project copy. No model changes are made.',
    placeholder: 'Optional note describing why you are forking this version…',
  },
  improve: {
    title: 'Improve saved run',
    hint: 'Copies the project into a new run, then asks the selected backend to make a focused improvement.',
    placeholder: 'Make movement feel tighter, improve enemy variety, add audio feedback…',
  },
  repair: {
    title: 'Fix preview failures',
    hint: 'Copies the project and attaches its captured validation and runtime errors to the repair task.',
    placeholder: 'Optional additional repair guidance…',
  },
  continue: {
    title: 'Continue unfinished run',
    hint: 'Copies the current files and recent trace context so the backend can continue from durable state.',
    placeholder: 'What should the continuation finish first?',
  },
  merge: {
    title: 'Compare and merge ideas',
    hint: 'Uses the first selected run as the working copy and both selected runs as design references.',
    placeholder: 'Take the controls from the first version and the visuals/enemy design from the second…',
  },
  agent: {
    title: 'Open in external coding agent',
    hint: 'Creates a safe project copy and opens an improvement task using the selected external agent backend.',
    placeholder: 'What should the coding agent review or change?',
  },
};

export function IterationDialog({ kind, sources, validation, onSubmit, onClose }) {
  const copy = COPY[kind] || COPY.improve;
  const [instruction, setInstruction] = useState('');
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal" onClick=${event => event.stopPropagation()}>
        <h2>${copy.title}</h2>
        <p class="gf-muted">${copy.hint}</p>
        <div class="gf-lineage-list">
          ${(sources || []).map(source => html`
            <span><i class="fas fa-code-branch"></i> ${source.runId} · ${source.meta?.status || 'legacy'}</span>`)}
        </div>
        ${kind === 'repair' && html`
          <div class="gf-repair-issues">
            ${(validation?.issues || []).map(issue => html`<div><b>${issue.code}</b> — ${issue.message}</div>`)}
            ${!(validation?.issues || []).length && html`<div>No saved validation issues were found; the agent will inspect the preview and project wiring.</div>`}
          </div>`}
        <label>Requested change
          <textarea rows="5" autofocus value=${instruction} placeholder=${copy.placeholder}
            onInput=${event => setInstruction(event.target.value)}></textarea>
        </label>
        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${onClose}>Cancel</button>
          <button class="gf-btn gf-primary"
            disabled=${kind !== 'fork' && !instruction.trim() && kind !== 'repair' && kind !== 'continue'}
            onClick=${() => onSubmit(instruction.trim())}>
            <i class="fas fa-code-branch"></i> Prepare ${kind === 'fork' ? 'fork' : 'new attempt'}
          </button>
        </div>
      </div>
    </div>`;
}

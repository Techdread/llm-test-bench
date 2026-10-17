import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { suggestImprovements } from '../services/improvements.js';

const COPY = {
  fork: {
    title: 'Fork saved run',
    hint: 'Creates a new append-only run containing an exact project copy. No model changes are made.',
    placeholder: 'Optional note describing why you are forking this version…',
  },
  improve: {
    title: 'Improve saved run',
    hint: 'Forks the current code into a new run, then improves the copy. Your changes become additions to the original spec and carry forward into future revisions. The original run is preserved.',
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

export function IterationDialog({ kind, sources, validation, onSubmit, onClose, suggestionOptions, submitLabel }) {
  const copy = COPY[kind] || COPY.improve;
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const controller = useRef(null);
  const close = () => { controller.current?.abort(); onClose(); };
  const suggest = async () => {
    if (controller.current) return;
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true); setPartial(''); setError('');
    try {
      const result = await suggestImprovements({
        ...suggestionOptions, source: sources[0], instruction, validation,
        signal: ac.signal, onChunk: text => { if (!ac.signal.aborted) setPartial(text); },
      });
      if (!ac.signal.aborted) {
        setInstruction(value => [value.trim(), result].filter(Boolean).join('\n\n'));
        setPartial('');
      }
    } catch (err) {
      if (!ac.signal.aborted) setError(err.message);
    } finally {
      if (controller.current === ac) { controller.current = null; setBusy(false); }
    }
  };
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    return () => { controller.current?.abort(); removeEventListener('keydown', onKey); };
  }, []);
  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-iteration-dialog" role="dialog" aria-modal="true" aria-labelledby="iteration-title" onClick=${event => event.stopPropagation()}>
        <h2 id="iteration-title">${copy.title}</h2>
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
        ${kind === 'improve' && suggestionOptions && html`
          <p class="gf-muted">Suggestions use the model or CLI agent selected in the toolbar. Edit or remove any suggestion before applying.</p>
          <button class="gf-btn" disabled=${busy} onClick=${suggest}>
            <i class=${`fas ${busy ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i> Suggest improvements
          </button>
          ${busy && html`<button class="gf-btn" onClick=${() => controller.current?.abort()}>Stop suggestions</button>`}
          ${partial && html`<pre class="gf-improvement-stream" aria-live="polite">${partial}</pre>`}
          ${error && html`<p class="gf-warn" role="alert">${error}</p>`}`}
        <label>${kind === 'improve' ? 'Spec additions (edit before applying)' : 'Requested change'}
          <textarea rows="8" autofocus value=${instruction} placeholder=${copy.placeholder} disabled=${busy}
            onInput=${event => setInstruction(event.target.value)}></textarea>
        </label>
        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${close}>Cancel</button>
          <button class="gf-btn gf-primary"
            disabled=${busy || (kind !== 'fork' && !instruction.trim() && kind !== 'repair' && kind !== 'continue')}
            onClick=${() => {
              if (kind === 'improve' && suggestionOptions?.backend === 'model' && !suggestionOptions.modelId) {
                setError('Select a model in the toolbar before applying improvements.');
                return;
              }
              onSubmit(instruction.trim());
            }}>
            <i class="fas fa-code-branch"></i> ${submitLabel || `Prepare ${kind === 'fork' ? 'fork' : 'new attempt'}`}
          </button>
        </div>
      </div>
    </div>`;
}

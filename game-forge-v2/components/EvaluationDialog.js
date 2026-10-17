import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  EVALUATION_CRITERIA, evaluationAverage, normalizeEvaluation,
} from '../services/projectWorkbench.js';

export function EvaluationDialog({ value, title, criteria = EVALUATION_CRITERIA, onSave, onClose }) {
  const [draft, setDraft] = useState(() => normalizeEvaluation(value, criteria));
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const average = evaluationAverage(draft);
  const score = (id, next) => setDraft(current => ({
    ...current, scores: { ...current.scores, [id]: next },
  }));

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-evaluation" onClick=${event => event.stopPropagation()}>
        <h2><i class="fas fa-clipboard-check"></i> Evaluate ${title}</h2>
        <div class="gf-muted">Score any criteria that matter. Zero means “not rated”.${average == null ? '' : ` Current rubric average: ${average.toFixed(1)}/5.`}</div>
        <div class="gf-rubric-grid">
          ${criteria.map(criterion => html`
            <div class="gf-rubric-row">
              <span>${criterion.label}</span>
              <div class="gf-stars">
                ${[1, 2, 3, 4, 5].map(value => html`
                  <i class=${`fa-star ${value <= draft.scores[criterion.id] ? 'fas on' : 'far'}`}
                    onClick=${() => score(criterion.id, draft.scores[criterion.id] === value ? 0 : value)}></i>`)}
              </div>
            </div>`)}
        </div>
        <label>Review notes
          <textarea rows="5" value=${draft.notes}
            placeholder="Missing mechanics, strengths, bugs, comparison notes…"
            onInput=${event => setDraft(current => ({ ...current, notes: event.target.value }))}></textarea>
        </label>
        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${onClose}>Cancel</button>
          <button class="gf-btn gf-primary" onClick=${() => onSave(normalizeEvaluation({
            ...draft, updatedAt: new Date().toISOString(),
          }, criteria))}><i class="fas fa-check"></i> Save evaluation</button>
        </div>
      </div>
    </div>`;
}

import { html } from 'htm/preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { CATEGORIES } from '../services/library.js';

export function PromptFormDialog({ initial, onSave, onClose, addToast }) {
  const isEdit = !!initial?.id;
  const [title, setTitle] = useState(initial?.title || '');
  const [category, setCategory] = useState(initial?.category || 'html-js');
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [promptText, setPromptText] = useState(initial?.prompt || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const titleRef = useRef(null);
  const revisionCount = initial?.revisions?.length || 0;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      addToast('Please enter a title', 'error');
      return;
    }
    if (!promptText.trim()) {
      addToast('Please enter the prompt text', 'error');
      return;
    }
    onSave({
      title: title.trim(),
      category,
      tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      prompt: promptText.trim(),
      notes: notes.trim(),
    });
  }, [title, category, tags, promptText, notes, onSave, addToast]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return html`
    <div class="modal-overlay" onKeyDown=${handleKeyDown}>
      <div class="modal prompt-form-dialog" onClick=${(e) => e.stopPropagation()} style=${{ width: '640px' }}>
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Prompt' : 'Add Prompt to Library'}</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Title</label>
            <input
              ref=${titleRef}
              class="form-input"
              value=${title}
              onInput=${(e) => setTitle(e.target.value)}
              placeholder="e.g. Raymarched Clouds"
            />
            <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Runs of this prompt are saved under the folder name derived from the title
            </span>
          </div>

          <div class="form-group">
            <label>Category</label>
            <select class="form-input" value=${category} onChange=${(e) => setCategory(e.target.value)}>
              ${CATEGORIES.map(c => html`<option key=${c.id} value=${c.id}>${c.label}</option>`)}
            </select>
          </div>

          <div class="form-group">
            <label>Tags (comma separated)</label>
            <input
              class="form-input"
              value=${tags}
              onInput=${(e) => setTags(e.target.value)}
              placeholder="e.g. game, particles, no-libraries"
            />
          </div>

          <div class="form-group">
            <label>Prompt</label>
            <textarea
              class="form-input prompt-form-textarea"
              value=${promptText}
              onInput=${(e) => setPromptText(e.target.value)}
              placeholder="The full prompt to send to a model..."
            ></textarea>
            ${isEdit && html`
              <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ${revisionCount > 0
                  ? `${revisionCount} earlier revision${revisionCount === 1 ? '' : 's'} kept — `
                  : ''
                }changing the text keeps the previous version as a revision
              </span>
            `}
          </div>

          <div class="form-group">
            <label>Notes (what to watch for when grading)</label>
            <textarea
              class="form-input prompt-form-notes"
              value=${notes}
              onInput=${(e) => setNotes(e.target.value)}
              placeholder="e.g. Watch for: physics tied to frame rate; no game-over state..."
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${handleSave}>
            <i class="fa-solid fa-floppy-disk"></i> ${isEdit ? 'Save Changes' : 'Add to Library'}
          </button>
        </div>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { useState, useCallback, useMemo } from 'preact/hooks';
import { suggestField, suggestAll } from '../services/ai/metadataSuggester.js';

const SOURCE_LABELS = {
  ai: 'AI generated',
  manual: 'Hand written',
  example: 'Built-in example',
};

const SOURCE_ICONS = {
  ai: 'fa-robot',
  manual: 'fa-pen',
  example: 'fa-book-open',
};

const FIELD_LABELS = { title: 'Title', notes: 'Description', tags: 'Tags' };
const labelFor = (field) => FIELD_LABELS[field] || field;

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function SaveDialog({
  onSave,
  onClose,
  initialTitle = '',
  initialTags = [],
  initialNotes = '',
  generationMeta = null,
  prompt = '',
  code = '',
  params = {},
  providerId = '',
  modelId = '',
  addToast = () => {},
}) {
  const meta = generationMeta || { source: 'manual', model: 'manual', modelDisplayLabel: 'manual' };
  const detectedModel = meta.modelDisplayLabel || meta.model || meta.modelName || meta.modelId || 'manual';

  const [title, setTitle] = useState(initialTitle);
  const [tagsText, setTagsText] = useState(initialTags.join(', '));
  const [notes, setNotes] = useState(initialNotes);
  const [modelName, setModelName] = useState(detectedModel);
  const [editingModel, setEditingModel] = useState(false);
  const [busy, setBusy] = useState('');  // '' | 'title' | 'notes' | 'tags' | 'all'

  const source = meta.source || 'manual';
  const canSuggest = !!(providerId && modelId) && !!(prompt.trim() || code.trim());

  const suggestArgs = useMemo(
    () => ({ providerId, modelId, prompt, code, params }),
    [providerId, modelId, prompt, code, params],
  );

  const setters = { title: setTitle, notes: setNotes, tags: setTagsText };

  const runSuggest = useCallback(async (field) => {
    if (!canSuggest) {
      addToast(providerId && modelId
        ? 'Need a prompt or sketch source to suggest from'
        : 'Select a model first to enable AI suggestions', 'error');
      return;
    }
    setBusy(field);
    try {
      const value = await suggestField({ field, ...suggestArgs });
      if (value) setters[field](value);
      else addToast(`${labelFor(field)} suggestion came back empty — try another model`, 'error');
    } catch (e) {
      addToast(`Suggestion failed: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  }, [canSuggest, providerId, modelId, suggestArgs, addToast]);

  const runSuggestAll = useCallback(async () => {
    if (!canSuggest) {
      addToast(providerId && modelId
        ? 'Need a prompt or sketch source to suggest from'
        : 'Select a model first to enable AI suggestions', 'error');
      return;
    }
    // Only fill what is still empty — never clobber what the author typed.
    const empty = [
      !title.trim() && 'title',
      !notes.trim() && 'notes',
      !tagsText.trim() && 'tags',
    ].filter(Boolean);
    if (!empty.length) {
      addToast('Nothing empty to fill — use the wand on a field to redo it', 'info');
      return;
    }
    setBusy('all');
    try {
      const results = await suggestAll({ fields: empty, ...suggestArgs });
      const failed = [];
      for (const r of results) {
        if (r.value) setters[r.field](r.value);
        else failed.push(r.field);
      }
      const filled = results.length - failed.length;
      if (filled) addToast(`Filled ${filled} field${filled === 1 ? '' : 's'} with AI`, 'success');
      if (failed.length) {
        addToast(`Empty response for: ${failed.map(labelFor).join(', ')} — try another model`, 'error');
      }
    } catch (e) {
      addToast(`Suggestion failed: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  }, [canSuggest, providerId, modelId, suggestArgs, title, notes, tagsText, addToast]);

  const handleSave = () => {
    if (!title.trim() || busy) return;
    const tags = tagsText.split(',').map(s => s.trim()).filter(Boolean);
    onSave({
      title: title.trim(),
      tags,
      notes: notes.trim(),
      model: modelName.trim() || detectedModel,
    });
  };

  const wand = (field) => html`
    <button
      type="button"
      class="btn-icon suggest-btn"
      onClick=${() => runSuggest(field)}
      disabled=${!!busy}
      title=${canSuggest ? `Suggest ${labelFor(field).toLowerCase()} with AI` : 'Select a model and write a prompt to enable AI suggestions'}
    >
      <i class=${`fa-solid ${busy === field ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
    </button>
  `;

  return html`
    <div class="modal-overlay" onKeyDown=${(e) => e.key === 'Escape' && onClose()}>
      <div class="modal save-dialog" onClick=${(e) => e.stopPropagation()} style=${{ width: '560px' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-floppy-disk" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>Save new sketch</h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="save-attribution">
            <div class="save-attribution-head">
              <span class=${`save-source-badge source-${source}`}>
                <i class=${`fa-solid ${SOURCE_ICONS[source] || 'fa-pen'}`}></i>
                ${SOURCE_LABELS[source] || source}
              </span>
              ${!editingModel && html`
                <button
                  type="button"
                  class="btn-icon"
                  title="Edit the recorded model"
                  onClick=${() => setEditingModel(true)}
                ><i class="fa-solid fa-pen-to-square"></i></button>
              `}
            </div>
            ${editingModel ? html`
              <input
                class="form-input"
                value=${modelName}
                onInput=${(e) => setModelName(e.target.value)}
                placeholder="e.g. Claude Sonnet, Qwen3 27B"
              />
            ` : html`
              <div class="save-model-line" title=${modelName}>
                <i class="fa-solid fa-microchip"></i>
                <strong>${modelName || 'unknown'}</strong>
                ${meta.providerName && html`<span class="save-model-provider">via ${meta.providerName}</span>`}
              </div>
            `}
            ${meta.generatedAt && html`
              <div class="save-attribution-when">Generated ${formatWhen(meta.generatedAt)}</div>
            `}
          </div>

          <div class="form-group">
            <label>Title</label>
            <div class="input-with-suggest">
              <input
                class="form-input"
                type="text"
                value=${title}
                onInput=${(e) => setTitle(e.target.value)}
                onKeyDown=${(e) => e.key === 'Enter' && handleSave()}
                autoFocus
                placeholder="e.g. flocking-arrows"
              />
              ${wand('title')}
            </div>
          </div>

          <div class="form-group">
            <label>Description</label>
            <div class="input-with-suggest">
              <textarea
                class="form-input save-notes"
                rows="3"
                value=${notes}
                onInput=${(e) => setNotes(e.target.value)}
                placeholder="What does this sketch do? What were you going for?"
              ></textarea>
              ${wand('notes')}
            </div>
            <span class="form-hint">Saved as the sketch notes — shown in the gallery and on reopen.</span>
          </div>

          <div class="form-group">
            <label>Tags</label>
            <div class="input-with-suggest">
              <input
                class="form-input"
                type="text"
                value=${tagsText}
                onInput=${(e) => setTagsText(e.target.value)}
                placeholder="generative, motion, color"
              />
              ${wand('tags')}
            </div>
          </div>
        </div>
        <div class="modal-footer save-dialog-footer">
          <button
            class="btn"
            onClick=${runSuggestAll}
            disabled=${!!busy || !canSuggest}
            title=${canSuggest ? 'Fill every empty field with AI' : 'Select a model and write a prompt to enable AI suggestions'}
          >
            <i class=${`fa-solid ${busy === 'all' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
            ${busy === 'all' ? ' Filling…' : ' Auto-fill empty'}
          </button>
          <div class="save-dialog-footer-actions">
            <button class="btn" onClick=${onClose}>Cancel</button>
            <button class="btn btn-primary" onClick=${handleSave} disabled=${!title.trim() || !!busy}>
              <i class="fa-solid fa-check"></i> Save new
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

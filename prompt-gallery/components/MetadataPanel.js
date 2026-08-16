import { html } from 'htm/preact';
import { useState, useCallback } from 'preact/hooks';
import { RatingWidget } from './RatingWidget.js';
import { sendToCodeMorphLab } from '../../shared/services/code-morph-handoff.js';
import { sendToBugfixBench } from '../../shared/services/bugfix-bench-handoff.js';

export function MetadataPanel({ generation, response, onUpdateMetadata, onSavePromptToLibrary, onRefine, onEdit, onDelete, onCompare, onClose, allowHandoffs = true }) {
  const [tagInput, setTagInput] = useState('');

  if (!generation) return null;

  const { id, folderId, prompt, metadata } = generation;
  const meta = metadata || {};
  const displayName = folderId || id;

  const handleRatingChange = useCallback((rating) => {
    onUpdateMetadata(id, { ...meta, rating });
  }, [id, meta, onUpdateMetadata]);

  const handleAddTag = useCallback((e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      const tag = tagInput.trim().toLowerCase();
      if (!meta.tags?.includes(tag)) {
        onUpdateMetadata(id, { ...meta, tags: [...(meta.tags || []), tag] });
      }
      setTagInput('');
    }
  }, [id, meta, tagInput, onUpdateMetadata]);

  const handleRemoveTag = useCallback((tag) => {
    onUpdateMetadata(id, { ...meta, tags: (meta.tags || []).filter(t => t !== tag) });
  }, [id, meta, onUpdateMetadata]);

  const handleNotesChange = useCallback((e) => {
    onUpdateMetadata(id, { ...meta, notes: e.target.value });
  }, [id, meta, onUpdateMetadata]);

  const renderMarkdown = () => {
    if (!window.marked || !prompt) return prompt || '';
    try {
      return window.marked.parse(prompt);
    } catch (e) {
      return prompt;
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return dateStr;
    }
  };

  return html`
    <div class="metadata-panel">
      <div class="metadata-header">
        <h3>${displayName}</h3>
        <button class="btn-icon" onClick=${onClose} title="Close panel">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="metadata-body">
        <!-- Rating -->
        <div class="metadata-field">
          <span class="metadata-label">Rating</span>
          <${RatingWidget} rating=${meta.rating || 0} onChange=${handleRatingChange} size=${18} />
        </div>

        <!-- Model -->
        <div class="metadata-field">
          <span class="metadata-label">Model</span>
          <span class="metadata-value">
            ${meta.model ? html`<span class="model-badge"><i class="fa-solid fa-robot"></i> ${meta.model}</span>` : '—'}
          </span>
        </div>

        <!-- Date -->
        <div class="metadata-field">
          <span class="metadata-label">Created</span>
          <span class="metadata-value">${formatDate(meta.createdAt)}</span>
        </div>

        <!-- Refine lineage -->
        ${meta.derivedFrom && html`
          <div class="metadata-field">
            <span class="metadata-label">Derived from</span>
            <span class="metadata-value" style=${{ fontSize: '12px' }}>
              <i class="fa-solid fa-screwdriver-wrench"></i> ${meta.derivedFrom}
              ${meta.refine?.kind && html` <span class="tag-chip">${meta.refine.kind}</span>`}
            </span>
          </div>
        `}

        <!-- Tags -->
        <div class="metadata-field">
          <span class="metadata-label">Tags</span>
          <div class="metadata-tags-edit">
            ${(meta.tags || []).map(tag => html`
              <span class="tag-chip" key=${tag}>
                ${tag}
                <button class="tag-remove" onClick=${() => handleRemoveTag(tag)} title="Remove tag">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </span>
            `)}
            <input
              class="tag-input"
              placeholder="Add tag..."
              value=${tagInput}
              onInput=${(e) => setTagInput(e.target.value)}
              onKeyDown=${handleAddTag}
            />
          </div>
        </div>

        <!-- Notes -->
        <div class="metadata-field">
          <span class="metadata-label">Notes</span>
          <textarea
            class="metadata-notes-input"
            value=${meta.notes || ''}
            onInput=${handleNotesChange}
            placeholder="Add notes..."
          ></textarea>
        </div>

        <!-- Prompt preview -->
        <div class="metadata-field">
          <span class="metadata-label">Prompt</span>
          <div class="metadata-prompt-preview" dangerouslySetInnerHTML=${{ __html: renderMarkdown() }}></div>
        </div>
      </div>

      <div class="metadata-actions">
        <button class="btn" onClick=${() => onEdit(id)} title="Edit in Create view">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
        <button class="btn" onClick=${() => onCompare(id)} title="Add to compare">
          <i class="fa-solid fa-columns"></i> Compare
        </button>
        ${onRefine && html`
          <button class="btn" onClick=${() => onRefine(id)} title="Open in Refine — heal errors or add features (saves as a new variant)">
            <i class="fa-solid fa-screwdriver-wrench"></i> Refine
          </button>
        `}
        ${onSavePromptToLibrary && prompt && html`
          <button
            class="btn"
            onClick=${() => onSavePromptToLibrary(
              (folderId || id).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              prompt
            )}
            title="Save this generation's prompt to the prompt library"
          >
            <i class="fa-solid fa-bookmark"></i> Keep Prompt
          </button>
        `}
        ${allowHandoffs && html`<button class="btn" onClick=${() => {
          try {
            sendToCodeMorphLab({
              source: 'prompt-gallery',
              kind: 'code',
              title: displayName,
              prompt: prompt,
              files: [{ name: 'index.html', content: response || '' }],
              language: 'html',
              meta: {
                model: meta.model,
                createdAt: meta.createdAt,
                sourceId: folderId || id,
              },
            });
          } catch (e) {
            alert('Send failed: ' + e.message);
          }
        }} title="Morph this generation in Code Morph Lab">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Morph
        </button>`}
        ${allowHandoffs && html`<button class="btn" onClick=${() => {
          try {
            sendToBugfixBench({
              source: 'prompt-gallery',
              title: displayName,
              files: [{ name: 'index.html', content: response || '' }],
              language: 'html',
              entryFile: 'index.html',
              meta: {
                model: meta.model,
                createdAt: meta.createdAt,
                sourceId: folderId || id,
              },
            });
          } catch (e) {
            alert('Send failed: ' + e.message);
          }
        }} title="Seed a Bugfix Bench task from this generation">
          <i class="fa-solid fa-bug"></i> Bug it
        </button>`}
        <button class="btn btn-danger" onClick=${() => onDelete(id)} title="Delete generation">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;
}

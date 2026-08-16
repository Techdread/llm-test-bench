import { html } from 'htm/preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { completeChat } from '../../shared/services/model-providers.js';

const NAME_SYSTEM = `You generate short, kebab-case folder names for saved HTML generations.
Output ONLY the folder name. No quotes, no explanation, no trailing punctuation.
Rules: lowercase, words separated by single hyphens, 2–5 words, no file extension, ASCII only, no leading/trailing hyphens.`;

const TAGS_SYSTEM = `You generate concise tags for a saved HTML generation.
Output ONLY a comma-separated list of 3–6 lowercase tags. No quotes, no explanation, no trailing punctuation.
Tags should describe genre, technique, visual style, or notable systems (e.g. landing-page, threejs, neon, parallax, form-validation).`;

function sanitizeName(text) {
  if (!text) return '';
  // Take first non-empty line, strip wrapping quotes/backticks/spaces, lowercase, kebab-case
  const line = text.split('\n').map(l => l.trim()).find(Boolean) || '';
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sanitizeTags(text) {
  if (!text) return '';
  const line = text.split('\n').map(l => l.trim()).find(Boolean) || '';
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .split(',')
    .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
}

export function SaveDialog({
  onSave,
  onClose,
  initialName,
  model,
  addToast,
  prompt,
  response,
  providerId,
  modelId,
}) {
  const [name, setName] = useState(initialName || '');
  const [modelName, setModelName] = useState(model || '');
  const [tags, setTags] = useState('');
  const [suggestingName, setSuggestingName] = useState(false);
  const [suggestingTags, setSuggestingTags] = useState(false);
  const nameInputRef = useRef(null);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      addToast('Please enter a name for this generation', 'error');
      return;
    }
    const folderName = trimmed.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').toLowerCase();
    const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    onSave(folderName, tagList, modelName.trim() || 'unknown');
  }, [name, tags, modelName, onSave, addToast]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !e.shiftKey) handleSave();
  }, [onClose, handleSave]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const buildContext = useCallback(() => {
    const promptStr = (prompt || '').slice(0, 1500);
    const responseStr = (response || '').slice(0, 1500);
    if (!promptStr && !responseStr) return '';
    return [
      promptStr ? `PROMPT:\n${promptStr}` : '',
      responseStr ? `HTML (truncated):\n${responseStr}` : '',
    ].filter(Boolean).join('\n\n');
  }, [prompt, response]);

  const checkProvider = useCallback(() => {
    if (!providerId || !modelId) {
      addToast('Select a model first to enable AI suggestions', 'error');
      return false;
    }
    if (!prompt && !response) {
      addToast('Need a prompt or response to suggest from', 'error');
      return false;
    }
    return true;
  }, [providerId, modelId, prompt, response, addToast]);

  const suggestName = useCallback(async () => {
    if (!checkProvider()) return;
    setSuggestingName(true);
    try {
      const out = await completeChat({
        providerId,
        modelId,
        systemPrompt: NAME_SYSTEM,
        userPrompt: buildContext(),
        appTitle: 'Prompt Gallery',
      });
      const cleaned = sanitizeName(out);
      if (cleaned) setName(cleaned);
      else addToast('Could not parse a name suggestion', 'error');
    } catch (e) {
      addToast('Name suggestion failed: ' + e.message, 'error');
    } finally {
      setSuggestingName(false);
    }
  }, [checkProvider, providerId, modelId, buildContext, addToast]);

  const suggestTags = useCallback(async () => {
    if (!checkProvider()) return;
    setSuggestingTags(true);
    try {
      const out = await completeChat({
        providerId,
        modelId,
        systemPrompt: TAGS_SYSTEM,
        userPrompt: buildContext(),
        appTitle: 'Prompt Gallery',
      });
      const cleaned = sanitizeTags(out);
      if (cleaned) setTags(cleaned);
      else addToast('Could not parse tag suggestions', 'error');
    } catch (e) {
      addToast('Tag suggestion failed: ' + e.message, 'error');
    } finally {
      setSuggestingTags(false);
    }
  }, [checkProvider, providerId, modelId, buildContext, addToast]);

  const showNameSuggest = !name.trim();
  const showTagsSuggest = !tags.trim();

  return html`
    <div class="modal-overlay" onKeyDown=${handleKeyDown}>
      <div class="modal save-dialog" onClick=${(e) => e.stopPropagation()} style=${{ width: '560px' }}>
        <div class="modal-header">
          <h2>Save Generation</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Name</label>
            <div class="input-with-suggest">
              <input
                ref=${nameInputRef}
                class="form-input"
                value=${name}
                onInput=${(e) => setName(e.target.value)}
                onKeyDown=${(e) => e.key === 'Enter' && handleSave()}
                placeholder="e.g. landing-page-v1"
              />
              ${showNameSuggest && html`
                <button
                  type="button"
                  class="btn-icon suggest-btn"
                  onClick=${suggestName}
                  disabled=${suggestingName}
                  title="Suggest a name with AI"
                >
                  <i class=${`fa-solid ${suggestingName ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                </button>
              `}
            </div>
            <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
              This will be used as the folder name
            </span>
          </div>

          <div class="form-group">
            <label>Model</label>
            <input
              class="form-input"
              value=${modelName}
              onInput=${(e) => setModelName(e.target.value)}
              placeholder="e.g. Claude Sonnet, GPT-4o, Gemini Pro"
            />
            <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Name of the model that generated this HTML
            </span>
          </div>

          <div class="form-group">
            <label>Tags (comma separated)</label>
            <div class="input-with-suggest">
              <input
                class="form-input"
                value=${tags}
                onInput=${(e) => setTags(e.target.value)}
                placeholder="e.g. landing-page, responsive, css-animation"
              />
              ${showTagsSuggest && html`
                <button
                  type="button"
                  class="btn-icon suggest-btn"
                  onClick=${suggestTags}
                  disabled=${suggestingTags}
                  title="Suggest tags with AI"
                >
                  <i class=${`fa-solid ${suggestingTags ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                </button>
              `}
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${handleSave}>
            <i class="fa-solid fa-floppy-disk"></i> Save
          </button>
        </div>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SUBJECT_KINDS } from '../services/prompts.js';
import { RIGGING_TARGETS } from '../services/riggingTargets.js';
import { MAX_REFERENCES } from '../services/referenceImage.js';
import { MAX_NAME } from '../services/projectStore.js';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';

export function BriefPanel({
  references, onReferences, brief, onBrief, kind, onKind,
  rigging, onRigging, rounds, onRounds,
  busy, canGenerate, onGenerate, onCancel, onPrepare, hasVersion,
  onAddFiles, onWanLibrary, name, onName,
  visionModels, eyesProvider, eyesModel, onEyes,
}) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  // The name is committed on blur or Enter, not on every keystroke: a rename
  // writes project.json, and one write per character is not a rename.
  const [draftName, setDraftName] = useState(null);
  const shownName = draftName === null ? name : draftName;
  const commitName = () => {
    const next = (shownName || '').trim();
    setDraftName(null);
    if (next && next !== name) onName(next);
  };
  // A project opened or started elsewhere replaces whatever was half-typed.
  useEffect(() => { setDraftName(null); }, [name]);

  // Normalising, capping and reporting all live in the app's one intake funnel —
  // a drop here is the same event as a WAN2GP pick or a cross-app handoff.
  const addFiles = files => onAddFiles([...files]);

  return html`
    <div class="us-rail">
      <label class="us-field">Project name
        <input type="text" value=${shownName} maxLength=${MAX_NAME} disabled=${busy}
               placeholder="Untitled asset"
               onInput=${e => setDraftName(e.target.value)}
               onBlur=${commitName}
               onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />
      </label>

      <div class="us-section">
        <h3>01 · Reference</h3>
        <div class=${`us-drop ${over ? 'over' : ''}`}
             onClick=${() => inputRef.current?.click()}
             onDragOver=${e => { e.preventDefault(); setOver(true); }}
             onDragLeave=${() => setOver(false)}
             onDrop=${e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
          <i class="fas fa-image"></i>
          Drop or choose 1–${MAX_REFERENCES} pictures
          <div class="us-note">PNG, JPEG or WebP. Resized to 1024px.</div>
        </div>
        <button class="us-btn us-btn-sm" disabled=${busy} onClick=${onWanLibrary}
                title="Pick a reference from images WAN2GP has already generated">
          <i class="fas fa-photo-film"></i> Choose from WAN2GP
        </button>
        <input ref=${inputRef} type="file" hidden multiple
               accept="image/png,image/jpeg,image/webp"
               onChange=${e => { addFiles(e.target.files); e.target.value = ''; }} />
        ${references.length > 0 && html`
          <div class="us-thumbs">
            ${references.map((src, index) => html`
              <div class="us-thumb" key=${index}>
                <img src=${src} alt=${`Reference ${index + 1}`} />
                <button title="Remove" disabled=${busy}
                        onClick=${() => onReferences(references.filter((_, i) => i !== index))}>✕</button>
              </div>`)}
          </div>`}
      </div>

      <div class="us-section">
        <h3>01b · Eyes</h3>
        <label class="us-check">
          <input type="checkbox" disabled=${busy || !visionModels.length}
                 checked=${Boolean(eyesProvider && eyesModel)}
                 onChange=${e => (e.target.checked
                   ? onEyes(visionModels[0]?.providerId || '', visionModels[0]?.modelId || '')
                   : onEyes('', ''))} />
          Describe the pictures with another model
        </label>
        ${eyesProvider && eyesModel
          ? html`
            <${ProviderModelSelector}
              models=${visionModels}
              providerId=${eyesProvider}
              modelId=${eyesModel}
              onChange=${onEyes}
              disabled=${busy}
            />
            <p class="us-note">
              This model reads your reference pictures and judges every render.
              The model in the toolbar only ever sees its words — so it can be one
              that cannot look at images at all.
            </p>`
          : html`
            <p class="us-note">
              ${visionModels.length
                ? 'Off: the model in the toolbar sees the pictures itself, and must be vision-capable.'
                : 'No vision-capable model is enabled, so there is nothing to describe with.'}
            </p>`}
      </div>

      <div class="us-section">
        <h3>02 · Direction</h3>
        <label class="us-field">Subject
          <select value=${kind} disabled=${busy} onChange=${e => onKind(e.target.value)}>
            ${SUBJECT_KINDS.map(entry => html`<option value=${entry.id}>${entry.label}</option>`)}
          </select>
        </label>

        ${kind === 'character' && html`
          <label class="us-field">Character output
            <select value=${rigging} disabled=${busy} onChange=${e => onRigging(e.target.value)}>
              ${RIGGING_TARGETS.map(target => html`<option value=${target.id}>${target.label}</option>`)}
            </select>
          </label>
          <p class="us-note">${RIGGING_TARGETS.find(t => t.id === rigging)?.hint}</p>
          ${hasVersion && rigging !== 'none' && html`
            <button class="us-btn us-btn-sm" disabled=${busy || !canGenerate}
                    onClick=${() => onPrepare(rigging)}>
              <i class="fas fa-person"></i>
              ${rigging === 'animated' ? 'Create animated version' : 'Create T-pose version'}
            </button>
            <p class="us-note">Uses the selected model. Earlier versions stay available.</p>`}`}

        <label class="us-field">Your brief
          <textarea rows="4" maxLength="8000" value=${brief} disabled=${busy}
                    placeholder="Style, important shapes, or changes you want…"
                    onInput=${e => onBrief(e.target.value)}></textarea>
        </label>

        <label class="us-field">Automatic refinements
          <select value=${String(rounds)} disabled=${busy} onChange=${e => onRounds(Number(e.target.value))}>
            <option value="0">No refinement — one pass</option>
            <option value="1">Up to 1 refinement</option>
            <option value="2">Up to 2 refinements</option>
            <option value="3">Up to 3 refinements</option>
          </select>
        </label>

        ${busy
          ? html`<button class="us-btn us-danger" onClick=${onCancel}>
                   <i class="fas fa-stop"></i> Stop generation
                 </button>`
          : html`<button class="us-btn us-primary" disabled=${!canGenerate} onClick=${onGenerate}>
                   <i class="fas fa-wand-magic-sparkles"></i> Generate and review
                 </button>`}
        ${!canGenerate && !busy && html`
          <p class="us-note">
            ${references.length ? 'Select a provider and model in the toolbar.' : 'Add at least one reference picture.'}
          </p>`}
      </div>
    </div>`;
}

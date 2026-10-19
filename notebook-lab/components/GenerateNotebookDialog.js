import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { hasBraveKey } from '../../shared/services/brave-search.js';
import { AgentRunTrace } from '../../shared/components/CodingAgentRun.js';
import { useDialogDismiss } from './useDialogDismiss.js';
import { availableKindOptions, isWebEdition } from '../services/edition.js';

const KIND_LABELS = {
  md: 'Markdown', js: 'JavaScript', py: 'Python', c: 'C', rust: 'Rust', lua: 'Lua',
  java: 'Java', go: 'Go', scala: 'Scala', clojure: 'Clojure', html: 'HTML', ui: 'Controls', chart: 'Vega-Lite',
};

const KIND_ICONS = {
  md: 'fa-solid fa-align-left', js: 'fa-solid fa-code', py: 'fa-brands fa-python', html: 'fa-solid fa-window-maximize',
  ui: 'fa-solid fa-sliders', chart: 'fa-solid fa-chart-scatter',
};

const LANGUAGE_OPTIONS = [
  { value: 'py', label: 'Python' },
  { value: 'js', label: 'JavaScript' },
  { value: 'html', label: 'HTML' },
  { value: 'c', label: 'C' },
  { value: 'rust', label: 'Rust' },
  { value: 'lua', label: 'Lua' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'scala', label: 'Scala' },
  { value: 'clojure', label: 'Clojure' },
];

const VISUAL_OPTIONS = [
  { value: 'auto', label: 'Auto — only when useful' },
  { value: 'none', label: 'No visual output' },
  { value: 'chart', label: 'Vega-Lite chart' },
  { value: 'plot', label: 'Python / Matplotlib plot' },
  { value: 'interactive', label: 'Interactive HTML visual' },
  { value: 'network', label: 'Network graph' },
];

function languageSummary(languages) {
  if (!languages.length) return 'Auto languages';
  return languages.map(value => LANGUAGE_OPTIONS.find(option => option.value === value)?.label || value).join(', ');
}

function visualLabel(value) {
  return VISUAL_OPTIONS.find(option => option.value === value)?.label || VISUAL_OPTIONS[0].label;
}

function statusIcon(stage) {
  if (stage === 'ready') return 'fa-circle-check';
  if (stage === 'error') return 'fa-triangle-exclamation';
  return 'fa-spinner fa-spin';
}

export function GenerateNotebookDialog({
  currentTitle,
  busy,
  status,
  draft,
  isAgent = false,
  agentRun,
  onGenerate,
  onApply,
  onDiscardDraft,
  onClose,
}) {
  // The web edition has no search proxy (serve.py), so the option is not offered.
  const searchOffered = !isWebEdition();
  const braveAvailable = searchOffered && hasBraveKey();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('create');
  const [useWebSearch, setUseWebSearch] = useState(braveAvailable);
  const [languages, setLanguages] = useState([]);
  const [visualOutput, setVisualOutput] = useState('auto');
  useDialogDismiss(onClose, { disabled: busy });

  const generate = () => onGenerate({
    prompt: prompt.trim(),
    mode,
    useWebSearch: useWebSearch && braveAvailable,
    languages,
    visualOutput,
  });
  const changePrompt = (value) => { setPrompt(value); if (draft) onDiscardDraft?.(); };
  const changeMode = (value) => { setMode(value); if (draft) onDiscardDraft?.(); };
  const changeSearch = (value) => { setUseWebSearch(value); if (draft) onDiscardDraft?.(); };
  const changeVisualOutput = (value) => { setVisualOutput(value); if (draft) onDiscardDraft?.(); };
  const chooseAutoLanguages = () => { setLanguages([]); if (draft) onDiscardDraft?.(); };
  const toggleLanguage = (value) => {
    setLanguages(current => current.includes(value)
      ? current.filter(language => language !== value)
      : [...current, value]);
    if (draft) onDiscardDraft?.();
  };
  const stage = status?.stage || 'idle';
  const progressText = status?.message || (busy ? 'Generating notebook…' : '');

  return html`
    <div class="modal-overlay">
      <div class="modal generate-notebook-modal" onClick=${event => event.stopPropagation()}>
        <div class="modal-header generate-notebook-header">
          <div>
            <h2><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Notebook</h2>
            <p>Turn one prompt into a connected, mixed-language notebook.</p>
          </div>
          <button class="btn-icon" onClick=${onClose} disabled=${busy} aria-label="Close notebook generator"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="modal-body generate-notebook-body">
          <section class="generate-notebook-request">
            <label class="generate-notebook-prompt">
              <span>What should the notebook investigate or build?</span>
              <textarea
                value=${prompt}
                onInput=${event => changePrompt(event.currentTarget.value)}
                placeholder="Example: Find an authoritative current exoplanet catalogue, analyse detection methods in Python, build selectable Vega plots, cite sources, and explain the observational biases."
                disabled=${busy}
                autofocus
              ></textarea>
            </label>

            <fieldset class="generate-notebook-language-picker" disabled=${busy}>
              <legend>Languages</legend>
              <p>Auto chooses the mix. Selections constrain generated executable cells.</p>
              <div>
                <button
                  type="button"
                  class=${`generate-notebook-choice ${languages.length === 0 ? 'active' : ''}`}
                  aria-pressed=${languages.length === 0}
                  onClick=${chooseAutoLanguages}
                >Auto</button>
                ${availableKindOptions(LANGUAGE_OPTIONS, 'value').map(option => html`
                  <button
                    type="button"
                    class=${`generate-notebook-choice ${languages.includes(option.value) ? 'active' : ''}`}
                    aria-pressed=${languages.includes(option.value)}
                    onClick=${() => toggleLanguage(option.value)}
                  >${option.label}</button>
                `)}
              </div>
              <small>Markdown, Controls, and Vega-Lite support cells may be added when needed.</small>
            </fieldset>

            <div class="generate-notebook-options">
              <label>
                <span>Destination</span>
                <select value=${mode} onChange=${event => changeMode(event.currentTarget.value)} disabled=${busy}>
                  <option value="create">Create a new notebook</option>
                  <option value="append">Append to “${currentTitle || 'Untitled Notebook'}”</option>
                </select>
              </label>
              <label>
                <span>Visual output</span>
                <select value=${visualOutput} onChange=${event => changeVisualOutput(event.currentTarget.value)} disabled=${busy}>
                  ${VISUAL_OPTIONS.map(option => html`<option value=${option.value}>${option.label}</option>`)}
                </select>
              </label>
              ${searchOffered && html`<label class=${`generate-notebook-search ${!braveAvailable ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked=${useWebSearch}
                  onChange=${event => changeSearch(event.currentTarget.checked)}
                  disabled=${busy || !braveAvailable}
                />
                <span><i class="fa-solid fa-globe"></i> Search web for current sources</span>
              </label>`}
            </div>
            ${searchOffered && !braveAvailable && html`
              <div class="generate-notebook-key-note">
                Web grounding is unavailable until a Brave Search key is configured in <a href="../settings/">Settings</a>.
              </div>
            `}

            <div class="generate-notebook-capabilities">
              <span><i class="fa-solid fa-code"></i> ${languageSummary(languages)}</span>
              <span><i class="fa-solid fa-chart-line"></i> ${visualLabel(visualOutput)}</span>
              <span><i class="fa-solid fa-link"></i> Connected data flow</span>
            </div>

            ${progressText && html`
              <div class=${`generate-notebook-status ${stage}`} role="status">
                <i class=${`fa-solid ${statusIcon(stage)}`}></i>
                <span>${progressText}</span>
                ${status?.chars > 0 && html`<small>${status.chars.toLocaleString()} characters received</small>`}
              </div>
            `}
            <${AgentRunTrace} run=${agentRun} />
          </section>

          ${draft ? html`
            <section class="generate-notebook-preview">
              <div class="generate-notebook-preview-head">
                <div>
                  <span class="eyebrow">Validated draft</span>
                  <h3>${draft.title}</h3>
                  ${draft.summary && html`<p>${draft.summary}</p>`}
                </div>
                <span class="generate-notebook-cell-count">${draft.cells.length} cells</span>
              </div>

              <div class="generate-notebook-draft-constraints">
                <span><i class="fa-solid fa-code"></i>${languageSummary(draft.constraints?.languages || languages)}</span>
                <span><i class="fa-solid fa-chart-line"></i>${visualLabel(draft.constraints?.visualOutput || visualOutput)}</span>
              </div>

              ${draft.warnings.length > 0 && html`
                <div class="generate-notebook-warnings">
                  ${draft.warnings.map(warning => html`<span><i class="fa-solid fa-triangle-exclamation"></i>${warning}</span>`)}
                </div>
              `}

              <div class="generate-notebook-plan">
                ${draft.cells.map((cell, index) => html`
                  <div class="generate-notebook-plan-cell" key=${`${index}-${cell.kind}`}>
                    <span class=${`generate-notebook-kind kind-${cell.kind}`}>
                      <i class=${KIND_ICONS[cell.kind] || 'fa-solid fa-terminal'}></i>
                      ${KIND_LABELS[cell.kind] || cell.kind}
                    </span>
                    <span class="generate-notebook-step">${index + 1}</span>
                    <strong>${cell.title}</strong>
                  </div>
                `)}
              </div>

              <div class="generate-notebook-sources">
                <h4><i class="fa-solid fa-book-open"></i> Sources supplied by the model</h4>
                ${draft.sources.length ? html`
                  <div>
                    ${draft.sources.map(source => html`
                      <a href=${source.url} target="_blank" rel="noopener noreferrer" title=${source.note || source.url}>
                        <span>${source.title}</span>
                        ${source.retrievedAt && html`<small>${source.retrievedAt}</small>`}
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                      </a>
                    `)}
                  </div>
                ` : html`<p>No structured source list was returned. Review citations before relying on current claims.</p>`}
              </div>
            </section>
          ` : html`
            <section class="generate-notebook-placeholder">
              <i class="fa-solid fa-diagram-project"></i>
              <h3>A plan appears here before anything changes</h3>
              <p>The response is parsed and checked for supported cell types, valid UI JSON, and valid Vega-Lite JSON. You choose whether to apply the draft.</p>
            </section>
          `}
        </div>

        <div class="modal-footer generate-notebook-footer">
          <span>${mode === 'append' ? `New cells will be added after the ${currentTitle || 'current notebook'}.` : 'A fresh notebook id will be allocated when you apply.'}</span>
          <div>
            ${agentRun?.running ? html`
              <button class="btn" onClick=${agentRun.cancel} disabled=${agentRun.cancelling}>
                <i class="fa-solid fa-stop"></i> ${agentRun.cancelling ? 'Stopping…' : 'Stop'}
              </button>
            ` : html`<button class="btn" onClick=${onClose} disabled=${busy}>Cancel</button>`}
            <button class="btn" onClick=${generate} disabled=${busy || !prompt.trim()}>
              <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : isAgent ? 'fa-terminal' : 'fa-wand-magic-sparkles'}`}></i>
              ${busy ? 'Generating…' : draft ? 'Regenerate draft' : 'Generate draft'}
            </button>
            ${draft && html`
              <button class="btn btn-primary" onClick=${onApply} disabled=${busy}>
                <i class="fa-solid fa-check"></i> ${mode === 'append' ? 'Append cells' : 'Open generated notebook'}
              </button>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

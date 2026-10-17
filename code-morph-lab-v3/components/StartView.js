import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { RecentMorphsList } from './RecentMorphsList.js';
import { WorkspacePanel } from './WorkspacePanel.js';

/**
 * Start view — centered prompt composer + imports row + (later) recent morphs.
 * @param {Object} props
 * @param {string} props.prompt
 * @param {Function} props.onPromptChange
 * @param {'html'|'python'} props.language
 * @param {Function} props.onLanguageChange
 * @param {number} props.maxIterations
 * @param {Function} props.onMaxIterationsChange
 * @param {boolean} props.canGenerate - guardrail: model selected, prompt/import present, etc.
 * @param {Function} props.onGenerate
 * @param {Object|null} props.arrivedImport - handoff payload if one just arrived
 * @param {Function} props.onDismissImport
 */
export function StartView({
  prompt, onPromptChange,
  language, onLanguageChange,
  maxIterations, onMaxIterationsChange,
  canGenerate, onGenerate,
  arrivedImport, onDismissImport,
  recentSessions, onOpenSession, onDeleteSession,
}) {
  const importedFiles = arrivedImport?.kind === 'code' ? (arrivedImport.files || []) : [];
  const importedSnapshot = useMemo(
    () => Object.fromEntries(importedFiles.map(file => [file.name, file.content || ''])),
    [importedFiles]
  );
  const importedFileNames = useMemo(() => Object.keys(importedSnapshot).sort(), [importedSnapshot]);
  const [selectedImportFile, setSelectedImportFile] = useState('');

  useEffect(() => {
    if (selectedImportFile && importedFileNames.includes(selectedImportFile)) return;
    const nextFile = importedFileNames[0] || '';
    if (selectedImportFile !== nextFile) setSelectedImportFile(nextFile);
  }, [importedFileNames, selectedImportFile]);

  const sources = [
    { id: 'prompt-gallery', label: 'Prompt Gallery', path: '../prompt-gallery/' },
    { id: 'three-prompt-lab', label: 'Three Prompt Lab', path: '../three-prompt-lab/' },
    { id: 'model-eval-lab', label: 'Model Eval Lab', path: '../model-eval-lab/' },
    { id: 'svg-benchmark', label: 'SVG Benchmark', path: '../svg-benchmark/' },
    { id: 'code-arena', label: 'Code Arena', path: '../code-arena/' },
  ];

  return html`
    <div class="start-view">
      <div class="start-left">
        <div class="prompt-section">
          <div class="section-header">
            <span><i class="fa-solid fa-comment-dots"></i> ${arrivedImport?.kind === 'code' ? 'Prompt' : 'Goal'}</span>
          </div>
          ${arrivedImport?.kind === 'code'
            ? html`
              <div class="import-prompt-stack">
                <div class="import-original-prompt">
                  <label>Original prompt</label>
                  <div>${arrivedImport.prompt || 'No original prompt was supplied with this import.'}</div>
                </div>
                <label class="import-change-label">Requested changes</label>
                <textarea
                  class="prompt-textarea import-change-textarea"
                  placeholder="Describe what you want changed in the imported app."
                  value=${prompt}
                  onInput=${(e) => onPromptChange(e.target.value)}
                ></textarea>
              </div>
            `
            : html`
              <textarea
                class="prompt-textarea"
                placeholder="e.g. Build a page with a dark/light mode toggle that persists the user's preference in localStorage."
                value=${prompt}
                onInput=${(e) => onPromptChange(e.target.value)}
              ></textarea>
            `}
        </div>

        ${importedFileNames.length > 0 && html`
          <div class="import-code-section">
            <div class="section-header">
              <span><i class="fa-solid fa-file-code"></i> Imported code</span>
              <span class="section-meta">${selectedImportFile}</span>
            </div>
            <${WorkspacePanel}
              files=${importedFileNames}
              selectedFile=${selectedImportFile}
              onSelectFile=${setSelectedImportFile}
              snapshot=${importedSnapshot}
              readOnly=${true}
            />
          </div>
        `}

        <div class="start-config-section">
          <div class="section-header">
            <span><i class="fa-solid fa-sliders"></i> Morph settings</span>
          </div>
          <div class="start-config-body">
            <div class="start-control">
              <label>Language</label>
              <div class="language-tabs">
                <button
                  class=${`nav-tab ${language === 'html' ? 'active' : ''}`}
                  onClick=${() => onLanguageChange('html')}
                >
                  <i class="fa-brands fa-html5"></i> HTML
                </button>
                <button
                  class=${`nav-tab ${language === 'python' ? 'active' : ''}`}
                  onClick=${() => onLanguageChange('python')}
                >
                  <i class="fa-brands fa-python"></i> Python
                </button>
              </div>
            </div>
            <div class="start-control">
              <label>Max iterations</label>
              <select
                class="form-input"
                value=${maxIterations}
                onChange=${(e) => onMaxIterationsChange(parseInt(e.target.value, 10))}
              >
                ${[3, 5, 8, 10, 15].map(n => html`<option value=${n}>${n}</option>`)}
              </select>
            </div>
            <button
              class="btn btn-generate start-generate"
              disabled=${!canGenerate}
              onClick=${onGenerate}
            >
              <i class="fa-solid fa-bolt"></i>
              <span class="btn-label">Generate & Morph</span>
            </button>
          </div>
        </div>
      </div>

      <div class="start-right">
        <section class="start-side-section">
          <div class="section-header">
            <span><i class="fa-solid fa-file-import"></i> Import</span>
          </div>
          <div class="start-side-body">
            ${arrivedImport
              ? html`
                <div class="arrival-chip">
                  <div class="arrival-chip-head">
                    <span>Imported from <strong>${arrivedImport.source}</strong></span>
                    <button class="btn-icon btn-sm" onClick=${onDismissImport} title="Dismiss import">
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                  ${arrivedImport.title && html`<div class="arrival-chip-title">${arrivedImport.title}</div>`}
                  ${arrivedImport.prompt && html`<div class="arrival-chip-body">${arrivedImport.prompt}</div>`}
                </div>
              `
              : html`
                <div class="start-empty">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  <p>Start from another tool when you want to continue an existing prompt or code result.</p>
                </div>
              `}
            <div class="source-grid">
              ${sources.map(s => html`
                <a class="source-card" key=${s.id} href=${s.path}>
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  <span>${s.label}</span>
                </a>
              `)}
            </div>
          </div>
        </section>

        <section class="start-side-section recent-section">
          <div class="section-header">
            <span><i class="fa-solid fa-clock-rotate-left"></i> Recent morphs</span>
          </div>
          <div class="start-side-body">
            <${RecentMorphsList} sessions=${recentSessions} onOpen=${onOpenSession} onDelete=${onDeleteSession} />
          </div>
        </section>
      </div>
    </div>
  `;
}

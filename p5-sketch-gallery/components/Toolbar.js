import { html } from 'htm/preact';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  route,
  theme,
  onNavigate,
  onToggleTheme,
  hasDirectory,
  directoryName,
  onPickDirectory,
  onSave,
  onClear,
  onHelpClick,
  // Provider/model
  allModels,
  selectedProviderId,
  selectedModelId,
  onModelChange,
  onGenerate,
  isGenerating,
  modelsLoading,
  hasApiKey,
  onApiKeyClick,
  onProviderSettingsClick,
  onBatch,
  recordingProps,
}) {
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title">
          <i class="fa-solid fa-pen-nib"></i> p5 Sketch Gallery
        </span>
        ${(route === 'create' || route === 'prompts') && html`
          <div class="toolbar-divider"></div>
          <div class="openrouter-group">
            <button
              class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
              onClick=${onApiKeyClick}
              title=${hasApiKey ? 'API key configured (click to manage)' : 'Set OpenRouter API key'}
            >
              <i class="fa-solid fa-key"></i>
            </button>
            <button
              class="btn-icon"
              onClick=${onProviderSettingsClick}
              title="Provider settings"
              style=${{ fontSize: '13px', padding: '4px 8px' }}
            >
              <i class="fa-solid fa-server"></i>
            </button>
            <${ProviderModelSelector}
              models=${allModels}
              providerId=${selectedProviderId}
              modelId=${selectedModelId}
              onChange=${onModelChange}
              disabled=${allModels.length === 0 && !modelsLoading}
              loading=${modelsLoading}
              onSettingsClick=${onProviderSettingsClick}
            />
            ${route === 'create' && html`
              <button
                class=${`btn ${isGenerating ? 'btn-generating' : 'btn-generate'}`}
                onClick=${onGenerate}
                disabled=${isGenerating}
                title="Generate p5 sketch from prompt"
              >
                <i class=${`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
                <span class="btn-label">${isGenerating ? 'Generating...' : 'Generate'}</span>
              </button>
            `}
          </div>
        `}
      </div>

      <div class="toolbar-center">
        <button class=${`nav-tab ${route === 'create' ? 'active' : ''}`} onClick=${() => onNavigate('create')}>
          <i class="fa-solid fa-plus"></i> Create
        </button>
        <button class=${`nav-tab ${route === 'prompts' ? 'active' : ''}`} onClick=${() => onNavigate('prompts')}>
          <i class="fa-solid fa-book-open"></i> Prompts
        </button>
        <button class=${`nav-tab ${route === 'gallery' ? 'active' : ''}`} onClick=${() => onNavigate('gallery')}>
          <i class="fa-solid fa-images"></i> Gallery
        </button>
        <button class=${`nav-tab ${route === 'compare' ? 'active' : ''}`} onClick=${() => onNavigate('compare')}>
          <i class="fa-solid fa-columns"></i> Compare
        </button>
        <button class=${`nav-tab ${route === 'runs' ? 'active' : ''}`} onClick=${() => onNavigate('runs')}>
          <i class="fa-solid fa-clock-rotate-left"></i> Runs
        </button>
      </div>

      <div class="toolbar-right">
        <button
          class="btn btn-directory"
          onClick=${onPickDirectory}
          title=${hasDirectory ? `Sketch folder: ${directoryName} (click to change)` : 'Connect a folder to save your work'}
        >
          <i class=${`fa-solid ${hasDirectory ? 'fa-folder-open' : 'fa-folder-plus'}`}></i>
          <span class="btn-label directory-name">${hasDirectory ? directoryName : 'Connect folder'}</span>
        </button>
        <button class="btn btn-batch" onClick=${onBatch} title="Run one model over selected prompt-library entries">
          <i class="fa-solid fa-layer-group"></i>
          <span class="btn-label">Batch</span>
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        ${route === 'create' && html`
          <div class="toolbar-divider"></div>
          <button class="btn" onClick=${onClear} title="Clear all fields">
            <i class="fa-solid fa-eraser"></i>
            <span class="btn-label">Clear</span>
          </button>
          <button class="btn btn-primary" onClick=${onSave} title="Save as a new sketch (Ctrl+S)">
            <i class="fa-solid fa-floppy-disk"></i>
            <span class="btn-label">Save</span>
          </button>
        `}
        <button class="btn-icon" onClick=${onHelpClick} title="Help">
          <i class="fa-solid fa-circle-question"></i>
        </button>
        <button class="btn-icon" onClick=${onToggleTheme} title=${`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>
  `;
}

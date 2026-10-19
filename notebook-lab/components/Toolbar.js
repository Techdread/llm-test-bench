import { html } from 'htm/preact';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CodingAgentActivity } from '../../shared/components/CodingAgentActivity.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';
import { isWebEdition } from '../services/edition.js';

export function Toolbar({
  theme,
  onToggleTheme,
  title,
  onTitleChange,
  allModels,
  selectedProviderId,
  selectedModelId,
  backend,
  agentId,
  agentModelId,
  onExecutorChange,
  modelsLoading,
  hasApiKey,
  onApiKeyClick,
  onProviderSettingsClick,
  onGenerateNotebook,
  onRunAll,
  onClearAll,
  onNew,
  onOpen,
  onSave,
  onExportHtml,
  onHelpClick,
  onRuntimesClick,
  apiQueueStatus,
  isBusy,
  recordingProps,
}) {
  // The web edition has no file-drop API and no runtime backends to switch.
  const webEdition = isWebEdition();
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title">
          <i class="fa-solid fa-book"></i> Notebook Lab
        </span>
        <input
          class="notebook-title-input"
          style=${{ minWidth: '220px', maxWidth: '360px', fontSize: '14px', fontWeight: 600 }}
          value=${title}
          onInput=${(e) => onTitleChange(e.target.value)}
          placeholder="Notebook title"
        />
        <div class="toolbar-divider"></div>
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${hasApiKey ? 'API key configured' : 'Click to set your OpenRouter API key'}
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
          <${ExecutorModelSelector}
            models=${allModels}
            backend=${backend}
            providerId=${selectedProviderId}
            modelId=${selectedModelId}
            agentId=${agentId}
            agentModelId=${agentModelId}
            onChange=${onExecutorChange}
            disabled=${allModels.length === 0 && !modelsLoading && backend !== 'agent'}
            loading=${modelsLoading}
            onSettingsClick=${onProviderSettingsClick}
          />
        </div>
      </div>
      <div class="toolbar-right">
        <${CodingAgentActivity} appId="notebook-lab" />
        <button class="btn btn-generate notebook-generate-button" onClick=${onGenerateNotebook} disabled=${isBusy} title="Generate a complete multi-cell notebook from one prompt">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span class="btn-label">Generate notebook</span>
        </button>
        <button class="btn btn-primary" onClick=${onRunAll} disabled=${isBusy} title="Run all cells">
          <i class=${`fa-solid ${isBusy ? 'fa-spinner fa-spin' : 'fa-forward-step'}`}></i>
          <span class="btn-label">${isBusy ? 'Running…' : 'Run all'}</span>
        </button>
        <button class="btn" onClick=${onClearAll} disabled=${isBusy} title="Clear all cell outputs">
          <i class="fa-solid fa-eraser"></i>
          <span class="btn-label">Clear all</span>
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        <div class="toolbar-divider"></div>
        <button class="btn-icon" onClick=${onNew} title="New notebook"><i class="fa-solid fa-file"></i></button>
        <button class="btn-icon" onClick=${onOpen} title="Open notebook"><i class="fa-solid fa-folder-open"></i></button>
        <button class="btn-icon" onClick=${onSave} title="Save notebook"><i class="fa-solid fa-floppy-disk"></i></button>
        <button class="btn-icon" onClick=${onExportHtml} title="Export standalone HTML"><i class="fa-solid fa-download"></i></button>
        ${!webEdition && html`
          <span class=${`api-queue-badge api-${apiQueueStatus?.state || 'disabled'}`} title=${apiQueueStatus?.message || 'Notebook API'}>
            <i class="fa-solid fa-plug"></i>
            <span class="btn-label">API</span>
          </span>
        `}
        <div class="toolbar-divider"></div>
        ${!webEdition && html`
          <button class="btn-icon" onClick=${onRuntimesClick} title="Runtime center — open tabs, memory and language backends">
            <i class="fa-solid fa-gears"></i>
          </button>
        `}
        <button class="btn-icon" onClick=${onHelpClick} title="Help"><i class="fa-solid fa-circle-question"></i></button>
        <button class="btn-icon" onClick=${onToggleTheme} title=${`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>
  `;
}

import { html } from 'htm/preact';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CodingAgentActivity } from '../../shared/components/CodingAgentActivity.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  route,
  theme,
  onNavigate,
  onToggleTheme, onHelp,
  onSave,
  onClear,
  hasDirectory,
  directoryName,
  onPickDirectory,
  // Provider/model props
  allModels,
  selectedProviderId,
  selectedModelId,
  backend,
  agentId,
  agentModelId,
  onExecutorChange,
  onGenerate,
  onCancelAgent,
  agentRunning,
  agentCancelling,
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
          <i class="fa-solid fa-images"></i> Prompt Gallery
        </span>
        <div class="toolbar-divider"></div>
        <!-- The picker stays on every tab: Prompts runs generations, Refine and
             Batch both use whatever is selected here, and Compare/Gallery are
             where you decide what to run next. Only Generate is Create-only. -->
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${hasApiKey ? 'API key configured (click to manage)' : 'Click to set your free OpenRouter API key'}
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
          ${agentRunning
            // Stop is shown wherever a run is live — a run started from Prompts
            // must still be stoppable after navigating away from Create.
            ? html`
              <button class="btn" onClick=${onCancelAgent} disabled=${agentCancelling}
                title="Stop the running CLI agent">
                <i class="fa-solid fa-stop"></i>
                <span class="btn-label">${agentCancelling ? 'Stopping…' : 'Stop'}</span>
              </button>`
            : route === 'create' && html`
              <button
                class=${`btn ${isGenerating ? 'btn-generating' : 'btn-generate'}`}
                onClick=${onGenerate}
                disabled=${isGenerating}
                title=${allModels.length > 0 || backend === 'agent' ? 'Generate HTML from prompt' : 'Configure a provider first'}
              >
                <i class=${`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : backend === 'agent' ? 'fa-terminal' : 'fa-bolt'}`}></i>
                <span class="btn-label">${isGenerating ? 'Generating...' : 'Generate'}</span>
              </button>`}
        </div>
      </div>

      <div class="toolbar-center">
        <button
          class=${`nav-tab ${route === 'create' ? 'active' : ''}`}
          onClick=${() => onNavigate('create')}
        >
          <i class="fa-solid fa-plus"></i> Create
        </button>
        <button
          class=${`nav-tab ${route === 'prompts' ? 'active' : ''}`}
          onClick=${() => onNavigate('prompts')}
        >
          <i class="fa-solid fa-book"></i> Prompts
        </button>
        <button
          class=${`nav-tab ${route === 'refine' ? 'active' : ''}`}
          onClick=${() => onNavigate('refine')}
        >
          <i class="fa-solid fa-screwdriver-wrench"></i> Refine
        </button>
        <button
          class=${`nav-tab ${route === 'gallery' ? 'active' : ''}`}
          onClick=${() => onNavigate('gallery')}
        >
          <i class="fa-solid fa-images"></i> Gallery
        </button>
        <button
          class=${`nav-tab ${route === 'compare' ? 'active' : ''}`}
          onClick=${() => onNavigate('compare')}
        >
          <i class="fa-solid fa-columns"></i> Compare
        </button>
        <button
          class=${`nav-tab ${route === 'runs' ? 'active' : ''}`}
          onClick=${() => onNavigate('runs')}
        >
          <i class="fa-solid fa-layer-group"></i> Runs
        </button>
      </div>

      <div class="toolbar-right">
        <${CodingAgentActivity} appId="prompt-gallery" />
        <button
          class="btn btn-directory"
          onClick=${onPickDirectory}
          title=${hasDirectory ? `Gallery folder: ${directoryName} (click to change)` : 'Connect a folder to save your work'}
        >
          <i class=${`fa-solid ${hasDirectory ? 'fa-folder-open' : 'fa-folder-plus'}`}></i>
          <span class="btn-label directory-name">${hasDirectory ? directoryName : 'Connect folder'}</span>
        </button>
        <button class="btn btn-batch" onClick=${onBatch} title="Batch run one model over your prompt library">
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
          <button class="btn btn-primary" onClick=${onSave} title="Save (Ctrl+S)">
            <i class="fa-solid fa-floppy-disk"></i>
            <span class="btn-label">Save</span>
          </button>
        `}
        <button class="btn-icon" onClick=${onHelp} title="Help">
          <i class="fa-solid fa-circle-question"></i>
        </button>
        <button
          class="btn-icon"
          onClick=${onToggleTheme}
          title=${`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>
  `;
}

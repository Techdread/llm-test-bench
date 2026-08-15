import { html } from 'htm/preact';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CodingAgentActivity } from '../../shared/components/CodingAgentActivity.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  route,
  theme,
  onNavigate,
  onToggleTheme,
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
  onHelpClick,
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
          <i class="fa-solid fa-bezier-curve"></i> SVG Benchmark
        </span>
        ${route === 'create' && html`
          <div class="toolbar-divider"></div>
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
              ? html`
                <button class="btn" onClick=${onCancelAgent} disabled=${agentCancelling}
                  title="Stop the running CLI agent">
                  <i class="fa-solid fa-stop"></i>
                  <span class="btn-label">${agentCancelling ? 'Stopping…' : 'Stop'}</span>
                </button>`
              : html`
                <button
                  class=${`btn ${isGenerating ? 'btn-generating' : 'btn-generate'}`}
                  onClick=${onGenerate}
                  disabled=${isGenerating}
                  title=${allModels.length > 0 || backend === 'agent' ? 'Generate SVG from prompt' : 'Configure a provider first'}
                >
                  <i class=${`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : backend === 'agent' ? 'fa-terminal' : 'fa-bolt'}`}></i>
                  <span class="btn-label">${isGenerating ? 'Generating...' : 'Generate'}</span>
                </button>`}
          </div>
        `}
      </div>

      <div class="toolbar-center">
        <button
          class=${`nav-tab ${route === 'create' ? 'active' : ''}`}
          onClick=${() => onNavigate('create')}
        >
          <i class="fa-solid fa-plus"></i> Create
        </button>
        <button
          class=${`nav-tab ${route === 'benchmarks' ? 'active' : ''}`}
          onClick=${() => onNavigate('benchmarks')}
        >
          <i class="fa-solid fa-grid-2"></i> Benchmarks
        </button>
        <button
          class=${`nav-tab ${route === 'runs' ? 'active' : ''}`}
          onClick=${() => onNavigate('runs')}
        >
          <i class="fa-solid fa-clock-rotate-left"></i> Runs
        </button>
      </div>

      <div class="toolbar-right">
        <${CodingAgentActivity} appId="svg-benchmark" />
        <button class="btn btn-batch" onClick=${onBatch} title="Batch run one model over every benchmark prompt">
          <i class="fa-solid fa-layer-group"></i>
          <span class="btn-label">Batch</span>
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        <button
          class="btn btn-directory"
          onClick=${onPickDirectory}
          title=${hasDirectory ? `Benchmark folder: ${directoryName} (click to change)` : 'Connect a folder to save your work'}
        >
          <i class=${`fa-solid ${hasDirectory ? 'fa-folder-open' : 'fa-folder-plus'}`}></i>
          <span class="btn-label directory-name">${hasDirectory ? directoryName : 'Connect folder'}</span>
        </button>
        <button class="btn-icon" onClick=${onHelpClick} title="Help">
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

import { html } from 'htm/preact';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { AgentActivity } from './AgentActivity.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  theme, onToggleTheme, onHelp,
  models, providerId, modelId, modelsLoading, onProviderSettings,
  backend, agentId, agentModelId, onExecutorChange,
  hasApiKey, onApiKeyClick,
  view, onViewChange, directoryName, onPickDirectory, onBatch,
  recordingProps,
}) {
  const tab = (id, label, icon) => html`
    <button class=${`gf-tab ${view === id ? 'active' : ''}`} onClick=${() => onViewChange(id)}>
      <i class=${`fas ${icon}`}></i> ${label}
    </button>`;

  return html`
    <div class="gf-toolbar">
      <div class="gf-toolbar-left">
        <a class="gf-icon-btn gf-hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="gf-brand"><i class="fas fa-vr-cardboard"></i> VR Forge</span>
        <div class="gf-tabs">
          ${tab('library', 'Library', 'fa-list')}
          ${tab('build', 'Build', 'fa-hammer')}
          ${tab('runs', 'Runs', 'fa-clock-rotate-left')}
          ${tab('matrix', 'Matrix', 'fa-table-cells')}
        </div>
      </div>
      <div class="gf-toolbar-right">
        <${AgentActivity} />
        <!-- One picker for every executor: in-app provider models and the local
             CLI agents share the toolbar dropdown, so a build is configured in
             the same place regardless of who runs it. Key and provider settings
             sit in the same pill, as everywhere else on the hub. -->
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${hasApiKey ? 'OpenRouter API key configured (click to manage)' : 'Click to set your OpenRouter API key'}
          >
            <i class="fa-solid fa-key"></i>
          </button>
          <button
            class="btn-icon"
            onClick=${onProviderSettings}
            title="Provider settings"
            style=${{ fontSize: '13px', padding: '4px 8px' }}
          >
            <i class="fa-solid fa-server"></i>
          </button>
          <${ExecutorModelSelector}
            models=${models}
            backend=${backend}
            providerId=${providerId}
            modelId=${modelId}
            agentId=${agentId}
            agentModelId=${agentModelId}
            onChange=${onExecutorChange}
            loading=${modelsLoading}
            onSettingsClick=${onProviderSettings}
          />
        </div>
        <button class="gf-btn" title="Batch build — run an in-app model or CLI agent over many briefs" onClick=${onBatch}>
          <i class="fas fa-layer-group"></i> Batch
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        <button class="gf-icon-btn" title=${directoryName ? `Data root: ${directoryName}` : 'Connect data root'} onClick=${onPickDirectory}>
          <i class=${`fas ${directoryName ? 'fa-folder-open' : 'fa-folder'}`}></i>
        </button>
        <button class="gf-icon-btn" title="Toggle theme" onClick=${onToggleTheme}>
          <i class=${`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
        <button class="gf-icon-btn" title="Help" onClick=${onHelp}><i class="fas fa-circle-question"></i></button>
      </div>
    </div>`;
}

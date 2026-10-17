import { html } from 'htm/preact';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';

export function Toolbar({
  theme, onToggleTheme,
  language, onLanguageChange,
  presetId, presets, onPresetChange,
  hasRoot, onPickRoot, onOpenSessions, onSave,
  allModels, selectedProviderId, selectedModelId, onModelChange,
  apiKeySet, onApiKeyClick, modelsLoading, onProviderSettingsClick,
  sessionName, onRename,
  onDetect, detecting, useLLM, onToggleUseLLM,
  onRun, running,
  status,
  onHelpClick,
}) {
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title"><i class="fa-solid fa-chart-line"></i> Algorithm Visualizer</span>
        <div class="toolbar-divider"></div>
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${apiKeySet ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${apiKeySet ? 'API key configured' : 'Set API key'}
          ><i class="fa-solid fa-key"></i></button>
          <button class="btn-icon" onClick=${onProviderSettingsClick} title="Provider settings">
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
        </div>
        <button
          class=${`btn ${running ? 'btn-generating' : 'btn-generate'}`}
          onClick=${onRun}
          disabled=${running}
          title="Run & visualise"
        >
          <i class=${`fa-solid ${running ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
          <span class="btn-label">${running ? 'Tracing…' : 'Run'}</span>
        </button>
        <button class="btn" onClick=${onDetect} disabled=${detecting || running} title="Re-detect visualisation kind">
          <i class=${`fa-solid ${detecting ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
          <span class="btn-label">${detecting ? 'Detecting…' : 'Detect'}</span>
        </button>
        <label class="toolbar-checkbox" title="Use LLM to pick kind / mapping (off = heuristic only)">
          <input type="checkbox" checked=${useLLM} onChange=${(e) => onToggleUseLLM(e.target.checked)}/>
          <span>LLM</span>
        </label>
      </div>
      <div class="toolbar-center">
        <label class="toolbar-field" title="Language">
          <select value=${language} onChange=${(e) => onLanguageChange(e.target.value)}>
            <option value="js">JavaScript</option>
            <option value="python">Python</option>
          </select>
        </label>
        <label class="toolbar-field" title="Preset">
          <select value=${presetId || ''} onChange=${(e) => onPresetChange(e.target.value)}>
            <option value="">Custom</option>
            ${presets.map(p => html`<option value=${p.id}>${p.label}</option>`)}
          </select>
        </label>
        ${status && html`
          <span class=${`muted ${status.kind === 'error' ? 'api-key-missing' : ''}`}
                style=${{ marginLeft: 10, fontSize: 12,
                          color: status.kind === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
            ${status.kind === 'error'
              ? html`<i class="fa-solid fa-triangle-exclamation"></i> ${status.message}`
              : html`<i class="fa-solid fa-check"></i> ${status.message}`}
          </span>
        `}
      </div>
      <div class="toolbar-right">
        <input
          class="form-input"
          type="text"
          value=${sessionName}
          onInput=${(e) => onRename(e.target.value)}
          placeholder="Session name"
          style=${{ width: '140px' }}
        />
        <button class="btn" onClick=${onSave} title="Save current session" disabled=${!hasRoot}>
          <i class="fa-solid fa-floppy-disk"></i>
          <span class="btn-label">Save</span>
        </button>
        <button class="btn" onClick=${onOpenSessions} title="Open saved sessions" disabled=${!hasRoot}>
          <i class="fa-solid fa-folder-open"></i>
          <span class="btn-label">Sessions</span>
        </button>
        <div class="toolbar-divider"></div>
        <button
          class=${`btn-icon ${hasRoot ? '' : 'api-key-missing'}`}
          onClick=${onPickRoot}
          title=${hasRoot ? 'Data root set' : 'Pick data root'}
        >
          <i class=${`fa-solid ${hasRoot ? 'fa-folder-open' : 'fa-folder'}`}></i>
        </button>
        <button class="btn-icon" onClick=${onHelpClick} title="Help">
          <i class="fa-solid fa-circle-question"></i>
        </button>
        <button class="btn-icon" onClick=${onToggleTheme} title="Toggle theme">
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>
  `;
}

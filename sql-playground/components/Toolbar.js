import { html } from 'htm/preact';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';

export function Toolbar({
  theme, onToggleTheme,
  onRun, onRunPlan, running,
  onFormat,
  onImportCsv, onExportCsv,
  onImportSql,
  dbName, dirty, onSave, onSaveAs, onRename,
  allModels, modelsLoading,
  selectedProviderId, selectedModelId, onModelChange,
  apiKeySet, onApiKeyClick, onProviderSettingsClick,
  onHelpClick,
}) {
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title"><i class="fa-solid fa-database"></i> SQL Playground</span>
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
      </div>
      <div class="toolbar-right">
        ${dbName && html`
          <span class=${`db-name-pill ${dirty ? 'is-dirty' : ''}`} onClick=${onRename} title="Rename database">
            <i class="fa-solid fa-database"></i> ${dbName}${dirty ? ' •' : ''}
          </span>
        `}
        <button class=${`btn btn-primary ${running ? 'btn-running' : ''}`} onClick=${onRun} title="Run query (Ctrl+Enter)">
          <i class=${`fa-solid ${running ? 'fa-spinner fa-spin' : 'fa-play'}`}></i>
          <span class="btn-label">Run</span>
        </button>
        <button class="btn" onClick=${onRunPlan} title="EXPLAIN QUERY PLAN">
          <i class="fa-solid fa-diagram-project"></i>
          <span class="btn-label">Plan</span>
        </button>
        <button class="btn-icon" onClick=${onFormat} title="Format SQL">
          <i class="fa-solid fa-align-left"></i>
        </button>
        <div class="toolbar-divider"></div>
        <button class="btn" onClick=${onSave} title="Save DB">
          <i class="fa-solid fa-floppy-disk"></i>
          <span class="btn-label">Save</span>
        </button>
        <button class="btn-icon" onClick=${onSaveAs} title="Save DB as…">
          <i class="fa-solid fa-copy"></i>
        </button>
        <button class="btn-icon" onClick=${onImportCsv} title="Import CSV as table">
          <i class="fa-solid fa-file-csv"></i>
        </button>
        <button class="btn-icon" onClick=${onExportCsv} title="Export results as CSV">
          <i class="fa-solid fa-file-export"></i>
        </button>
        <button class="btn-icon" onClick=${onImportSql} title="Run SQL file">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <div class="toolbar-divider"></div>
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

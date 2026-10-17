import { html } from 'htm/preact';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';

export function Toolbar({
  theme,
  lessons,
  lessonId,
  onLessonChange,
  allModels,
  selectedProviderId,
  selectedModelId,
  onModelChange,
  modelsLoading,
  hasApiKey,
  onProviderSettingsClick,
  onGenerate,
  onExplain,
  isGenerating,
  isExplaining,
  onCompile,
  onRunPause,
  onStep,
  onStepOver,
  onReset,
  onCompare,
  onConfig,
  onExport,
  onImport,
  onHelpClick,
  onToggleTheme,
  isRunning,
  canExecute,
  dirty,
}) {
  return html`
    <div class="toolbar cml-toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title"><i class="fa-solid fa-memory"></i> C Machine Lab</span>
        <select class="lesson-select" value=${lessonId} onChange=${e => onLessonChange(e.target.value)} title="Lesson">
          ${lessons.map(lesson => html`
            <option value=${lesson.id} key=${lesson.id}>${lesson.topic} · ${lesson.title}</option>
          `)}
        </select>
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onProviderSettingsClick}
            title=${hasApiKey ? 'Model provider configured' : 'Configure model provider'}
          >
            <i class="fa-solid fa-key"></i>
          </button>
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
          <button class=${`btn ${isGenerating ? 'btn-generating' : 'btn-generate'}`} onClick=${onGenerate} disabled=${isGenerating} title="Generate a teaching C program">
            <i class=${`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
            <span class="btn-label">${isGenerating ? 'Generating' : 'Generate'}</span>
          </button>
          <button class="btn btn-explain" onClick=${onExplain} disabled=${isExplaining || !canExecute} title="Explain current machine state">
            <i class=${`fa-solid ${isExplaining ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i>
            <span class="btn-label">${isExplaining ? 'Explaining' : 'Explain'}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <button class=${`btn ${dirty ? 'btn-primary' : ''}`} onClick=${onCompile} title="Compile source to teaching assembly">
          <i class="fa-solid fa-hammer"></i>
          <span class="btn-label">Compile</span>
        </button>
        <button class="btn btn-primary" onClick=${onRunPause} disabled=${!canExecute} title="Run or pause VM">
          <i class=${`fa-solid ${isRunning ? 'fa-pause' : 'fa-play'}`}></i>
          <span class="btn-label">${isRunning ? 'Pause' : 'Run'}</span>
        </button>
        <button class="btn" onClick=${onStep} disabled=${!canExecute || isRunning} title="Step into one instruction">
          <i class="fa-solid fa-forward-step"></i>
          <span class="btn-label">Step</span>
        </button>
        <button class="btn" onClick=${onStepOver} disabled=${!canExecute || isRunning} title="Step over a function call">
          <i class="fa-solid fa-share"></i>
          <span class="btn-label">Over</span>
        </button>
        <button class="btn" onClick=${onReset} title="Reset VM">
          <i class="fa-solid fa-rotate-left"></i>
          <span class="btn-label">Reset</span>
        </button>
        <button class="btn" onClick=${onCompare} title="Run with C runtime and compare stdout">
          <i class="fa-solid fa-code-compare"></i>
          <span class="btn-label">Compare</span>
        </button>
        <button class="btn" onClick=${onConfig} title="Machine config">
          <i class="fa-solid fa-sliders"></i>
          <span class="btn-label">Config</span>
        </button>
        <div class="toolbar-divider"></div>
        <button class="btn-icon" onClick=${onExport} title="Export session">
          <i class="fa-solid fa-download"></i>
        </button>
        <button class="btn-icon" onClick=${onImport} title="Import session">
          <i class="fa-solid fa-file-import"></i>
        </button>
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

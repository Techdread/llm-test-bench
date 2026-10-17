// Toolbar — the hub-standard three-band layout (spec: toolbar standardization),
// laid out the way Prompt Gallery lays it out: identity and the OpenRouter
// island on the left, tabs in the centre, workspace actions on the right.

import { html } from 'htm/preact';
import { OpenRouterIsland } from '../../shared/components/OpenRouterIsland.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  theme, onToggleTheme, onHelp, view, onViewChange,
  appId, onSelectionChange,
  directoryName, onPickDirectory,
  busy, canGenerate, onGenerate, onCancel,
  onWanLibrary, onNewProject,
  recordingProps,
}) {
  const tab = (id, label, icon) => html`
    <button class=${`nav-tab ${view === id ? 'active' : ''}`} onClick=${() => onViewChange(id)}>
      <i class=${`fa-solid ${icon}`}></i> ${label}
    </button>`;

  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title"><i class="fa-solid fa-cube"></i> Understory Studio</span>
        <div class="toolbar-divider"></div>
        <!-- The island stays on every tab: Studio runs the build, and Projects
             and Runs are where you decide what to run next. Only the Generate
             button is Studio-only — Stop is shown wherever a run is live. -->
        <div class="us-island">
          <${OpenRouterIsland} appId=${appId} onSelectionChange=${onSelectionChange} />
          ${busy
            ? html`
              <button class="btn btn-danger" onClick=${onCancel} title="Stop the running build">
                <i class="fa-solid fa-stop"></i>
                <span class="btn-label">Stop</span>
              </button>`
            : view === 'studio' && html`
              <button class="btn btn-generate" onClick=${onGenerate} disabled=${!canGenerate}
                      title=${canGenerate ? 'Generate and review' : 'Add a reference picture and pick a model first'}>
                <i class="fa-solid fa-bolt"></i>
                <span class="btn-label">Generate</span>
              </button>`}
        </div>
      </div>

      <div class="toolbar-center">
        ${tab('projects', 'Projects', 'fa-folder-open')}
        ${tab('studio', 'Studio', 'fa-wand-magic-sparkles')}
        ${tab('runs', 'Runs', 'fa-clock-rotate-left')}
      </div>

      <div class="toolbar-right">
        <button class="btn" onClick=${onNewProject} disabled=${busy}
                title="Start a new project — clears the brief, the references and the viewport">
          <i class="fa-solid fa-plus"></i>
          <span class="btn-label">New project</span>
        </button>
        <div class="toolbar-divider"></div>
        <button class="btn" onClick=${onWanLibrary} disabled=${busy}
                title="Pick a reference from images WAN2GP has already generated">
          <i class="fa-solid fa-photo-film"></i>
          <span class="btn-label">WAN2GP</span>
        </button>
        <button class="btn" onClick=${onPickDirectory}
                title=${directoryName ? `Data root: ${directoryName} (click to change)` : 'Connect a folder to save your work'}>
          <i class=${`fa-solid ${directoryName ? 'fa-folder-open' : 'fa-folder-plus'}`}></i>
          <span class="btn-label">${directoryName || 'Connect folder'}</span>
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        <button class="btn-icon" onClick=${onHelp} title="Help">
          <i class="fa-solid fa-circle-question"></i>
        </button>
        <button class="btn-icon" onClick=${onToggleTheme}
                title=${`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>`;
}

import { html } from 'htm/preact';

/**
 * App toolbar. Shared chrome across start and morph views.
 * @param {Object} props
 * @param {string} props.title - shown between back button and controls
 * @param {string} props.backLabel - label for the left-side button
 * @param {Function} props.onBack - click handler for the left-side button
 * @param {any} props.providerSelector - the provider/model selector element to render
 * @param {string} props.theme - 'dark' | 'light'
 * @param {Function} props.onToggleTheme
 * @param {Function} [props.onFolderClick] - click handler for the folder button (optional)
 * @param {string} [props.folderName] - shown as tooltip on the folder button
 * @param {any} [props.rightExtras] - extra controls rendered at the far right (e.g. Stop button)
 */
export function Toolbar({
  title, backLabel, onBack, providerSelector, theme, onToggleTheme,
  onFolderClick, folderName, rightExtras, route,
  apiKeySet, onApiKeyClick, onProviderSettingsClick,
  onHelpClick,
}) {
  const isHubBack = backLabel === 'Hub';

  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Back to Hub">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title">
          <i class="fa-solid fa-dna"></i> ${title}
        </span>
        <div class="toolbar-divider"></div>
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${apiKeySet ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${apiKeySet ? 'API key configured (click to manage)' : 'Configure model providers'}
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
          ${providerSelector}
        </div>
      </div>

      <div class="toolbar-center">
        <button class=${`nav-tab ${route === 'start' ? 'active' : ''}`} onClick=${onBack} disabled=${isHubBack}>
          <i class="fa-solid fa-plus"></i> Start
        </button>
        <button class=${`nav-tab ${route === 'morph' ? 'active' : ''}`} disabled>
          <i class="fa-solid fa-code-compare"></i> Morph
        </button>
        ${rightExtras}
      </div>

      <div class="toolbar-right">
        ${onFolderClick && html`
          <button class="btn-icon" onClick=${onFolderClick} title=${folderName || 'Pick folder'}>
            <i class="fa-solid fa-folder"></i>
          </button>
        `}
        ${folderName && !onFolderClick && html`
          <span class="btn btn-directory" title=${folderName}>
            <i class="fa-solid fa-folder"></i> ${folderName}
          </span>
        `}
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

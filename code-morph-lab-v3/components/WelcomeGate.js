import { html } from 'htm/preact';

/**
 * Welcome gate shown when no filesystem root handle is set.
 * @param {Object} props
 * @param {Function} props.onPickFolder - async; opens directory picker and sets the handle
 * @param {boolean} props.pickerRunning
 * @param {Object|null} props.pendingHandoff - if a handoff is waiting in localStorage, pass the parsed payload
 * @param {string|null} props.error - last picker error message
 */
export function WelcomeGate({ onPickFolder, pickerRunning, pendingHandoff, error }) {
  return html`
    <div class="welcome-gate">
      <div class="welcome-card">
        <h1>Code Morph Lab</h1>
        <p class="welcome-lead">
          Code Morph Lab needs a folder to save your morph sessions.
        </p>
        ${pendingHandoff && html`
          <div class="welcome-pending">
            <i class="fa-solid fa-circle-info"></i>
            An import from <strong>${pendingHandoff.source}</strong> is waiting — pick a folder to continue.
          </div>
        `}
        <button class="btn btn-primary welcome-btn" onClick=${onPickFolder} disabled=${pickerRunning}>
          ${pickerRunning ? 'Choose a folder…' : 'Pick folder'}
        </button>
        ${error && html`<div class="welcome-error">${error}</div>`}
        <p class="welcome-note">
          The folder is shared across all apps in this suite. Sessions are saved under
          <code>${'<folder>/code-morph-lab-v3/'}</code>.
        </p>
      </div>
    </div>
  `;
}

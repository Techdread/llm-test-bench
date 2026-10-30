// Prompt-for-cell dialog used for both creating a new AI cell and replacing an existing cell's content.

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { hasBraveKey } from '../../shared/services/brave-search.js';
import { useDialogDismiss } from './useDialogDismiss.js';
import { availableKindOptions, isWebEdition } from '../services/edition.js';
import { AgentRunTrace } from '../../shared/components/CodingAgentRun.js';

const KINDS = [
  { value: 'md', label: 'Markdown' },
  { value: 'js', label: 'JavaScript' },
  { value: 'py', label: 'Python' },
  { value: 'c', label: 'C' },
  { value: 'rust', label: 'Rust' },
  { value: 'lua', label: 'Lua' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'scala', label: 'Scala' },
  { value: 'clojure', label: 'Clojure' },
  { value: 'html', label: 'HTML' },
  { value: 'ui', label: 'UI Controls' },
  { value: 'chart', label: 'Chart (Vega-Lite)' },
];

export function GenerateDialog({
  initialKind,
  initialPrompt,
  initialUseWebSearch,
  title,
  hasSavedPrompt,
  isModified,
  codeKind = '',
  onClose,
  onGenerate,
  onClearMetadata,
  busy,
  searchStatus,
  isAgent = false,
    agentRun,
}) {
  // The web edition has no search proxy (serve.py), so the option is not offered.
  const searchOffered = !isWebEdition();
  const braveAvailable = searchOffered && hasBraveKey();
  const [kind, setKind] = useState(initialKind || 'py');
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [useWebSearch, setUseWebSearch] = useState(!!initialUseWebSearch && braveAvailable);
  useDialogDismiss(onClose, { disabled: busy });
  return html`
    <div class="modal-overlay">
      <div class="modal generate-cell-modal" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-wand-magic-sparkles" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>${title || 'Generate Cell'}</h2>
          <button class="btn-icon" onClick=${onClose} disabled=${busy}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="gen-cell-form">
            <label>Cell kind
              <select value=${kind} onChange=${(e) => setKind(e.target.value)} disabled=${busy}>
                ${availableKindOptions(KINDS, 'value').map(k => html`<option value=${k.value}>${k.label}</option>`)}
              </select>
            </label>
            <label>Prompt
              <textarea value=${prompt} onInput=${(e) => setPrompt(e.target.value)}
                placeholder="e.g. plot sin and cos from -pi to pi with matplotlib" disabled=${busy} autoFocus></textarea>
            </label>
            ${hasSavedPrompt && html`
              <div class=${`ai-prompt-status ${isModified ? 'ai-prompt-modified' : ''}`}>
                <i class=${`fa-solid ${isModified ? 'fa-triangle-exclamation' : 'fa-wand-magic-sparkles'}`}></i>
                ${isModified
                  ? 'This cell has been edited since the prompt last generated it.'
                  : 'This prompt is saved with the cell.'}
              </div>
            `}
            ${codeKind && html`
              <div class="ai-prompt-status">
                <i class="fa-solid fa-pen-to-square"></i>
                ${kind === codeKind
                  ? 'The model sees what\'s in this cell, so you can ask for a change, like "make the bars green".'
                  : 'Changing the kind starts the cell from scratch: the model won\'t see what\'s in it now.'}
              </div>
            `}
            ${searchOffered && html`<div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', cursor: braveAvailable ? 'pointer' : 'not-allowed', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked=${useWebSearch}
                  onChange=${(e) => setUseWebSearch(e.target.checked)}
                  disabled=${!braveAvailable || busy}
                />
                <i class="fa-solid fa-globe" style=${{ color: useWebSearch && braveAvailable ? '#2563eb' : 'var(--text-muted)' }}></i>
                Search web for context
              </label>
              ${!braveAvailable && html`
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  (<a href="../settings/" style="color: var(--accent)">Set Brave API key</a>)
                </span>
              `}
              ${searchStatus && html`
                <span style=${{ fontSize: '12px', color: searchStatus === 'searching' ? 'var(--accent)' : searchStatus.startsWith('Found') ? 'var(--success, #22c55e)' : 'var(--text-muted)' }}>
                  ${searchStatus === 'searching' ? html`<i class="fa-solid fa-spinner fa-spin" style="margin-right:4px"></i>Searching…` : searchStatus}
                </span>
              `}
            </div>`}
            <${AgentRunTrace} run=${agentRun} />
          </div>
        </div>
        <div class="modal-footer gen-cell-footer">
          ${hasSavedPrompt && html`
            <button class="btn gen-cell-forget" onClick=${onClearMetadata} disabled=${busy}>
              <i class="fa-solid fa-link-slash"></i> Forget prompt
            </button>
          `}
          ${agentRun?.running
            ? html`
              <button class="btn" onClick=${agentRun.cancel} disabled=${agentRun.cancelling}>
                <i class="fa-solid fa-stop"></i> ${agentRun.cancelling ? 'Stopping…' : 'Stop'}
              </button>`
            : html`<button class="btn" onClick=${onClose} disabled=${busy}>Cancel</button>`}
          ${hasSavedPrompt && html`
            <button class="btn" onClick=${() => onGenerate({ kind, prompt, useWebSearch: useWebSearch && braveAvailable, target: 'copy' })} disabled=${busy || !prompt.trim()}>
              <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-copy'}`}></i> Generate copy
            </button>
          `}
          <button class="btn btn-primary" onClick=${() => onGenerate({ kind, prompt, useWebSearch: useWebSearch && braveAvailable, target: 'replace' })} disabled=${busy || !prompt.trim()}>
            <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : isAgent ? 'fa-terminal' : 'fa-bolt'}`}></i> ${busy ? 'Generating…' : hasSavedPrompt ? 'Replace cell' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  `;
}

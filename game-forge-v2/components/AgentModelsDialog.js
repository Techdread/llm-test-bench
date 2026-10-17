import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { parseModelList } from '../services/agentModelStore.js';

/**
 * Edit the model list offered for one agent. Pre-filled with the list in use
 * (the user's saved one, or the CLI-reported defaults). Saving stores it in the
 * data root; "Restore defaults" drops the override rather than deleting data.
 */
export function AgentModelsDialog({ agent, models, defaults, custom, onSave, onClose }) {
  const [text, setText] = useState((models || []).join('\n'));
  const list = parseModelList(text);
  const restore = () => { setText((defaults || []).join('\n')); };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal" onClick=${e => e.stopPropagation()}>
        <h2>${agent?.label || 'Agent'} models</h2>
        <p class="gf-hint">
          One model id per line — these fill the model picker for this agent.
          ${custom
            ? ' You are using your own list; Restore defaults drops it and goes back to what the CLI reports.'
            : ' This is the default list the bridge reports; edit it to add or remove ids.'}
        </p>
        <label>model ids
          <textarea rows="10" spellcheck="false" value=${text}
            onInput=${e => setText(e.target.value)}></textarea>
        </label>
        <div class="gf-modal-actions">
          <button class="gf-btn" onClick=${restore}><i class="fas fa-rotate-left"></i> Restore defaults</button>
          <button class="gf-btn" onClick=${onClose}>Cancel</button>
          <button class="gf-btn gf-primary" onClick=${() => onSave(list)}>
            <i class="fas fa-floppy-disk"></i> Save ${list.length} model${list.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>`;
}

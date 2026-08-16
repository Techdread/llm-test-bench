import { html } from 'htm/preact';

export function PromptComposer({
  prompt,
  onChange,
  onBrainstorm,
  onNearby,
  nearbySuggestions,
  nearbyBusy,
  onPickSuggestion,
  onDismissSuggestions,
}) {
  return html`
    <div class="prompt-section">
      <div class="section-header">
        <span><i class="fa-solid fa-comment-dots"></i> Prompt</span>
        <div class="section-header-actions">
          <button
            class="btn-icon"
            onClick=${onBrainstorm}
            title="Brainstorm prompt ideas (LLM)"
            style=${{ fontSize: '12px' }}
          >
            <i class="fa-solid fa-lightbulb"></i>
          </button>
          <button
            class="btn-icon"
            onClick=${onNearby}
            disabled=${!prompt?.trim() || nearbyBusy}
            title=${prompt?.trim() ? 'More like this prompt' : 'Type a prompt first'}
            style=${{ fontSize: '12px' }}
          >
            <i class=${`fa-solid ${nearbyBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
          </button>
        </div>
      </div>
      <textarea
        class="prompt-textarea"
        value=${prompt}
        onInput=${(e) => onChange(e.target.value)}
        placeholder="Describe the sketch — e.g. 'flocking arrows on a dark grid, react to mouse'..."
      ></textarea>
      ${(nearbySuggestions || []).length > 0 && html`
        <div class="suggestion-strip">
          <div class="suggestion-strip-header">
            <span class="muted small"><i class="fa-solid fa-wand-magic-sparkles"></i> More like this</span>
            <button class="btn-icon" onClick=${onDismissSuggestions} title="Dismiss" style=${{ fontSize: '10px' }}>
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="suggestion-chips">
            ${nearbySuggestions.map((s, i) => html`
              <button class="brainstorm-chip" key=${i} onClick=${() => onPickSuggestion(s)} title="Use this prompt">
                ${s}
              </button>
            `)}
          </div>
        </div>
      `}
    </div>
  `;
}

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// Shared brainstorm dialog. Used by any app that wants a "prompt ideas" modal.
//
// Props:
//   onRun(theme)            — kick off generation
//   onPick(suggestion)      — user clicked a chip
//   onClose()
//   busy                    — flag for spinner state
//   suggestions             — string[]
//   error                   — optional error message
//   title?                  — modal heading (default "Brainstorm prompts")
//   intro?                  — body intro paragraph (defaults to a generic one)
//   placeholder?            — theme input placeholder
//   icon?                   — Font Awesome icon class for the heading
export function BrainstormDialog({
  onRun,
  onPick,
  onClose,
  busy = false,
  suggestions = [],
  error = '',
  title = 'Brainstorm prompts',
  intro,
  placeholder = 'e.g. organic textures, retro arcade, escher tiling',
  icon = 'fa-lightbulb',
}) {
  const [theme, setTheme] = useState('');
  const handleRun = () => onRun(theme);

  const introText = intro || `Enter a theme — any flavour, mood, or constraint — and the model will pitch ten concrete prompt ideas. Click any chip to drop it into the prompt field.`;

  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '640px' }}>
        <div class="modal-header">
          <h2>
            <i class=${`fa-solid ${icon}`} style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>
            ${title}
          </h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <p style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: '0 0 8px' }}>
            ${introText}
          </p>
          <div class="form-group">
            <label>Theme (optional)</label>
            <input
              class="form-input"
              type="text"
              value=${theme}
              onInput=${(e) => setTheme(e.target.value)}
              onKeyDown=${(e) => e.key === 'Enter' && !busy && handleRun()}
              placeholder=${placeholder}
              autoFocus
            />
          </div>
          <div class="row">
            <button class="btn btn-generate" onClick=${handleRun} disabled=${busy}>
              <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>
              ${busy ? 'Brainstorming…' : 'Brainstorm'}
            </button>
            ${theme && html`
              <button class="btn" onClick=${() => setTheme('')} disabled=${busy} title="Clear theme">
                <i class="fa-solid fa-eraser"></i>
              </button>
            `}
          </div>

          ${error && html`<div class="json-err" style=${{ marginTop: '8px' }}>${error}</div>`}

          ${suggestions.length > 0 && html`
            <div class="brainstorm-list">
              ${suggestions.map((s, i) => html`
                <button class="brainstorm-chip" key=${i} onClick=${() => onPick(s)} title="Use this prompt">
                  ${s}
                </button>
              `)}
            </div>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `;
}

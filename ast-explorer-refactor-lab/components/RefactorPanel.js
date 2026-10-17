// Refactor panel — pick a recipe, optionally add an `extra` input (new name
// or function name), press Run. Shows the model's progress status and any
// validation errors before offering the diff.

import { html } from 'htm/preact';
import { useState, useMemo, useEffect } from 'preact/hooks';

const EXTRA_HINT = {
  'extract-function': 'New function name',
  'rename-symbol': 'New identifier',
};

export function RefactorPanel({
  recipes,
  selectedRecipeId,
  onSelectRecipe,
  selection,           // { text, range, lineCol } | null
  extra,
  onExtraChange,
  onRun,
  busy,
  status,              // { kind: 'info'|'error'|'success', message } | null
  streamingText,
  modelReady,
  language,
}) {
  const recipe = useMemo(() => recipes.find(r => r.id === selectedRecipeId), [recipes, selectedRecipeId]);

  // Reset the extra field when switching recipes so stale values don't leak.
  useEffect(() => { onExtraChange(''); /* eslint-disable-line */ }, [selectedRecipeId]);

  return html`
    <div class="refactor-body">
      ${(language === 'ts' || language === 'tsx') && html`
        <div class="ts-warning">
          TypeScript mode uses a syntactic parse only — no type checking. Refactors apply to the original source, so the LLM sees full TS syntax.
        </div>
      `}
      <div class="recipe-list">
        ${recipes.length === 0 && html`<div class="muted">No recipes apply to this language.</div>`}
        ${recipes.map(r => html`
          <div
            key=${r.id}
            class=${`recipe ${r.id === selectedRecipeId ? 'selected' : ''}`}
            onClick=${() => onSelectRecipe(r.id)}
          >
            <div class="recipe-label">
              ${r.label}
              <span class="recipe-langs">${r.supportedLangs.join(' · ')}</span>
            </div>
            <div class="recipe-desc">${r.description}</div>
          </div>
        `)}
      </div>

      ${recipe && EXTRA_HINT[recipe.id] && html`
        <div class="refactor-extra">
          <label>${EXTRA_HINT[recipe.id]}</label>
          <input
            type="text"
            value=${extra}
            placeholder=${EXTRA_HINT[recipe.id]}
            onInput=${(e) => onExtraChange(e.target.value)}
          />
        </div>
      `}

      <div class="refactor-extra">
        <label>Selection</label>
        ${selection && selection.text
          ? html`<span class="selection-chip">
              <i class="fa-solid fa-i-cursor"></i>
              ${selection.lineCol || `${selection.range[0]}–${selection.range[1]}`}
              · ${selection.text.length} chars
            </span>`
          : html`<span class="muted">(none — the whole file will be used)</span>`
        }
      </div>

      <div class="refactor-actions">
        <button
          class="btn btn-primary"
          disabled=${!recipe || busy || !modelReady}
          onClick=${onRun}
          title=${!modelReady ? 'Configure a model first' : ''}
        >
          ${busy
            ? html`<i class="fa-solid fa-spinner fa-spin"></i> Running…`
            : html`<span><i class="fa-solid fa-wand-magic-sparkles"></i> Run refactor</span>`
          }
        </button>
        ${recipe && html`
          <span class="muted">Guardrails: ${recipe.guardrails.join('; ')}</span>
        `}
      </div>

      ${status && html`
        <div class=${`refactor-status ${status.kind}`}>${status.message}</div>
      `}

      ${busy && streamingText && html`
        <p class="muted" style=${{ marginTop: 10, marginBottom: 4 }}>Streaming (${streamingText.length} chars)</p>
        <pre style=${{
          background: 'var(--bg-secondary)', padding: '8px', borderRadius: '4px',
          fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: '11px',
          maxHeight: '140px', overflow: 'auto', whiteSpace: 'pre-wrap',
        }}>${streamingText.slice(-1200)}</pre>
      `}
    </div>
  `;
}

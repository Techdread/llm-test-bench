// LLM Assistant: draft schema from a description, suggest SQL from a question,
// explain the current query. Each action produces editable SQL or prose that
// the user can accept into the editor or into the database.

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

const MODES = [
  { id: 'suggest', label: 'Suggest query', icon: 'fa-wand-magic-sparkles' },
  { id: 'schema', label: 'Draft schema', icon: 'fa-hammer' },
  { id: 'seed', label: 'Seed data', icon: 'fa-seedling' },
  { id: 'explain', label: 'Explain', icon: 'fa-book-open' },
];

export function AssistantPanel({
  schema, currentSql,
  busy, onSuggest, onDraftSchema, onDraftSeed, onExplain,
  onInsertToEditor, onRunSqlScript,
  disabled,
}) {
  const [mode, setMode] = useState('suggest');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [outputKind, setOutputKind] = useState('sql'); // 'sql' | 'text'
  const [rowsPerTable, setRowsPerTable] = useState(5);

  function handleRun() {
    if (disabled) return;
    if (mode === 'suggest') {
      if (!input.trim()) return;
      onSuggest?.(input.trim()).then(sql => { setOutput(sql); setOutputKind('sql'); });
    } else if (mode === 'schema') {
      if (!input.trim()) return;
      onDraftSchema?.(input.trim()).then(sql => { setOutput(sql); setOutputKind('sql'); });
    } else if (mode === 'seed') {
      onDraftSeed?.(rowsPerTable).then(sql => { setOutput(sql); setOutputKind('sql'); });
    } else if (mode === 'explain') {
      onExplain?.(currentSql || '').then(text => { setOutput(text); setOutputKind('text'); });
    }
  }

  const placeholder = {
    suggest: 'e.g. top 5 customers by total order value',
    schema: 'e.g. simple blog: users, posts, comments with likes',
    seed: '',
    explain: '',
  }[mode];

  return html`
    <div class="assistant-panel">
      <div class="assist-modes">
        ${MODES.map(m => html`
          <button key=${m.id}
                  class=${`assist-mode ${mode === m.id ? 'active' : ''}`}
                  onClick=${() => setMode(m.id)}>
            <i class=${`fa-solid ${m.icon}`}></i>
            ${m.label}
          </button>
        `)}
      </div>

      ${(mode === 'suggest' || mode === 'schema') && html`
        <textarea class="assist-input" rows="3"
                  placeholder=${placeholder}
                  value=${input}
                  onInput=${(e) => setInput(e.target.value)} />
      `}

      ${mode === 'seed' && html`
        <div class="assist-row">
          <label>Rows per table</label>
          <input type="number" min="1" max="100" value=${rowsPerTable}
                 onInput=${(e) => setRowsPerTable(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </div>
      `}

      ${mode === 'explain' && html`
        <div class="muted assist-hint">Uses the SQL currently in the editor.</div>
      `}

      <div class="assist-actions">
        <button class=${`btn btn-primary ${busy ? 'btn-running' : ''}`}
                onClick=${handleRun} disabled=${busy || disabled}>
          <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
          ${busy ? 'Generating…' : 'Generate'}
        </button>
        ${disabled && html`<span class="muted">Pick a model to enable the assistant.</span>`}
      </div>

      ${output && html`
        <div class="assist-output">
          <div class="assist-output-header">
            <span><i class="fa-solid fa-robot"></i> Output</span>
            ${outputKind === 'sql' && html`
              <div class="assist-output-actions">
                <button class="btn btn-sm" onClick=${() => onInsertToEditor?.(output)}>
                  <i class="fa-solid fa-right-to-bracket"></i> To editor
                </button>
                ${mode !== 'suggest' && html`
                  <button class="btn btn-sm btn-primary" onClick=${() => onRunSqlScript?.(output)}>
                    <i class="fa-solid fa-play"></i> Run
                  </button>
                `}
              </div>
            `}
          </div>
          <pre class=${outputKind === 'sql' ? 'assist-sql' : 'assist-prose'}>${output}</pre>
        </div>
      `}
    </div>
  `;
}

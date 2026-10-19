// Thin wrapper around shared CellEditor — preserves the {source, kind} prop
// names the notebook cells use and the .cell-editor-ace CSS hook.

import { html } from 'htm/preact';
import { CellEditor as SharedCellEditor } from '../../shared/components/CellEditor.js';

export function CellEditor({ source, onChange, kind, theme, onRun }) {
  return html`
    <${SharedCellEditor}
      value=${source}
      onChange=${onChange}
      kind=${kind}
      theme=${theme}
      onRun=${onRun}
      className="cell-editor-ace"
    />
  `;
}

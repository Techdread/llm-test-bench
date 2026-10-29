// Renders the ordered list of cells with "add between" buttons.

import { html } from 'htm/preact';
import { Cell } from './Cell.js';
import { availableKindOptions } from '../services/edition.js';
import { withHideCode } from '../services/codeVisibility.js';

const ADD_KINDS = [
  { kind: 'md', label: 'MD', icon: 'fa-font' },
  { kind: 'js', label: 'JS', icon: 'fa-code' },
  { kind: 'py', label: 'Py', icon: 'fa-brands fa-python' },
  { kind: 'c', label: 'C', icon: 'fa-code' },
  { kind: 'rust', label: 'Rust', icon: 'fa-code' },
  { kind: 'lua', label: 'Lua', icon: 'fa-moon' },
  { kind: 'java', label: 'Java', icon: 'fa-brands fa-java' },
  { kind: 'go', label: 'Go', icon: 'fa-code' },
  { kind: 'scala', label: 'Scala', icon: 'fa-code' },
  { kind: 'clojure', label: 'Clojure', icon: 'fa-code' },
  { kind: 'html', label: 'HTML', icon: 'fa-code' },
  { kind: 'ui', label: 'UI', icon: 'fa-sliders' },
  { kind: 'chart', label: 'Chart', icon: 'fa-chart-simple' },
];

function AddCellRow({ onAdd }) {
  return html`
    <div class="add-cell-row">
      ${availableKindOptions(ADD_KINDS).map(k => html`
        <button class="add-cell-btn" onClick=${() => onAdd(k.kind)}>
          <i class=${`fa-solid ${k.icon}`}></i> + ${k.label}
        </button>
      `)}
    </div>
  `;
}

export function CellList({
  cells,
  runningCellId,
  fixingCellId,
  theme,
  onInsertAt,
  onUpdateCell,
  onRunCell,
  onDeleteCell,
  onDuplicateCell,
  onMoveCell,
  onClearOutput,
  onExplainCell,
  onAiGenerate,
  onAiFix,
  uiFormSelection,
  onSelectUiControl,
}) {
  return html`
    <div class="cell-list">
      <${AddCellRow} onAdd=${(k) => onInsertAt(0, k)} />
      ${cells.map((cell, i) => html`
        <${Cell}
          key=${cell.id}
          cell=${cell}
          index=${i}
          total=${cells.length}
          theme=${theme}
          isRunning=${runningCellId === cell.id}
          isFixing=${fixingCellId === cell.id}
          aiFixBusy=${!!fixingCellId}
          onSourceChange=${(src) => onUpdateCell(cell.id, { source: src })}
          onKindChange=${(kind) => onUpdateCell(cell.id, { kind, outputs: [], error: null, outputCleared: false })}
          onRun=${() => onRunCell(cell.id)}
          onClearOutput=${() => onClearOutput(cell.id)}
          onDelete=${() => onDeleteCell(cell.id)}
          onDuplicate=${() => onDuplicateCell(cell.id)}
          onMoveUp=${() => onMoveCell(cell.id, -1)}
          onMoveDown=${() => onMoveCell(cell.id, 1)}
          onExplain=${() => onExplainCell(cell.id)}
          onAiGenerate=${() => onAiGenerate(cell.id)}
          onAiFix=${() => onAiFix(cell.id)}
          onHtmlPreviewChange=${(preview) => onUpdateCell(cell.id, {
            metadata: {
              ...(cell.metadata || {}),
              htmlPreview: preview,
            },
          })}
          onHideCodeChange=${(hidden) => onUpdateCell(cell.id, { metadata: withHideCode(cell, hidden) })}
          selectedUiControlIndex=${uiFormSelection?.cellId === cell.id ? uiFormSelection.controlIndex : -1}
          onSelectUiControl=${(controlIndex) => onSelectUiControl(cell.id, controlIndex)}
        />
        <${AddCellRow} onAdd=${(k) => onInsertAt(i + 1, k)} />
      `)}
    </div>
  `;
}

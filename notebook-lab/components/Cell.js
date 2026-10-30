// A single notebook cell. Shows a header with kind/actions and either an editor
// or a rendered markdown view, plus outputs.

import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CellEditor } from './CellEditor.js';
import { OutputRenderer } from './OutputRenderer.js';
import { UiCellRenderer } from './UiCellRenderer.js';
import { isCellModifiedSinceAi } from '../services/cellMetadata.js';
import { cellRepairDiagnostic } from '../services/cellRepair.js';
import { kindAvailable } from '../services/edition.js';
import { canHideCode, savedHideCode } from '../services/codeVisibility.js';

let markedLoadPromise = null;
let markedMod = null;
async function ensureMarked() {
  if (markedMod) return markedMod;
  if (!markedLoadPromise) {
    markedLoadPromise = import('../../shared/lib/marked/12/index.mjs');
  }
  markedMod = await markedLoadPromise;
  return markedMod;
}

const KIND_OPTIONS = [
  ['md', 'Markdown'], ['js', 'JavaScript'], ['py', 'Python'], ['c', 'C'], ['rust', 'Rust'],
  ['lua', 'Lua'], ['sql', 'SQL'], ['java', 'Java'], ['go', 'Go'], ['scala', 'Scala'], ['clojure', 'Clojure'],
  ['html', 'HTML'], ['ui', 'UI Controls'], ['chart', 'Chart (Vega)'],
];

const KIND_LABELS = {
  md: 'Markdown',
  js: 'JavaScript',
  py: 'Python',
  c: 'C',
  rust: 'Rust',
  lua: 'Lua',
  sql: 'SQL',
  java: 'Java',
  go: 'Go',
  scala: 'Scala',
  clojure: 'Clojure',
  html: 'HTML',
  ui: 'UI',
  chart: 'Chart',
};

function isValidJsonSource(source) {
  if (!source?.trim()) return true;
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

// A short one-line summary shown when a cell is folded, so the reader can still
// tell what's hidden without expanding it.
function collapsedPreview(cell) {
  if (cell.kind === 'ui') {
    try {
      const n = (JSON.parse(cell.source || '{}').controls || []).length;
      return `UI cell · ${n} control${n === 1 ? '' : 's'}`;
    } catch {
      return 'UI cell';
    }
  }
  const firstLine = (cell.source || '')
    .split('\n')
    .map(s => s.trim())
    .find(s => s.length) || '(empty)';
  return firstLine.length > 100 ? firstLine.slice(0, 100) + '…' : firstLine;
}

export function Cell({
  cell,
  index,
  total,
  theme,
  isRunning,
  isFixing,
  aiFixBusy,
  onSourceChange,
  onKindChange,
  onRun,
  onClearOutput,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onExplain,
  onAiGenerate,
  onAiFix,
  onHtmlPreviewChange,
  onHideCodeChange,
  selectedUiControlIndex,
  onSelectUiControl,
}) {
  const [mdEditing, setMdEditing] = useState(!cell.source);
  const [collapsed, setCollapsed] = useState(false);
  const [codeCollapsed, setCodeCollapsed] = useState(() => savedHideCode(cell) === true);
  const [uiRawEditing, setUiRawEditing] = useState(false);
  // Start in input mode: design mode turns a drag on a control into a move,
  // so a slider would shift around instead of changing its value.
  const [uiDesignerMode, setUiDesignerMode] = useState(false);
  const [renderedMd, setRenderedMd] = useState('');
  const aiMetadata = cell.metadata?.ai || null;
  const aiModified = isCellModifiedSinceAi(cell);
  const repairError = cellRepairDiagnostic(cell);

  useEffect(() => {
    if (cell.kind !== 'md') return;
    (async () => {
      const { marked } = await ensureMarked();
      setRenderedMd(marked.parse(cell.source || ''));
    })();
  }, [cell.kind, cell.source]);

  useEffect(() => {
    if (cell.kind !== 'ui') {
      setUiRawEditing(false);
      setUiDesignerMode(true);
    }
  }, [cell.kind]);

  const canRun = cell.kind === 'js' || cell.kind === 'py' || cell.kind === 'c' || cell.kind === 'rust' || cell.kind === 'lua' || cell.kind === 'sql' || cell.kind === 'java' || cell.kind === 'go' || cell.kind === 'scala' || cell.kind === 'clojure' || cell.kind === 'md';
  // Cells that keep a separate output can hide the source editor while leaving
  // the result on screen — offered for the visual kinds and for JS/Python
  // (which often draw to a canvas or return a chart).
  const canCollapseCode = canHideCode(cell.kind);
  // Only the always-visual kinds auto-hide their code after a clean run.
  const autoCollapseCode = cell.kind === 'html' || cell.kind === 'chart';

  // A manual code-fold toggle is saved on the cell (and honoured by exports),
  // and stops the auto-collapse after a run from overriding the user's choice.
  const userToggledCode = useRef(savedHideCode(cell) !== undefined);
  const setCodeCollapsedByUser = (value) => {
    userToggledCode.current = true;
    setCodeCollapsed(value);
    onHideCodeChange?.(value);
  };
  // A notebook reopened with the same cell ids keeps this component, so follow
  // the saved choice when it changes underneath us.
  const savedChoice = savedHideCode(cell);
  useEffect(() => {
    if (savedChoice === undefined) return;
    userToggledCode.current = true;
    setCodeCollapsed(savedChoice);
  }, [savedChoice]);

  // After a run finishes cleanly, collapse a visual cell's code so the output
  // leads — unless the user has taken manual control of this cell's fold.
  const wasRunning = useRef(false);
  useEffect(() => {
    const finished = wasRunning.current && !isRunning;
    wasRunning.current = isRunning;
    if (finished && autoCollapseCode && !userToggledCode.current && !cell.error) {
      setCodeCollapsed(true);
    }
  }, [isRunning]);
  const showMarkdownRender = cell.kind === 'md' && !mdEditing;
  const showUiRender = cell.kind === 'ui' && (uiRawEditing || isValidJsonSource(cell.source));

  return html`
    <div class=${`cell cell-${cell.kind} ${isRunning ? 'cell-running' : ''}`}>
      <div class="cell-header">
        <div class="cell-header-left">
          <button
            class="btn-icon cell-fold-btn"
            title=${collapsed ? 'Expand cell' : 'Collapse cell'}
            aria-expanded=${!collapsed}
            onClick=${() => setCollapsed(v => !v)}
          >
            <i class=${`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
          </button>
          <span class="cell-index">[${index + 1}]</span>
          <select
            class="cell-kind-select"
            value=${cell.kind}
            onChange=${(e) => onKindChange(e.target.value)}
            title="Cell kind"
          >
            ${KIND_OPTIONS.filter(([value]) => value === cell.kind || kindAvailable(value)).map(([value, label]) => html`
              <option value=${value}>${label}</option>
            `)}
          </select>
          <span class=${`cell-kind-badge kind-${cell.kind}`}>${KIND_LABELS[cell.kind] || cell.kind}</span>
          ${isRunning && html`<span class="cell-executing-indicator"><i class="fa-solid fa-spinner fa-spin"></i> running…</span>`}
        </div>
        <div class="cell-header-right">
          ${cell.kind === 'ui' && html`
            ${!uiRawEditing && html`
              <button
                class=${`btn-icon ${uiDesignerMode ? 'active' : ''}`}
                title=${uiDesignerMode ? 'Switch to input mode' : 'Switch to design mode'}
                onClick=${() => setUiDesignerMode(v => !v)}
              >
                <i class=${`fa-solid ${uiDesignerMode ? 'fa-pen-ruler' : 'fa-keyboard'}`}></i>
              </button>
            `}
            <button
              class="btn-icon"
              title=${uiRawEditing ? 'Show visual form' : 'Edit raw JSON'}
              onClick=${() => setUiRawEditing(v => !v)}
            >
              <i class=${`fa-solid ${uiRawEditing ? 'fa-object-group' : 'fa-code'}`}></i>
            </button>
          `}
          ${canCollapseCode && html`
            <button
              class=${`btn-icon ${codeCollapsed ? 'active' : ''}`}
              title=${codeCollapsed ? 'Show code' : 'Hide code, keep the output (saved with the notebook; exports fold it away)'}
              onClick=${() => setCodeCollapsedByUser(!codeCollapsed)}
            >
              <i class="fa-solid fa-code"></i>
            </button>
          `}
          ${canRun && html`
            <button class="btn-icon" title="Run (Shift+Enter or Ctrl/Cmd+Enter)" disabled=${isRunning || isFixing} onClick=${onRun}>
              <i class="fa-solid fa-play"></i>
            </button>
          `}
          <button
            class=${`btn-icon cell-fix-button ${repairError ? 'has-error' : ''} ${isFixing ? 'is-fixing' : ''}`}
            title=${isFixing
              ? 'Fixing this cell with the selected AI…'
              : repairError
                ? 'Fix this error with the selected AI'
                : 'Run the cell to capture an error before using AI Fix'}
            aria-label=${isFixing ? 'Fixing cell with AI' : 'Fix cell with AI'}
            disabled=${!repairError || isRunning || aiFixBusy}
            onClick=${onAiFix}
          >
            <i class=${`fa-solid ${isFixing ? 'fa-spinner fa-spin' : 'fa-screwdriver-wrench'}`}></i>
          </button>
          <button
            class=${`btn-icon cell-ai-button ${aiMetadata ? 'has-ai-metadata' : ''} ${aiModified ? 'ai-source-modified' : ''}`}
            title=${aiMetadata
              ? aiModified
                ? 'Edit saved AI prompt (cell edited since generation)'
                : 'Edit saved AI prompt'
              : 'AI generate into this cell'}
            disabled=${aiFixBusy}
            onClick=${onAiGenerate}
          >
            <i class="fa-solid fa-wand-magic-sparkles"></i>
          </button>
          <button class="btn-icon" title="Explain this cell" disabled=${aiFixBusy} onClick=${onExplain}>
            <i class="fa-solid fa-comment-dots"></i>
          </button>
          <button class="btn-icon" title="Clear output" onClick=${onClearOutput}>
            <i class="fa-solid fa-eraser"></i>
          </button>
          <button class="btn-icon" title="Duplicate" onClick=${onDuplicate}>
            <i class="fa-solid fa-clone"></i>
          </button>
          <button class="btn-icon" title="Move up" disabled=${index === 0} onClick=${onMoveUp}>
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="btn-icon" title="Move down" disabled=${index === total - 1} onClick=${onMoveDown}>
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="btn-icon" title="Delete" onClick=${onDelete}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      ${collapsed ? html`
        <div
          class="cell-collapsed-preview"
          title="Click to expand"
          onClick=${() => setCollapsed(false)}
        >
          <i class="fa-solid fa-ellipsis"></i>
          <span class="cell-collapsed-text">${collapsedPreview(cell)}</span>
        </div>
      ` : html`
      ${showMarkdownRender ? html`
        <div class="cell-md-rendered" onDblClick=${() => setMdEditing(true)} dangerouslySetInnerHTML=${{ __html: renderedMd }}></div>
      ` : cell.kind === 'ui' && !uiRawEditing ? null : (canCollapseCode && codeCollapsed) ? html`
        <div
          class="cell-code-collapsed"
          title="Show code"
          onClick=${() => setCodeCollapsedByUser(false)}
        >
          <i class="fa-solid fa-code"></i>
          <span>code hidden — showing output only</span>
        </div>
      ` : html`
        ${cell.kind === 'ui' && uiRawEditing && html`
          <div class="ui-raw-toolbar">
            <button class="btn btn-small" onClick=${() => setUiRawEditing(false)}>
              <i class="fa-solid fa-sliders"></i> Form editor
            </button>
          </div>
        `}
        <div class="cell-editor">
          <${CellEditor}
            source=${cell.source}
            onChange=${onSourceChange}
            kind=${cell.kind}
            theme=${theme}
            onRun=${() => { if (cell.kind === 'md') setMdEditing(false); else onRun(); }}
          />
        </div>
      `}

      ${showUiRender && !uiRawEditing && html`
        <${UiCellRenderer}
          source=${cell.source}
          designer=${uiDesignerMode}
          selectedIndex=${selectedUiControlIndex}
          onSelectControl=${uiDesignerMode ? onSelectUiControl : undefined}
          onDefinitionChange=${uiDesignerMode ? onSourceChange : undefined}
        />
      `}

      <${OutputRenderer}
        outputs=${cell.outputs}
        error=${cell.error}
        hidden=${cell.outputCleared}
        kind=${cell.kind}
        source=${cell.source}
        metadata=${cell.metadata}
        onHtmlPreviewChange=${onHtmlPreviewChange}
      />

      ${cell.kind === 'md' && !mdEditing && html`
        <div class="cell-md-hint">
          <span class="hint-mouse">Double-click to edit</span><span class="hint-touch">Double-tap to edit</span>
        </div>
      `}
      ${cell.kind === 'md' && mdEditing && html`
        <div style="padding:4px 12px; display:flex; justify-content:flex-end;">
          <button class="btn btn-small" onClick=${() => setMdEditing(false)}>
            <i class="fa-solid fa-check"></i> Done
          </button>
        </div>
      `}
      `}
    </div>
  `;
}

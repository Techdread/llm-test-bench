// Sidebar showing the current nb.* variables.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import * as nbBridge from '../services/nbBridge.js';
import { UiFormPanel } from './UiCellFormEditor.js';

function formatValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch {
    return String(v);
  }
}

export function VariablesPanel({
  activeTab,
  onTabChange,
  uiCell,
  uiControlIndex,
  onUpdateCell,
  onSelectUiControl,
}) {
  const [vars, setVars] = useState({});
  useEffect(() => {
    return nbBridge.subscribe(setVars);
  }, []);
  const entries = Object.entries(vars);
  return html`
    <aside class="variables-panel">
      <div class="variables-panel-header">
        <div class="side-panel-tabs">
          <button class=${activeTab === 'variables' ? 'active' : ''} onClick=${() => onTabChange('variables')}>
            <i class="fa-solid fa-flask"></i> Variables
          </button>
          <button class=${activeTab === 'form' ? 'active' : ''} onClick=${() => onTabChange('form')}>
            <i class="fa-solid fa-sliders"></i> Form Editor
          </button>
        </div>
        ${activeTab === 'variables' && html`
          <button
            class="btn-icon"
            title="Clear all variables"
            onClick=${() => nbBridge.clear()}
            style=${{ fontSize: '11px' }}
          >
            <i class="fa-solid fa-broom"></i>
          </button>
        `}
      </div>
      ${activeTab === 'variables'
        ? html`
            <div class="variables-list">
              ${entries.length === 0
                ? html`<div class="variables-empty">No variables yet.<br/>Set values with <code>nb.set(k,v)</code> (JS) or <code>nb["k"]=v</code> (Python).</div>`
                : entries.map(([k, v]) => html`
                    <div class="variable-item" key=${k}>
                      <span class="variable-name">${k}</span>
                      <span class="variable-value">${formatValue(v)}</span>
                    </div>
                  `)
              }
            </div>
          `
        : html`
            <${UiFormPanel}
              cell=${uiCell}
              selectedIndex=${uiControlIndex}
              onChange=${onUpdateCell}
              onSelectControl=${onSelectUiControl}
            />
          `
      }
    </aside>
  `;
}

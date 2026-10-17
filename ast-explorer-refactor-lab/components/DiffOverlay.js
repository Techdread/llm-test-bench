// Diff overlay — fixed-bottom panel showing unified hunks of old → new with
// per-hunk accept/reject toggles and Apply / Cancel actions.

import { html } from 'htm/preact';
import { useMemo } from 'preact/hooks';
import { summariseHunks } from '../services/diffEngine.js';

export function DiffOverlay({ hunks, rationale, onToggleHunk, onAcceptAll, onRejectAll, onApply, onCancel, parseOk }) {
  const summary = useMemo(() => summariseHunks(hunks), [hunks]);
  const anyAccepted = hunks.some(h => h.accepted);

  return html`
    <div class="diff-overlay">
      <div class="diff-header">
        <h3><i class="fa-solid fa-code-branch"></i> Proposed refactor</h3>
        <span class="muted">
          ${summary.count} hunk${summary.count === 1 ? '' : 's'} ·
          <span style=${{ color: 'var(--success)' }}>+${summary.add}</span>
          <span style=${{ color: 'var(--danger)' }}> −${summary.del}</span>
        </span>
        ${!parseOk && html`<span class="refactor-status error" style=${{ margin: 0, padding: '2px 8px' }}>
          <i class="fa-solid fa-triangle-exclamation"></i> new source does not parse — applying will leave broken code
        </span>`}
        <div class="spacer"></div>
        <button class="btn btn-small" onClick=${onAcceptAll}>Accept all</button>
        <button class="btn btn-small" onClick=${onRejectAll}>Reject all</button>
        <button class="btn btn-small" onClick=${onCancel}>Cancel</button>
        <button class="btn btn-primary" disabled=${!anyAccepted} onClick=${onApply}>
          <i class="fa-solid fa-check"></i> Apply
        </button>
      </div>
      ${rationale && html`<div class="rationale-box">${rationale}</div>`}
      <div class="diff-body">
        ${hunks.length === 0 && html`<div class="muted" style=${{ padding: 20 }}>No differences.</div>`}
        ${hunks.map(h => html`
          <div key=${h.id} class=${`diff-hunk ${h.accepted ? 'accepted' : 'rejected'}`}>
            <div class="diff-hunk-head">
              <span class="monospace">@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@</span>
              <span class="spacer"></span>
              <label style=${{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked=${h.accepted}
                  onChange=${() => onToggleHunk(h.id)}
                />
                ${h.accepted ? 'Accepted' : 'Rejected'}
              </label>
            </div>
            ${h.lines.map((l, i) => html`
              <div key=${i} class=${`diff-line ${l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : ''}`}>
                <span class="marker">${l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                <span>${l.text}</span>
              </div>
            `)}
          </div>
        `)}
      </div>
    </div>
  `;
}

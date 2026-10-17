import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { diffProjects } from '../services/projectWorkbench.js';

export function ProjectDiffDialog({ left, right, onClose }) {
  const [diff, setDiff] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    diffProjects(left.projectHandle, right.projectHandle).then(value => {
      setDiff(value);
      setSelected(value.files.find(file => file.status !== 'unchanged') || value.files[0] || null);
    }).catch(cause => setError(cause.message));
    return () => removeEventListener('keydown', onKey);
  }, [left.projectHandle, right.projectHandle]);

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-project-diff" onClick=${event => event.stopPropagation()}>
        <div class="gf-workbench-head">
          <div>
            <h2><i class="fas fa-code-compare"></i> Project diff</h2>
            <div class="gf-muted">${left.runId} ↔ ${right.runId}</div>
          </div>
          <button class="gf-icon-btn" onClick=${onClose}><i class="fas fa-xmark"></i></button>
        </div>
        ${diff && html`
          <div class="gf-diff-summary">
            <span class="added">+${diff.counts.added} added</span>
            <span class="removed">−${diff.counts.removed} removed</span>
            <span class="modified">~${diff.counts.modified} modified</span>
            <span>${diff.counts.unchanged} unchanged</span>
          </div>
          <div class="gf-diff-body">
            <div class="gf-diff-files">
              ${diff.files.map(file => html`
                <button class=${`gf-project-file ${file.status} ${selected?.path === file.path ? 'active' : ''}`}
                  onClick=${() => setSelected(file)}>
                  <span class="gf-diff-mark">${mark(file.status)}</span><span>${file.path}</span>
                </button>`)}
            </div>
            <div class="gf-diff-sources">
              <div><b>${left.runId}</b><pre>${sourceText(selected?.left)}</pre></div>
              <div><b>${right.runId}</b><pre>${sourceText(selected?.right)}</pre></div>
            </div>
          </div>`}
        ${!diff && !error && html`<div class="gf-preview-msg"><i class="fas fa-spinner fa-spin"></i> Comparing projects…</div>`}
        ${error && html`<div class="gf-preview-msg gf-err">${error}</div>`}
        <div class="gf-modal-actions"><button class="gf-btn" onClick=${onClose}>Close</button></div>
      </div>
    </div>`;
}

function mark(status) {
  return ({ added: '+', removed: '−', modified: '~', unchanged: '=' })[status] || '?';
}

function sourceText(record) {
  if (!record) return '(file does not exist in this run)';
  if (record.text == null) return `(binary or large file · ${record.size} bytes)`;
  return record.text;
}

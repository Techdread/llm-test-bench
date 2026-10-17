import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  downloadProjectZip, isTextPath, openProjectInCodeMorphLab, projectManifest, readProjectText,
} from '../services/projectWorkbench.js';

export function ProjectBrowserDialog({ projectHandle, title, runId, onClose }) {
  const [manifest, setManifest] = useState(null);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    projectManifest(projectHandle).then(value => {
      setManifest(value);
      const first = value.files.find(file => file.path === 'index.html')
        || value.files.find(file => isTextPath(file.path))
        || value.files[0];
      if (first) openFile(first.path);
    }).catch(error => setMessage(error.message));
    return () => removeEventListener('keydown', onKey);
  }, [projectHandle]);

  const openFile = async path => {
    setSelected(path);
    setContent({ loading: true });
    try { setContent(await readProjectText(projectHandle, path)); }
    catch (error) { setContent({ error: error.message }); }
  };

  const download = async () => {
    setBusy(true); setMessage('');
    try {
      const safe = String(title || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const result = await downloadProjectZip(projectHandle, `${safe || 'project'}-${runId}.zip`);
      setMessage(`Exported ${result.filename} (${Math.round(result.bytes / 1024)} KB)`);
    } catch (error) {
      setMessage(`Export failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const openEditor = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await openProjectInCodeMorphLab(projectHandle, {
        title: `${title} · ${runId}`,
        prompt: 'Inspect this saved Game Forge project. Preserve its working mechanics and make focused, reviewable changes.',
      });
      setMessage(`Sent ${result.files} text files to Code Morph Lab V3.`);
    } catch (error) {
      setMessage(`Editor handoff failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-project-browser" onClick=${event => event.stopPropagation()}>
        <div class="gf-workbench-head">
          <div>
            <h2><i class="fas fa-folder-tree"></i> Project files</h2>
            <div class="gf-muted">${title} · ${runId}${manifest ? ` · ${manifest.fileCount} files · ${(manifest.totalBytes / 1024).toFixed(1)} KB` : ''}</div>
          </div>
          <button class="gf-icon-btn" title="Close" onClick=${onClose}><i class="fas fa-xmark"></i></button>
        </div>
        <div class="gf-project-browser-body">
          <div class="gf-project-tree">
            ${(manifest?.files || []).map(file => html`
              <button class=${`gf-project-file ${selected === file.path ? 'active' : ''}`}
                onClick=${() => openFile(file.path)}>
                <i class=${`fas ${isTextPath(file.path) ? 'fa-file-code' : 'fa-file'}`}></i>
                <span>${file.path}</span>
                <small>${formatBytes(file.size)}</small>
              </button>`)}
          </div>
          <div class="gf-project-source">
            <div class="gf-project-source-head">${selected || 'Select a file'}</div>
            ${content?.loading && html`<div class="gf-preview-msg"><i class="fas fa-spinner fa-spin"></i> Reading…</div>`}
            ${content?.error && html`<div class="gf-preview-msg gf-err">${content.error}</div>`}
            ${content?.binary && html`<div class="gf-preview-msg">Binary file · ${formatBytes(content.size)} · ${content.type || 'unknown type'}</div>`}
            ${content?.tooLarge && html`<div class="gf-preview-msg">Text file is too large to display · ${formatBytes(content.size)}</div>`}
            ${content?.text != null && html`<pre>${content.text}</pre>`}
          </div>
        </div>
        ${message && html`<div class="gf-muted">${message}</div>`}
        <div class="gf-modal-actions gf-workbench-actions">
          <button class="gf-btn" disabled=${busy} onClick=${openEditor}
            title="Send a portable text snapshot to the suite's multi-file Code Morph Lab V3 editor">
            <i class="fas fa-pen-to-square"></i> Open in local editor
          </button>
          <button class="gf-btn gf-primary" disabled=${busy} onClick=${download}>
            <i class=${`fas ${busy ? 'fa-spinner fa-spin' : 'fa-file-zipper'}`}></i> Download ZIP
          </button>
          <button class="gf-btn" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

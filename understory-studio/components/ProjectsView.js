import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { MAX_NAME } from '../services/projectStore.js';

const KIND_ICONS = { object: 'fa-cube', character: 'fa-person', scene: 'fa-mountain-sun' };

export function ProjectsView({
  projects, loading, rootConnected, onOpen, onNew, onDelete, onRename, onPickDirectory,
}) {
  // Which card is being renamed, and the text so far. Editing in place rather
  // than in a dialog keeps the rest of the card — versions, model, date —
  // visible while you decide what to call it.
  const [renaming, setRenaming] = useState('');
  const [draftName, setDraftName] = useState('');

  const beginRename = project => { setRenaming(project.id); setDraftName(project.name); };
  const cancelRename = () => { setRenaming(''); setDraftName(''); };
  const commitRename = async (project) => {
    const next = draftName.trim();
    cancelRename();
    if (next && next !== project.name) await onRename(project, next);
  };
  // The two branches are keyed apart on purpose. Both roots are a
  // `div.us-projects`, so without distinct keys preact diffs one into the other
  // when the data-root check resolves after mount — and children of the branch
  // that lost (its <h2>, for instance) survive into the branch that won.
  if (!rootConnected) {
    return html`
      <div class="us-projects" key="disconnected">
        <h2>Projects</h2>
        <p class="us-note">
          Connect a data root to save projects, reference images, versions and model exchanges.
          Without one you can still generate and export — nothing is kept when the tab closes.
        </p>
        <div class="us-card-actions">
          <button class="us-btn us-primary" onClick=${onPickDirectory}>
            <i class="fas fa-folder-open"></i> Connect data root
          </button>
          <button class="us-btn" onClick=${onNew}>
            <i class="fas fa-plus"></i> Start without saving
          </button>
        </div>
      </div>`;
  }

  return html`
    <div class="us-projects" key="connected">
      <div class="us-projects-head">
        <h2>Projects</h2>
        <button class="us-btn us-primary" onClick=${onNew}>
          <i class="fas fa-plus"></i> New project
        </button>
      </div>
      ${loading && html`<p class="us-note">Reading the data root…</p>`}
      ${!loading && projects.length === 0 && html`
        <p class="us-note">No saved projects yet. Start one, add a reference picture, and generate.</p>`}
      <div class="us-project-grid">
        ${projects.map(project => html`
          <div class="us-card" key=${project.id}>
            ${renaming === project.id
              ? html`
                <div class="us-rename">
                  <input type="text" value=${draftName} maxLength=${MAX_NAME} autofocus
                         aria-label="Project name"
                         onInput=${e => setDraftName(e.target.value)}
                         onKeyDown=${e => {
                           if (e.key === 'Enter') commitRename(project);
                           if (e.key === 'Escape') { e.stopPropagation(); cancelRename(); }
                         }} />
                  <button class="us-btn us-btn-sm us-primary" title="Save name"
                          disabled=${!draftName.trim()}
                          onClick=${() => commitRename(project)}>
                    <i class="fas fa-check"></i>
                  </button>
                  <button class="us-btn us-btn-sm" title="Cancel" onClick=${cancelRename}>
                    <i class="fas fa-xmark"></i>
                  </button>
                </div>`
              : html`
                <h4>
                  <i class=${`fas ${KIND_ICONS[project.kind] || 'fa-cube'}`}></i>
                  <span class="us-card-name">${project.name}</span>
                  <button class="us-icon-link" title="Rename" aria-label=${`Rename ${project.name}`}
                          onClick=${() => beginRename(project)}>
                    <i class="fas fa-pen"></i>
                  </button>
                </h4>`}
            <div class="us-card-meta">
              <span class="us-chip">${project.versions} version${project.versions === 1 ? '' : 's'}</span>
              ${project.rigging !== 'none' && html`
                <span class="us-chip">${project.rigging === 'animated' ? 'Animated' : 'T-pose'}</span>`}
              ${project.versions > 0 && html`
                <span class="us-chip">${project.approved ? 'Reviewed' : 'Needs refinement'}</span>`}
            </div>
            <div class="us-card-meta">
              ${project.model || 'Model not recorded'}
            </div>
            <div class="us-card-meta">
              ${project.updated ? new Date(project.updated).toLocaleString() : ''}
            </div>
            <div class="us-card-actions">
              <button class="us-btn us-btn-sm us-primary" onClick=${() => onOpen(project.id)}>Open</button>
              <button class="us-btn us-btn-sm" title="Move to deleted — the files are kept"
                      onClick=${() => onDelete(project)}>Delete</button>
            </div>
          </div>`)}
      </div>
      <p class="us-note" style="margin-top:14px">
        Deleting moves a project aside in the data root rather than erasing it, so a mis-click costs nothing.
      </p>
    </div>`;
}

import { html } from 'htm/preact';
import {
  PROJECT_LIBRARIES,
  PROJECT_LIBRARY_GROUPS,
  clearProjectLibraryGroup,
  normalizeLibraryIds,
  projectLibrariesForDomain,
  selectProjectLibrary,
} from '../services/projectLibraries.js';

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function ProjectLibraryPicker({
  value = [],
  onChange,
  domain = '',
  targetStack = 'web',
}) {
  const selected = normalizeLibraryIds(value);
  const disabled = String(targetStack || 'web').toLowerCase() !== 'web';
  const available = projectLibrariesForDomain(domain);

  return html`
    <div class="forge-library-picker" aria-disabled=${disabled}>
      <div class="forge-library-picker__intro">
        <strong>Project libraries</strong>
        <span>Copied into every generated project and integrity-checked. No CDN or Hub-relative dependency.</span>
      </div>

      ${disabled && html`
        <div class="forge-library-picker__notice">
          Project libraries are available for web projects. This target uses its language standard library.
        </div>`}

      ${PROJECT_LIBRARY_GROUPS.map(group => {
        const choices = available.filter(item => item.group === group.id);
        if (!choices.length) return null;
        const current = choices.find(item => selected.includes(item.id));
        const name = `forge-library-${domain || 'project'}-${group.id}`;
        // A group that allows several (spec 343's data/docs group) is a set of
        // checkboxes with no "None" row: nothing ticked already means none.
        if (group.multiple) {
          return html`
            <fieldset class="forge-library-picker__group" disabled=${disabled}>
              <legend>${group.label}</legend>
              <p>${group.description}</p>
              ${choices.map(item => html`
                <label class=${`forge-library-choice ${selected.includes(item.id) ? 'is-selected' : ''}`}>
                  <input type="checkbox" checked=${selected.includes(item.id)}
                    onChange=${() => onChange?.(selectProjectLibrary(selected, item.id))} />
                  <span class="forge-library-choice__body">
                    <span class="forge-library-choice__title"><strong>${item.label}</strong></span>
                    <small>${item.description}</small>
                    <small>${formatBytes(item.approxBytes)} · ${item.files.length} pinned ${item.files.length === 1 ? 'file' : 'files'}${item.globalName ? ` · global ${item.globalName}` : ''}</small>
                  </span>
                </label>`)}
            </fieldset>`;
        }
        return html`
          <fieldset class="forge-library-picker__group" disabled=${disabled}>
            <legend>${group.label}</legend>
            <p>${group.description}</p>
            <label class=${`forge-library-choice ${!current ? 'is-selected' : ''}`}>
              <input type="radio" name=${name} checked=${!current}
                onChange=${() => onChange?.(clearProjectLibraryGroup(selected, group.id))} />
              <span class="forge-library-choice__body">
                <strong>${group.id === 'engine' ? 'Vanilla Canvas / none' : 'None'}</strong>
                <small>No provisioned ${group.label.toLowerCase()} dependency.</small>
              </span>
            </label>
            ${choices.map(item => html`
              <label class=${`forge-library-choice ${selected.includes(item.id) ? 'is-selected' : ''}`}>
                <input type="radio" name=${name} checked=${selected.includes(item.id)}
                  onChange=${() => onChange?.(selectProjectLibrary(selected, item.id))} />
                <span class="forge-library-choice__body">
                  <span class="forge-library-choice__title">
                    <strong>${item.label}</strong>
                    ${item.entry.type === 'module' && html`<em>module</em>`}
                    ${item.approxBytes >= 5 * 1024 * 1024 && html`<em>large</em>`}
                  </span>
                  <small>${item.description}</small>
                  <small>${formatBytes(item.approxBytes)} · ${item.files.length} pinned ${item.files.length === 1 ? 'file' : 'files'}${item.globalName ? ` · global ${item.globalName}` : ''}</small>
                </span>
              </label>`)}
          </fieldset>`;
      })}
    </div>`;
}

export function ProjectLibraryBadges({ value = [] }) {
  return normalizeLibraryIds(value).map(id => {
    const item = PROJECT_LIBRARIES[id];
    return html`
      <span class="gf-era gf-lib" key=${id}
        title=${`${item.label} is copied into the generated project`}>
        <i class="fas fa-cube"></i> ${item.label}
      </span>`;
  });
}

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TARGET_ENVIRONMENTS } from '../services/bundleContract.js';
import { exportGameForgeBundle } from '../services/bundleExport.js';

export function PortDialog({ gameSlug, run, onClose }) {
  const [environment, setEnvironment] = useState('godot');
  const target = useMemo(
    () => TARGET_ENVIRONMENTS.find(item => item.id === environment) || TARGET_ENVIRONMENTS[0],
    [environment],
  );
  const [version, setVersion] = useState('');
  const [language, setLanguage] = useState(target.defaultLanguage);
  const [platforms, setPlatforms] = useState(target.defaultPlatforms);
  const [notes, setNotes] = useState('');
  const [requirements, setRequirements] = useState({
    preserveMechanics: true,
    preservePresentation: true,
    adaptControls: true,
    offlineAssets: true,
    buildAndRun: true,
  });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape' && !busy) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [busy]);

  const selectEnvironment = id => {
    const next = TARGET_ENVIRONMENTS.find(item => item.id === id) || TARGET_ENVIRONMENTS[0];
    setEnvironment(next.id);
    setLanguage(next.defaultLanguage);
    setPlatforms([...next.defaultPlatforms]);
    setVersion('');
  };

  const togglePlatform = platform => {
    setPlatforms(current => current.includes(platform)
      ? current.filter(item => item !== platform)
      : [...current, platform]);
  };

  const toggleRequirement = key => setRequirements(current => ({ ...current, [key]: !current[key] }));

  const download = async withPort => {
    if (withPort && !platforms.length) {
      setMessage('Choose at least one target platform.');
      return;
    }
    setBusy(withPort ? 'port' : 'bundle');
    setMessage('');
    try {
      const result = await exportGameForgeBundle({
        projectHandle: run.projectHandle,
        runDir: run.runDir,
        meta: run.meta || {},
        gameSlug,
        runId: run.runId,
        portRequestInput: withPort ? {
          target: { environment, version, language, platforms }, requirements, notes,
        } : null,
      });
      setMessage(`Saved append-only ${withPort ? 'port handoff' : 'source bundle'} ${result.exportId} and downloaded ${result.filename} (${Math.round(result.bytes / 1024)} KB).`);
    } catch (error) {
      setMessage(`Bundle failed: ${error.message}`);
    } finally {
      setBusy('');
    }
  };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-port-dialog" onClick=${event => event.stopPropagation()}>
        <div class="gf-workbench-head">
          <div>
            <h2><i class="fas fa-box-open"></i> Bundle & port</h2>
            <div class="gf-muted">${run.meta?.gameTitle || run.meta?.taskTitle || gameSlug} · ${run.runId}</div>
          </div>
          <button class="gf-icon-btn" disabled=${!!busy} title="Close" onClick=${onClose}><i class="fas fa-xmark"></i></button>
        </div>

        <div class="gf-contract-note">
          <i class="fas fa-file-shield"></i>
          <div><strong>The bundle is the contract.</strong><span>Game Forge packages source, intent, validation, provenance and acceptance evidence. A strong agent performs the port inside the selected target environment.</span></div>
        </div>

        <div class="gf-port-targets">
          ${TARGET_ENVIRONMENTS.map(item => html`
            <button class=${`gf-port-target ${environment === item.id ? 'active' : ''}`}
              onClick=${() => selectEnvironment(item.id)}>
              <i class=${`fas ${item.icon}`}></i><span>${item.title}</span><small>${item.kind}</small>
            </button>`)}
        </div>

        <div class="gf-port-grid">
          <label>Target version
            <input value=${version} onInput=${event => setVersion(event.target.value)}
              placeholder=${environment === 'godot' ? 'e.g. 4.x' : environment === 'unity' ? 'e.g. Unity 6' : 'Use installed/current'} />
          </label>
          <label>Language
            <select value=${language} onChange=${event => setLanguage(event.target.value)}>
              ${target.languages.map(item => html`<option value=${item}>${item}</option>`)}
            </select>
          </label>
          <fieldset class="gf-port-platforms">
            <legend>Target platforms</legend>
            ${target.platforms.map(platform => html`
              <label><input type="checkbox" checked=${platforms.includes(platform)}
                onChange=${() => togglePlatform(platform)} /> ${platform}</label>`)}
          </fieldset>
          <fieldset class="gf-port-requirements">
            <legend>Port contract</legend>
            ${[
              ['preserveMechanics', 'Preserve mechanics'],
              ['preservePresentation', 'Preserve presentation'],
              ['adaptControls', 'Adapt controls'],
              ['offlineAssets', 'Keep assets offline'],
              ['buildAndRun', 'Build and run in target'],
            ].map(([key, label]) => html`
              <label><input type="checkbox" checked=${requirements[key]}
                onChange=${() => toggleRequirement(key)} /> ${label}</label>`)}
          </fieldset>
          <label class="gf-field-wide">Agent notes
            <textarea rows="4" value=${notes} onInput=${event => setNotes(event.target.value)}
              placeholder="Target-specific priorities, devices, renderer, orientation, store constraints…"></textarea>
          </label>
        </div>

        <details class="gf-bundle-layout">
          <summary>Bundle contents</summary>
          <code>bundle.json</code>
          <code>source/</code>
          <code>design/brief.json</code>
          <code>design/game-spec.json</code>
          <code>evidence/</code>
          <code>handoff/acceptance.json</code>
          <code>integrity.json</code>
          <code>handoff/AGENT.md (port handoff)</code>
        </details>

        ${message && html`<div class="gf-library-message">${message}</div>`}
        <div class="gf-modal-actions gf-workbench-actions">
          <button class="gf-btn" disabled=${!!busy} onClick=${() => download(false)}>
            <i class=${`fas ${busy === 'bundle' ? 'fa-spinner fa-spin' : 'fa-box-archive'}`}></i> Source bundle
          </button>
          <button class="gf-btn gf-primary" disabled=${!!busy || !platforms.length} onClick=${() => download(true)}>
            <i class=${`fas ${busy === 'port' ? 'fa-spinner fa-spin' : 'fa-share-from-square'}`}></i> Port handoff bundle
          </button>
          <button class="gf-btn" disabled=${!!busy} onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>`;
}

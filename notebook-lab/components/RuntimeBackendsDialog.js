// Runtime backends settings — picks which runner executes each language cell
// (e.g. Python: Pyodide WASM vs real CPython in the Debian/v86 guest).
// State lives in shared/services/runtime-backends.js (localStorage-backed).

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  BACKENDS,
  getBackend,
  setBackend,
  subscribe,
} from '../../shared/services/runtime-backends.js';
import { useDialogDismiss } from './useDialogDismiss.js';
import { formatBytes } from '../services/runtimeSessions.js';
import {
  PYODIDE_VERSION,
  clearPackageCache,
  getPackageCacheStatus,
  prefetchCommonPackages,
  setAutoDownloadPackages,
  verifyPackageCache,
} from '../services/pyodidePackageCache.js';

const LANG_META = {
  py:   { title: 'Python',  icon: 'fa-brands fa-python', cellKind: 'py' },
  rust: { title: 'Rust',    icon: 'fa-solid fa-gear',    cellKind: 'rust' },
  c:    { title: 'C / C++', icon: 'fa-solid fa-code',    cellKind: 'c' },
  scala:{ title: 'Scala',   icon: 'fa-solid fa-code',    cellKind: 'scala' },
};

export function RuntimeBackendsDialog({ onClose, monitor, onHardReset, onHardResetAll }) {
  // Mirror the store so radio selection reflects (and persists) immediately.
  const [snap, setSnap] = useState(() => {
    const out = {};
    for (const lang of Object.keys(BACKENDS)) out[lang] = getBackend(lang);
    return out;
  });
  const [sessions, setSessions] = useState([]);
  const [packageCache, setPackageCache] = useState(null);
  const [packageBusy, setPackageBusy] = useState('');
  const [packageNotice, setPackageNotice] = useState('');

  useEffect(() => subscribe(setSnap), []);
  useEffect(() => monitor?.subscribe(setSessions), [monitor]);
  useEffect(() => {
    let active = true;
    getPackageCacheStatus()
      .then((status) => active && setPackageCache(status))
      .catch((error) => active && setPackageNotice(error.message));
    return () => { active = false; };
  }, []);
  useDialogDismiss(onClose);

  const reloadPackageStatus = async () => {
    const status = await getPackageCacheStatus();
    setPackageCache(status);
    return status;
  };

  const runPackageAction = async (label, action) => {
    setPackageBusy(label);
    setPackageNotice('');
    try {
      const result = await action((message) => setPackageNotice(message));
      await reloadPackageStatus();
      return result;
    } catch (error) {
      setPackageNotice(error?.message || String(error));
      return null;
    } finally {
      setPackageBusy('');
    }
  };

  const cacheCommonPackages = async (force) => {
    const result = await runPackageAction(force ? 'refresh' : 'download', (onStatus) =>
      prefetchCommonPackages({ force, onStatus }));
    if (result) {
      setPackageNotice(
        force
          ? `Refreshed ${result.downloaded} package artifacts.`
          : `Cached ${result.downloaded}; ${result.reused} already current.`,
      );
    }
  };

  const verifyPackages = async () => {
    const result = await runPackageAction('verify', (onStatus) => verifyPackageCache({ onStatus }));
    if (result) {
      setPackageNotice(result.invalid.length
        ? `${result.invalid.length} of ${result.checked} artifacts failed verification. Refresh the cache to replace them.`
        : `Verified ${result.checked} cached package artifacts.`);
    }
  };

  const clearPackages = async () => {
    if (!window.confirm('Delete the cached Pyodide package artifacts for this runtime version?')) return;
    const result = await runPackageAction('clear', () => clearPackageCache());
    if (result !== null) {
      setPackageNotice('Package cache deleted. Already-loaded packages remain in memory until a hard reset.');
    }
  };

  return html`
    <div class="modal-overlay">
      <div class="modal runtime-center" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '780px' }}>
        <div class="modal-header">
          <h2>
            <i class="fa-solid fa-gears" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>
            Runtime Center
          </h2>
          <button class="btn-icon" onClick=${onClose}><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="rt-section-head">
            <div>
              <h3>Open Notebook Lab tabs</h3>
              <p>Each row is a separate browser tab and a separate JavaScript heap.</p>
            </div>
            <button class="btn btn-small" onClick=${() => monitor?.refresh()} title="Ask other Notebook Lab tabs to report their current notebook">
              <i class="fa-solid fa-rotate"></i> Refresh
            </button>
          </div>
          <div class="rt-sessions">
            ${sessions.length === 0
              ? html`<div class="rt-session-empty">Waiting for runtime status…</div>`
              : sessions.map(session => html`<${RuntimeSession} key=${session.sessionId} session=${session} />`)}
          </div>
          <div class="rt-reset-note">
            <i class="fa-solid fa-memory"></i>
            <span>
              <strong>Hard reset</strong> starts this tab with a blank notebook and reloads the page,
              which releases charts, HTML frames, Pyodide and the Debian VM. Saved notebook files are not deleted.
            </span>
          </div>
          <div class="rt-reset-actions">
            <button class="btn" onClick=${onHardReset}>
              <i class="fa-solid fa-power-off"></i> Hard reset this tab
            </button>
            ${sessions.length > 1 && html`
              <button class="btn btn-danger" onClick=${onHardResetAll}>
                <i class="fa-solid fa-triangle-exclamation"></i> Reset all ${sessions.length} tabs
              </button>
            `}
          </div>

          <div class="rt-section-divider"></div>
          <div class="rt-section-head">
            <div>
              <h3>Python package cache</h3>
              <p>Pyodide ${PYODIDE_VERSION} · exact packages verified against its bundled lockfile</p>
            </div>
            <label class="rt-cache-toggle">
              <input
                type="checkbox"
                checked=${packageCache?.autoDownload !== false}
                onChange=${async (event) => {
                  setAutoDownloadPackages(event.currentTarget.checked);
                  await reloadPackageStatus();
                }}
              />
              Auto-download imports
            </label>
          </div>
          <div class="rt-package-cache">
            <div class="rt-cache-summary">
              <i class="fa-solid fa-box-archive"></i>
              <span>
                ${packageCache == null
                  ? 'Reading cache…'
                  : packageCache.configured
                    ? html`<strong>${packageCache.count}</strong> artifacts · <strong>${formatBytes(packageCache.bytes)}</strong><br />
                        <small>notebook-lab/cache/pyodide/${PYODIDE_VERSION}/packages</small>`
                    : html`Choose a <strong>Data Root</strong> in Hub Settings to make downloaded packages portable.`}
              </span>
            </div>
            <p>
              When a cell imports a locked Pyodide package such as pandas, Matplotlib, or SciPy,
              Notebook Lab checks the app bundle, then this data-root cache, then downloads the
              exact matching artifact. Notebook source is not modified.
            </p>
            <div class="rt-cache-actions">
              <button class="btn btn-small" disabled=${!!packageBusy || packageCache?.configured === false} onClick=${() => cacheCommonPackages(false)}>
                <i class="fa-solid fa-download"></i> Download common stack
              </button>
              <button class="btn btn-small" disabled=${!!packageBusy || packageCache?.configured === false} onClick=${verifyPackages}>
                <i class="fa-solid fa-shield-halved"></i> Verify
              </button>
              <button class="btn btn-small" disabled=${!!packageBusy || packageCache?.configured === false} onClick=${() => cacheCommonPackages(true)}>
                <i class="fa-solid fa-arrows-rotate"></i> Refresh
              </button>
              <button class="btn btn-small btn-danger" disabled=${!!packageBusy || !packageCache?.count} onClick=${clearPackages}>
                <i class="fa-solid fa-trash"></i> Delete cache
              </button>
            </div>
            ${packageNotice && html`
              <div class=${`rt-cache-notice ${packageBusy ? 'is-busy' : ''}`}>
                ${packageBusy && html`<i class="fa-solid fa-spinner fa-spin"></i>`}
                ${packageNotice}
              </div>
            `}
          </div>

          <div class="rt-section-divider"></div>
          <p style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginTop: 0 }}>
            Some languages can run in more than one place. Pick the backend you want for each —
            the choice applies to every cell of that kind and is remembered across sessions.
          </p>
          ${Object.keys(BACKENDS).map((lang) => html`
            <${BackendGroup}
              key=${lang}
              lang=${lang}
              meta=${LANG_META[lang]}
              selected=${snap[lang]}
              onSelect=${(id) => setBackend(lang, id)}
            />
          `)}
          <div class="rt-note">
            <i class="fa-solid fa-circle-info"></i>
            <span>
              Debian backends share <strong>one</strong> v86 guest. The first cell that needs it
              boots Debian (~30 s); every other Debian-backed language reuses the same VM
              instantly after that.
            </span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onClick=${onClose}>
            <i class="fa-solid fa-check"></i> Done
          </button>
        </div>
      </div>
      <style>${STYLES}</style>
    </div>
  `;
}

function RuntimeSession({ session }) {
  const runtime = session.runtimes || {};
  return html`
    <div class=${`rt-session ${session.current ? 'rt-session-current' : ''}`}>
      <div class="rt-session-main">
        <div class="rt-session-title">
          <i class="fa-solid fa-book-open"></i>
          <strong>${session.title || 'Untitled Notebook'}</strong>
          ${session.current && html`<span class="rt-current-badge">this tab</span>`}
        </div>
        <div class="rt-session-id">${session.notebookId || 'Unsaved notebook'}</div>
      </div>
      <div class="rt-session-stats">
        <span title="Notebook cells"><b>${session.cells || 0}</b> cells</span>
        <span title="Shared nb variables"><b>${session.variables || 0}</b> vars</span>
        <span title="Saved cell output objects"><b>${session.outputs || 0}</b> outputs</span>
        <span title="Approximate serialized size of variables and outputs"><b>${formatBytes(session.retainedBytes)}</b> data</span>
        ${session.heapBytes != null && html`<span title="Browser-reported JavaScript heap for this tab"><b>${formatBytes(session.heapBytes)}</b> heap</span>`}
      </div>
      <div class="rt-session-runtimes">
        <span class=${runtime.pyodide === 'ready' ? 'loaded' : ''}>Pyodide: ${runtime.pyodide || 'cold'}</span>
        <span class=${runtime.debian !== 'cold' ? 'loaded' : ''}>Debian VM: ${runtime.debian || 'cold'}</span>
        <span class=${runtime.vegaViews ? 'loaded' : ''}>Vega views: ${runtime.vegaViews || 0}</span>
        <span>HTML frames: ${session.htmlFrames || 0}</span>
      </div>
    </div>
  `;
}

function BackendGroup({ lang, meta, selected, onSelect }) {
  const cfg = BACKENDS[lang];
  return html`
    <div class="rt-group">
      <div class="rt-group-head">
        <i class=${meta.icon}></i>
        <span class="rt-lang">${meta.title}</span>
        <span class="rt-cell-kind">cell kind: <code>${meta.cellKind}</code></span>
      </div>
      <div class="rt-options">
        ${cfg.options.map((opt) => html`
          <label class=${`rt-option ${selected === opt.id ? 'rt-option-active' : ''}`} key=${opt.id}>
            <input
              type="radio"
              name=${`backend-${lang}`}
              value=${opt.id}
              checked=${selected === opt.id}
              onChange=${() => onSelect(opt.id)}
            />
            <div class="rt-option-body">
              <div class="rt-option-label">${opt.label}</div>
              <div class="rt-option-desc">${opt.desc}</div>
            </div>
          </label>
        `)}
      </div>
    </div>
  `;
}

const STYLES = `
.runtime-center .modal-body { max-height: min(76vh, 780px); }
.rt-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.rt-section-head h3 { margin: 0; font-size: 15px; }
.rt-section-head p { margin: 3px 0 0; color: var(--text-secondary, #94a3b8); font-size: 12px; }
.rt-sessions { display: grid; gap: 8px; margin: 10px 0; }
.rt-session-empty { padding: 18px; text-align: center; color: var(--text-secondary, #94a3b8); border: 1px dashed var(--border-color, #334155); border-radius: 8px; }
.rt-session { padding: 10px 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--bg-primary, #0f172a); }
.rt-session-current { border-color: color-mix(in srgb, var(--accent) 60%, var(--border-color)); box-shadow: inset 3px 0 0 var(--accent); }
.rt-session-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rt-session-title { min-width: 0; display: flex; align-items: center; gap: 7px; }
.rt-session-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-session-title i { color: var(--accent, #38bdf8); }
.rt-current-badge { flex: none; padding: 2px 6px; border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.rt-session-id { flex: none; color: var(--text-secondary, #94a3b8); font: 11px var(--font-mono, monospace); }
.rt-session-stats, .rt-session-runtimes { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; color: var(--text-secondary, #94a3b8); font-size: 11px; }
.rt-session-stats b { color: var(--text-primary, #f8fafc); }
.rt-session-runtimes span { padding: 2px 6px; border-radius: 4px; background: rgba(148,163,184,.09); }
.rt-session-runtimes .loaded { color: #22c55e; background: rgba(34,197,94,.10); }
.rt-reset-note { display: flex; gap: 9px; padding: 9px 11px; color: var(--text-secondary, #94a3b8); background: color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent); border: 1px solid color-mix(in srgb, var(--warning, #f59e0b) 28%, var(--border-color)); border-radius: 7px; font-size: 12px; line-height: 1.45; }
.rt-reset-note i { color: var(--warning, #f59e0b); margin-top: 2px; }
.rt-reset-actions { display: flex; gap: 8px; margin-top: 9px; }
.rt-section-divider { height: 1px; margin: 18px 0; background: var(--border-color, #334155); }
.rt-cache-toggle { display: flex; align-items: center; gap: 7px; color: var(--text-secondary, #94a3b8); font-size: 12px; white-space: nowrap; cursor: pointer; }
.rt-package-cache { margin-top: 10px; padding: 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--bg-primary, #0f172a); }
.rt-package-cache > p { margin: 9px 0; color: var(--text-secondary, #94a3b8); font-size: 12px; line-height: 1.5; }
.rt-cache-summary { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.rt-cache-summary > i { color: var(--accent, #38bdf8); font-size: 18px; }
.rt-cache-summary small { color: var(--text-secondary, #94a3b8); font-family: var(--font-mono, monospace); }
.rt-cache-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.rt-cache-notice { margin-top: 9px; padding: 7px 9px; border-radius: 6px; color: var(--text-secondary, #94a3b8); background: rgba(148,163,184,.09); font-size: 11px; overflow-wrap: anywhere; }
.rt-cache-notice.is-busy { color: var(--accent, #38bdf8); }
.rt-cache-notice i { margin-right: 6px; }
.rt-group { margin: 14px 0; padding: 10px; border: 1px solid var(--border, #334155); border-radius: 8px; }
.rt-group-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-weight: 600; }
.rt-group-head i { color: var(--accent, #38bdf8); }
.rt-cell-kind { margin-left: auto; font-weight: normal; font-size: 12px; color: var(--text-muted, #94a3b8); }
.rt-cell-kind code { padding: 1px 5px; background: rgba(148,163,184,0.15); border-radius: 4px; }
.rt-options { display: grid; gap: 6px; }
.rt-option { display: flex; gap: 10px; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; align-items: flex-start; }
.rt-option:hover { background: rgba(148,163,184,0.08); }
.rt-option-active { background: rgba(56,189,248,0.10); border-color: rgba(56,189,248,0.45); }
.rt-option input[type=radio] { margin-top: 3px; flex-shrink: 0; }
.rt-option-label { font-weight: 600; font-size: 13px; }
.rt-option-desc { font-size: 12px; color: var(--text-secondary, #cbd5e1); margin-top: 2px; line-height: 1.4; }
.rt-note { margin-top: 14px; padding: 10px 12px; background: rgba(148,163,184,0.10); border-left: 3px solid var(--accent, #38bdf8); border-radius: 4px; font-size: 12px; line-height: 1.5; display: flex; gap: 10px; align-items: flex-start; }
.rt-note i { color: var(--accent, #38bdf8); margin-top: 2px; flex-shrink: 0; }
`;

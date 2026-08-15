// ProviderSettingsDialog — shared Preact component
// Two modes:
//   - Global (no appId): edits provider config (URL, API key, add/remove). Used in /settings/.
//   - Per-app (appId set): only toggles which providers are visible in this app's
//     model picker. URL/API-key/add/remove controls are hidden — those remain global.
//     Per-app toggle state is stored at prefs(appId).disabledProviders (array of IDs).

import { html } from 'htm/preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import * as providers from '../services/model-providers.js';
import { getApiKey, saveApiKey, hasApiKey } from '../services/providers-openrouter.js';
import { createProvider as createLmStudioProvider } from '../services/providers-lmstudio.js';
import {
  createProvider as createUnslothStudioProvider,
  getApiKey as getUnslothStudioApiKey,
  saveApiKey as saveUnslothStudioApiKey,
} from '../services/providers-unsloth-studio.js';
import { prefs as readPrefs, setPref as setAppPref } from '../services/app-prefs.js';

const LOCAL_PROVIDER_META = {
  lmstudio: {
    title: 'LM Studio',
    pluralTitle: 'LM Studio Endpoints',
    icon: 'fa-network-wired',
    defaultName: 'LM Studio',
    defaultUrl: 'http://localhost:1234',
    placeholderName: 'LM Studio Main',
    placeholderUrl: 'http://192.168.1.20:1234',
    emptyText: 'No LM Studio endpoints configured',
    needsKey: false,
    create: createLmStudioProvider,
  },
  'unsloth-studio': {
    title: 'Unsloth Studio',
    pluralTitle: 'Unsloth Studio Endpoints',
    icon: 'fa-bolt',
    defaultName: 'Unsloth Studio',
    defaultUrl: 'http://127.0.0.1:8888',
    placeholderName: 'Unsloth DiffusionGemma',
    placeholderUrl: 'http://127.0.0.1:8888',
    emptyText: 'No Unsloth Studio endpoints configured',
    needsKey: true,
    create: createUnslothStudioProvider,
  },
};

function localProviderMeta(type) {
  return LOCAL_PROVIDER_META[type] || LOCAL_PROVIDER_META.lmstudio;
}

export function ProviderSettingsDialog({ onClose, onProvidersChanged, appId }) {
  const isPerApp = !!appId;
  const [providerList, setProviderList] = useState(() => providers.getProviders());
  const [disabledForApp, setDisabledForApp] = useState(() => {
    if (!isPerApp) return [];
    const snap = readPrefs(appId, { defaults: { disabledProviders: [] } });
    return Array.isArray(snap.disabledProviders) ? snap.disabledProviders : [];
  });
  const [apiKey, setApiKey] = useState(() => getApiKey());
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState('lmstudio');
  const [newApiKey, setNewApiKey] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newTimeout, setNewTimeout] = useState('30000');
  const [editingId, setEditingId] = useState(null);

  const reload = useCallback(() => {
    setProviderList(providers.getProviders());
    if (onProvidersChanged) onProvidersChanged();
  }, [onProvidersChanged]);

  // ── OpenRouter API Key ──
  const handleSaveApiKey = useCallback(() => {
    saveApiKey(apiKey.trim());
    reload();
  }, [apiKey, reload]);

  const handleRemoveApiKey = useCallback(() => {
    saveApiKey('');
    setApiKey('');
    reload();
  }, [reload]);

  // ── Test connection ──
  const handleTest = useCallback(async (provider) => {
    setTesting(t => ({ ...t, [provider.id]: true }));
    setTestResults(r => ({ ...r, [provider.id]: null }));
    try {
      const result = await providers.testConnection(provider);
      setTestResults(r => ({ ...r, [provider.id]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [provider.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [provider.id]: false }));
    }
  }, []);

  // Auto-test enabled providers on mount to show health status
  useEffect(() => {
    for (const p of providerList) {
      if (p.enabled !== false && !testResults[p.id] && !testing[p.id]) {
        handleTest(p);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle enable/disable ──
  // Global mode: flips provider.enabled in the registry (affects every app).
  // Per-app mode: adds/removes the provider id from prefs(appId).disabledProviders.
  const handleToggle = useCallback((id) => {
    if (isPerApp) {
      setDisabledForApp(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
        setAppPref(appId, 'disabledProviders', next).catch(e => {
          console.warn(`[ProviderSettingsDialog] saving disabledProviders for ${appId} failed:`, e);
        });
        if (onProvidersChanged) onProvidersChanged();
        return next;
      });
      return;
    }
    const p = providerList.find(x => x.id === id);
    if (!p) return;
    providers.updateProvider(id, { enabled: !p.enabled });
    reload();
  }, [isPerApp, appId, providerList, reload, onProvidersChanged]);

  const isProviderOnForApp = useCallback((p) => {
    if (!p) return false;
    if (isPerApp) {
      // In per-app mode, only providers globally enabled count; the per-app
      // list further opts them out.
      return p.enabled !== false && !disabledForApp.includes(p.id);
    }
    return p.enabled !== false;
  }, [isPerApp, disabledForApp]);

  // ── Remove provider ──
  const handleRemove = useCallback((id) => {
    if (id === 'openrouter') return; // Can't remove OpenRouter
    providers.removeProvider(id);
    reload();
  }, [reload]);

  const resetEndpointForm = useCallback(() => {
    setShowAddForm(false);
    setNewName('');
    setNewUrl('');
    setNewApiKey('');
    setNewTags('');
    setNewTimeout('30000');
  }, []);

  const startAddEndpoint = useCallback((type) => {
    const meta = localProviderMeta(type);
    setEditingId(null);
    setNewType(type);
    setNewName(meta.defaultName);
    setNewUrl(meta.defaultUrl);
    setNewApiKey('');
    setNewTags('');
    setNewTimeout('30000');
    setShowAddForm(true);
  }, []);

  // ── Add local endpoint ──
  const handleAdd = useCallback(() => {
    if (!newUrl.trim()) return;
    const meta = localProviderMeta(newType);
    const tags = newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const provider = meta.create({
      name: newName.trim() || meta.defaultName,
      baseUrl: newUrl.trim(),
      tags,
      timeoutMs: parseInt(newTimeout) || 30000,
    });
    try {
      providers.addProvider(provider);
      if (meta.needsKey) saveUnslothStudioApiKey(provider, newApiKey);
      resetEndpointForm();
      reload();
    } catch (e) {
      alert(e.message);
    }
  }, [newType, newName, newUrl, newApiKey, newTags, newTimeout, resetEndpointForm, reload]);

  // ── Edit local endpoint ──
  const handleStartEdit = useCallback((provider) => {
    if (provider.type === 'openrouter') return;
    const meta = localProviderMeta(provider.type);
    setEditingId(provider.id);
    setNewType(provider.type);
    setNewName(provider.name || '');
    setNewUrl(provider.baseUrl || '');
    setNewApiKey(meta.needsKey ? getUnslothStudioApiKey(provider) : '');
    setNewTags((provider.tags || []).join(', '));
    setNewTimeout(String(provider.timeoutMs || 30000));
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !newUrl.trim()) return;
    const current = providerList.find(p => p.id === editingId);
    const meta = localProviderMeta(current?.type || newType);
    const tags = newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    providers.updateProvider(editingId, {
      name: newName.trim() || meta.defaultName,
      baseUrl: newUrl.trim(),
      tags,
      timeoutMs: parseInt(newTimeout) || 30000,
    });
    if (meta.needsKey) saveUnslothStudioApiKey(editingId, newApiKey);
    resetEndpointForm();
    setEditingId(null);
    reload();
  }, [editingId, providerList, newType, newName, newUrl, newApiKey, newTags, newTimeout, resetEndpointForm, reload]);

  const handleCancelEdit = useCallback(() => {
    resetEndpointForm();
    setEditingId(null);
  }, [resetEndpointForm]);

  // ── Refresh models ──
  const handleRefreshModels = useCallback(async (provider) => {
    setTesting(t => ({ ...t, [`refresh-${provider.id}`]: true }));
    try {
      await providers.refreshProviderModels(provider.id);
      setTestResults(r => ({ ...r, [provider.id]: { ok: true, refreshed: true } }));
    } catch (e) {
      setTestResults(r => ({ ...r, [provider.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [`refresh-${provider.id}`]: false }));
    }
  }, []);

  const statusDot = (providerId) => {
    if (testing[providerId]) {
      return html`<i class="fa-solid fa-circle fa-beat-fade" style=${{ fontSize: '8px', color: 'var(--text-muted)', marginLeft: '6px' }}></i>`;
    }
    const result = testResults[providerId];
    if (!result) return null;
    const color = result.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';
    const title = result.ok
      ? `Connected${result.modelCount ? ` — ${result.modelCount} models` : ''}`
      : `Error: ${result.error}`;
    return html`<i class="fa-solid fa-circle" style=${{ fontSize: '8px', color, marginLeft: '6px' }} title=${title}></i>`;
  };

  // In per-app mode we only surface globally-enabled providers — there's
  // nothing for the user to toggle on a provider they've turned off in /settings/.
  const visibleList = isPerApp ? providerList.filter(p => p.enabled !== false) : providerList;
  const openRouterProvider = visibleList.find(p => p.type === 'openrouter');
  const localProviders = visibleList.filter(p => p.type !== 'openrouter');

  return html`
    <div class="modal-overlay">
      <div class="modal provider-settings-modal" onClick=${e => e.stopPropagation()} style=${{ maxWidth: '620px', width: '90vw' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-server" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>${isPerApp ? 'Models in this app' : 'Model Providers'}</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body" style=${{ gap: '18px' }}>
          ${isPerApp && html`
            <div class="provider-perapp-hint" style=${{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              lineHeight: 1.5,
            }}>
              <i class="fa-solid fa-circle-info" style=${{ marginRight: '6px', color: 'var(--accent)' }}></i>
              These toggles only affect this app's model picker. Add or edit providers in
              <a href="../settings/" style=${{ color: 'var(--accent)' }}>global Settings</a>.
            </div>
          `}
          <!-- OpenRouter Section -->
          <div class="provider-section">
            <div class="provider-section-header">
              <h3><i class="fa-solid fa-cloud" style=${{ marginRight: '6px' }}></i> OpenRouter${statusDot(openRouterProvider?.id)}</h3>
              <div style=${{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                ${openRouterProvider && html`
                  <button class="btn btn-sm" onClick=${() => handleTest(openRouterProvider)}
                    disabled=${testing[openRouterProvider?.id]}>
                    <i class=${`fa-solid ${testing[openRouterProvider?.id] ? 'fa-spinner fa-spin' : 'fa-plug'}`}></i>
                    Test
                  </button>
                  <button class="btn btn-sm" onClick=${() => handleRefreshModels(openRouterProvider)}
                    disabled=${testing[`refresh-${openRouterProvider?.id}`]}>
                    <i class=${`fa-solid ${testing[`refresh-${openRouterProvider?.id}`] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
                  </button>
                  <label class="provider-toggle">
                    <input type="checkbox"
                      checked=${isProviderOnForApp(openRouterProvider)}
                      onChange=${() => handleToggle(openRouterProvider.id)}
                    />
                    <span class="toggle-slider"></span>
                  </label>
                `}
              </div>
            </div>

            ${testResults[openRouterProvider?.id] && html`
              <div class=${`provider-test-result ${testResults[openRouterProvider?.id].ok ? 'success' : 'error'}`}>
                ${testResults[openRouterProvider?.id].ok
                  ? html`<i class="fa-solid fa-circle-check"></i> Connected${testResults[openRouterProvider?.id].modelCount ? ` — ${testResults[openRouterProvider?.id].modelCount} models` : ''}${testResults[openRouterProvider?.id].refreshed ? ' (cache refreshed)' : ''}`
                  : html`<i class="fa-solid fa-circle-xmark"></i> ${testResults[openRouterProvider?.id].error}`
                }
              </div>
            `}

            ${!isPerApp && html`
              <div class="form-group">
                <label>API Key</label>
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <input class="form-input" type="password" value=${apiKey}
                    onInput=${e => setApiKey(e.target.value)}
                    onKeyDown=${e => e.key === 'Enter' && handleSaveApiKey()}
                    placeholder="sk-or-v1-..."
                    style=${{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }}
                  />
                  <button class="btn btn-primary btn-sm" onClick=${handleSaveApiKey}>
                    <i class="fa-solid fa-check"></i>
                  </button>
                  ${hasApiKey() && html`
                    <button class="btn btn-danger btn-sm" onClick=${handleRemoveApiKey}>
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  `}
                </div>
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style=${{ color: 'var(--accent)' }}>openrouter.ai/keys</a>
                </span>
              </div>
            `}
          </div>

          <!-- Local endpoint section -->
          <div class="provider-section">
            <div class="provider-section-header">
              <h3><i class="fa-solid fa-network-wired" style=${{ marginRight: '6px' }}></i> Local OpenAI-compatible Endpoints</h3>
              ${!isPerApp && html`
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <button class="btn btn-sm btn-primary" onClick=${() => startAddEndpoint('lmstudio')}>
                    <i class="fa-solid fa-plus"></i> LM Studio
                  </button>
                  <button class="btn btn-sm btn-primary" onClick=${() => startAddEndpoint('unsloth-studio')}>
                    <i class="fa-solid fa-plus"></i> Unsloth Studio
                  </button>
                </div>
              `}
            </div>

            ${localProviders.length === 0 && !showAddForm && html`
              <div class="provider-empty">
                <i class="fa-solid fa-desktop" style=${{ opacity: 0.4, fontSize: '24px' }}></i>
                <span>No local endpoints configured</span>
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Add LM Studio or Unsloth Studio to use local models
                </span>
              </div>
            `}

            ${localProviders.map(p => (!isPerApp && editingId === p.id) ? html`
              <!-- Inline edit form -->
              <div class="provider-card editing" key=${p.id}>
                <div class="form-group">
                  <label>Name</label>
                  <input class="form-input" value=${newName} onInput=${e => setNewName(e.target.value)} placeholder=${localProviderMeta(p.type).placeholderName} />
                </div>
                <div class="form-group">
                  <label>Base URL</label>
                  <input class="form-input" value=${newUrl} onInput=${e => setNewUrl(e.target.value)} placeholder=${localProviderMeta(p.type).placeholderUrl} />
                </div>
                ${localProviderMeta(p.type).needsKey && html`
                  <div class="form-group">
                    <label>API Key</label>
                    <input class="form-input" type="password" value=${newApiKey}
                      onInput=${e => setNewApiKey(e.target.value)}
                      placeholder="sk-unsloth-..."
                      style=${{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                `}
                <div style=${{ display: 'flex', gap: '8px' }}>
                  <div class="form-group" style=${{ flex: 1 }}>
                    <label>Tags</label>
                    <input class="form-input" value=${newTags} onInput=${e => setNewTags(e.target.value)} placeholder="lan, gpu, main" />
                  </div>
                  <div class="form-group" style=${{ width: '100px' }}>
                    <label>Timeout (ms)</label>
                    <input class="form-input" type="number" value=${newTimeout} onInput=${e => setNewTimeout(e.target.value)} />
                  </div>
                </div>
                <div style=${{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button class="btn btn-sm" onClick=${handleCancelEdit}>Cancel</button>
                  <button class="btn btn-sm btn-primary" onClick=${handleSaveEdit}>Save</button>
                </div>
              </div>
            ` : html`
              <div class="provider-card" key=${p.id}>
                <div class="provider-card-header">
                  <div class="provider-card-info">
                    <span class="provider-card-name">
                      <i class=${`fa-solid ${localProviderMeta(p.type).icon}`} style=${{ marginRight: '6px', color: 'var(--text-muted)' }}></i>
                      ${p.name}${statusDot(p.id)}
                    </span>
                    <span class="provider-card-url">${p.baseUrl}</span>
                    ${p.tags?.length > 0 && html`
                      <div class="provider-card-tags">
                        ${p.tags.map(tag => html`<span class="provider-tag" key=${tag}>${tag}</span>`)}
                      </div>
                    `}
                  </div>
                  <div class="provider-card-actions">
                    <button class="btn-icon btn-sm" onClick=${() => handleTest(p)} disabled=${testing[p.id]} title="Test connection">
                      <i class=${`fa-solid ${testing[p.id] ? 'fa-spinner fa-spin' : 'fa-plug'}`}></i>
                    </button>
                    <button class="btn-icon btn-sm" onClick=${() => handleRefreshModels(p)} disabled=${testing[`refresh-${p.id}`]} title="Refresh models">
                      <i class=${`fa-solid ${testing[`refresh-${p.id}`] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
                    </button>
                    ${!isPerApp && html`
                      <button class="btn-icon btn-sm" onClick=${() => handleStartEdit(p)} title="Edit">
                        <i class="fa-solid fa-pen"></i>
                      </button>
                      <button class="btn-icon btn-sm" onClick=${() => handleRemove(p.id)} title="Remove" style=${{ color: 'var(--danger)' }}>
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    `}
                    <label class="provider-toggle">
                      <input type="checkbox" checked=${isProviderOnForApp(p)} onChange=${() => handleToggle(p.id)} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                ${testResults[p.id] && html`
                  <div class=${`provider-test-result ${testResults[p.id].ok ? 'success' : 'error'}`}>
                    ${testResults[p.id].ok
                      ? html`<i class="fa-solid fa-circle-check"></i> Connected${testResults[p.id].modelCount ? ` — ${testResults[p.id].modelCount} models` : ''}${testResults[p.id].refreshed ? ' (cache refreshed)' : ''}`
                      : html`<i class="fa-solid fa-circle-xmark"></i> ${testResults[p.id].error}`
                    }
                  </div>
                `}
              </div>
            `)}

            <!-- Add Form -->
            ${!isPerApp && showAddForm && !editingId && html`
              <div class="provider-card editing">
                <div class="form-group">
                  <label>Name</label>
                  <input class="form-input" value=${newName} onInput=${e => setNewName(e.target.value)}
                    placeholder=${localProviderMeta(newType).placeholderName} autoFocus />
                </div>
                <div class="form-group">
                  <label>Base URL</label>
                  <input class="form-input" value=${newUrl} onInput=${e => setNewUrl(e.target.value)}
                    placeholder=${localProviderMeta(newType).placeholderUrl} />
                </div>
                ${localProviderMeta(newType).needsKey && html`
                  <div class="form-group">
                    <label>API Key</label>
                    <input class="form-input" type="password" value=${newApiKey}
                      onInput=${e => setNewApiKey(e.target.value)}
                      placeholder="sk-unsloth-..."
                      style=${{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                `}
                <div style=${{ display: 'flex', gap: '8px' }}>
                  <div class="form-group" style=${{ flex: 1 }}>
                    <label>Tags (comma-separated)</label>
                    <input class="form-input" value=${newTags} onInput=${e => setNewTags(e.target.value)}
                      placeholder="lan, gpu, main" />
                  </div>
                  <div class="form-group" style=${{ width: '100px' }}>
                    <label>Timeout (ms)</label>
                    <input class="form-input" type="number" value=${newTimeout} onInput=${e => setNewTimeout(e.target.value)} />
                  </div>
                </div>
                <div style=${{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button class="btn btn-sm" onClick=${resetEndpointForm}>
                    Cancel
                  </button>
                  <button class="btn btn-sm btn-primary" onClick=${handleAdd} disabled=${!newUrl.trim()}>
                    <i class="fa-solid fa-plus"></i> Add ${localProviderMeta(newType).title}
                  </button>
                </div>
              </div>
            `}
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `;
}

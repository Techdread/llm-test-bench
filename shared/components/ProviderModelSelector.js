// ProviderModelSelector — shared Preact component
// Combined provider/model selector for single-target apps.
// Shows a grouped dropdown with models organised by provider.

import { html } from 'htm/preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { getEnabledProviders } from '../services/model-providers.js';

/**
 * @param {Object} props
 * @param {Array} props.models - Normalized model objects from model-providers.js
 * @param {string} props.providerId - Currently selected provider ID
 * @param {string} props.modelId - Currently selected model ID
 * @param {Function} props.onChange - Called with (providerId, modelId)
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading]
 * @param {Function} [props.onSettingsClick] - Open provider settings
 */
export function ProviderModelSelector({ models, providerId, modelId, onChange, disabled, loading, onSettingsClick }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showMode, setShowMode] = useState(() => localStorage.getItem('provider-model-selector-show-mode') || 'all');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setOpen(o => !o);
  }, [disabled]);

  useEffect(() => {
    if (!open) return undefined;
    const focusInput = () => inputRef.current?.focus({ preventScroll: true });
    const frameId = window.requestAnimationFrame
      ? window.requestAnimationFrame(focusInput)
      : window.setTimeout(focusInput, 0);
    return () => {
      if (window.cancelAnimationFrame) {
        window.cancelAnimationFrame(frameId);
      } else {
        window.clearTimeout(frameId);
      }
    };
  }, [open]);

  const handleSelect = useCallback((pId, mId) => {
    onChange(pId, mId);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = search.trim();
      if (trimmed) {
        // Use custom model ID — infer the most likely provider
        let targetProvider = providerId;
        if (!targetProvider) {
          // Pick the first provider from the loaded model list,
          // or fall back to the first enabled provider in the registry
          const providerIds = [...new Set((models || []).map(m => m.providerId))];
          targetProvider = providerIds[0] || getEnabledProviders()[0]?.id || '';
        }
        onChange(targetProvider, trimmed);
        setOpen(false);
        setSearch('');
      }
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }, [search, providerId, models, onChange]);

  useEffect(() => {
    localStorage.setItem('provider-model-selector-show-mode', showMode);
  }, [showMode]);

  function isFreeOpenRouterModel(model) {
    if (model.providerType !== 'openrouter') return true;
    const pricing = model.raw?.pricing || model.pricing || {};
    const promptCost = parseFloat(pricing.prompt || '1') || 0;
    const completionCost = parseFloat(pricing.completion || '1') || 0;
    return promptCost === 0 && completionCost === 0;
  }

  // Group models by provider
  const allModels = (models || []).filter(m => showMode === 'all' || isFreeOpenRouterModel(m));
  const filtered = allModels.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q)
      || m.modelId.toLowerCase().includes(q)
      || m.providerName.toLowerCase().includes(q);
  });

  // Group by provider
  const grouped = {};
  for (const m of filtered) {
    if (!grouped[m.providerId]) {
      grouped[m.providerId] = { name: m.providerName, type: m.providerType, models: [] };
    }
    grouped[m.providerId].models.push(m);
  }

  // Display label for current selection
  const selected = allModels.find(m => m.providerId === providerId && m.modelId === modelId);
  const displayLabel = selected
    ? selected.displayLabel
    : (modelId ? `${modelId}` : '');

  const providerIcon = (type) => {
    if (type === 'cli-agent') return 'fa-terminal';
    if (type === 'openrouter') return 'fa-cloud';
    if (type === 'unsloth-studio') return 'fa-bolt';
    return 'fa-network-wired';
  };

  return html`
    <div class="model-selector" ref=${containerRef}>
      <button
        class="model-selector-trigger"
        onClick=${handleToggle}
        disabled=${disabled}
        title=${disabled ? 'Configure providers first' : 'Select a model'}
      >
        <span class="model-selector-label">
          ${loading
            ? html`<i class="fa-solid fa-spinner fa-spin" style=${{ marginRight: '6px' }}></i> Loading...`
            : (disabled
              ? '\u{2699}\uFE0F Configure providers'
              : (displayLabel || 'Select model...')
            )
          }
        </span>
        <i class="fa-solid fa-chevron-down model-selector-arrow"></i>
      </button>
      ${open && html`
        <div class="model-selector-dropdown">
          <div class="model-selector-search" style=${{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' }}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i class="fa-solid fa-search model-selector-search-icon"></i>
              <input
                ref=${inputRef}
                type="text"
                class="model-selector-input"
                value=${search}
                onInput=${e => setSearch(e.target.value)}
                onKeyDown=${handleKeyDown}
                placeholder="Search models..."
              />
              ${onSettingsClick && html`
                <button class="btn-icon" onClick=${(e) => { e.stopPropagation(); setOpen(false); onSettingsClick(); }}
                  title="Provider settings" style=${{ fontSize: '12px', padding: '2px 4px' }}>
                  <i class="fa-solid fa-gear"></i>
                </button>
              `}
            </div>
            <div style=${{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
              <button
                class="btn-icon"
                style=${{ padding: '4px 10px', borderRadius: 0, background: showMode === 'free' ? 'var(--accent-light)' : 'transparent', color: showMode === 'free' ? 'var(--accent)' : 'var(--text-secondary)' }}
                onClick=${(e) => { e.stopPropagation(); setShowMode('free'); }}
                title="Show free models only"
              >
                Free
              </button>
              <button
                class="btn-icon"
                style=${{ padding: '4px 10px', borderRadius: 0, background: showMode === 'all' ? 'var(--accent-light)' : 'transparent', color: showMode === 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}
                onClick=${(e) => { e.stopPropagation(); setShowMode('all'); }}
                title="Show all models"
              >
                All
              </button>
            </div>
          </div>
          <div class="model-selector-list">
            ${Object.keys(grouped).length > 0
              ? Object.entries(grouped).map(([pid, group]) => html`
                  <div key=${pid} class="model-selector-group">
                    <div class="model-selector-group-header">
                      <i class=${`fa-solid ${providerIcon(group.type)}`}
                         style=${{ marginRight: '6px', fontSize: '10px' }}></i>
                      ${group.name}
                    </div>
                    ${group.models.map(m => html`
                      <button
                        key=${`${m.providerId}::${m.modelId}`}
                        class=${`model-selector-item ${m.providerId === providerId && m.modelId === modelId ? 'active' : ''}`}
                        onClick=${() => handleSelect(m.providerId, m.modelId)}
                        title=${m.modelId}
                      >
                        <span class="model-selector-item-name">${m.name}</span>
                        <span class="model-selector-item-id">${m.modelId}</span>
                      </button>
                    `)}
                  </div>
                `)
              : html`
                  <div class="model-selector-empty">
                    ${search
                      ? html`No matches. Press <kbd>Enter</kbd> to use "<strong>${search}</strong>" as custom model.`
                      : 'No models available'
                    }
                  </div>
                `
            }
          </div>
        </div>
      `}
    </div>
  `;
}

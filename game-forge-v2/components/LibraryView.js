import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ProviderModelSelector } from '../../shared/components/ProviderModelSelector.js';
import {
  ProjectLibraryBadges, ProjectLibraryPicker,
} from '../../shared/forge/components/ProjectLibraryPicker.js';
import { PROJECT_LIBRARIES } from '../services/projectLibraries.js';
import { AGENTS, listAgentModels } from '../services/agentBackend.js';
import {
  getAllPrompts, filterPrompts, softDelete, addUserPrompt, groupPromptVariants,
  promptGameSlug, promptRunCounts, savePromptEdit,
  listHiddenPrompts, restorePrompt,
  downloadPromptLibrary, exportPromptLibrary, importPromptLibrary,
} from '../services/library.js';
import { listGames } from '../services/runStore.js';
import { getAllLanes, laneLabel } from '../services/lanes.js';
import { VariantSweepDialog } from './VariantSweepDialog.js';
import {
  generatePromptDraft, generatePromptDraftWithAgent,
} from '../services/promptDrafting.js';
import { normalizeLibraryIds } from '../services/projectLibraries.js';
import {
  FALLBACK_PROMPT_CATEGORIES, FALLBACK_PROMPT_COLLECTIONS,
  loadPromptTaxonomyRegistry, normalizePromptTaxonomy, promptFacetValues,
} from '../services/promptCategories.js';

/**
 * "12 runs" for a prompt, and a way in.
 *
 * The number is that prompt's OWN runs. Variants build into their own folders,
 * so a base prompt's lane runs are reported separately in the tooltip rather
 * than folded into a single number nobody could interpret.
 */
function RunCountBadge({ prompt, counts, onOpenRuns }) {
  const count = counts.get(prompt.id);
  if (!count?.own && !count?.lanes) return null;
  const lanePart = count.laneCount
    ? ` · ${count.lanes} more across its ${count.laneCount} lane${count.laneCount === 1 ? '' : 's'}`
    : '';
  return html`
    <button class="gf-era gf-runcount" onClick=${event => { event.stopPropagation(); onOpenRuns?.(promptGameSlug(prompt)); }}
      title=${`${count.own} run${count.own === 1 ? '' : 's'} of this prompt${lanePart} — open in Runs`}>
      <i class="fas fa-clock-rotate-left"></i> ${count.own}${count.laneCount ? `+${count.lanes}` : ''}
    </button>`;
}

export function LibraryView({
  onBuild, models = [], providerId, modelId, modelsLoading, onProviderSettings,
  hasRoot, onConnectRoot, onOpenRuns,
}) {
  const [prompts, setPrompts] = useState([]);
  const [taxonomy, setTaxonomy] = useState({
    categories: FALLBACK_PROMPT_CATEGORIES,
    collections: FALLBACK_PROMPT_COLLECTIONS,
  });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(null);
  const [collection, setCollection] = useState(null);
  const [stack, setStack] = useState(null);
  const [tag, setTag] = useState(null);
  const [lane, setLane] = useState(null);
  const [libraryId, setLibraryId] = useState(null);
  const [kind, setKind] = useState(null);
  const [flat, setFlat] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [lanes, setLanes] = useState([]);
  const [games, setGames] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [sweeping, setSweeping] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const importRef = useRef(null);

  const reload = async () => {
    try {
      setPrompts(await getAllPrompts());
      setHidden(await listHiddenPrompts());
    } catch (error) { setMessage(`Library error: ${error.message}`); }
  };
  useEffect(() => {
    reload();
    loadPromptTaxonomyRegistry().then(setTaxonomy);
    getAllLanes().then(setLanes).catch(error => setMessage(`Lane catalogue error: ${error.message}`));
    // Directory counts only — no run metadata is read, so this stays cheap for
    // the whole library. Absent without a data root, which is not an error.
    listGames().then(setGames).catch(() => setGames([]));
  }, []);

  const toggleExpanded = id => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportLibrary = async () => {
    try {
      downloadPromptLibrary(await exportPromptLibrary());
      setMessage('Exported the versioned custom prompt library.');
    } catch (error) { setMessage(`Export failed: ${error.message}`); }
  };

  const importLibrary = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await importPromptLibrary(JSON.parse(await file.text()));
      await reload();
      setMessage(`Imported prompt library from ${file.name}.`);
    } catch (error) { setMessage(`Import failed: ${error.message}`); }
  };

  const facets = promptFacetValues(prompts);
  const categoryMap = new Map(taxonomy.categories.map(item => [item.id, item]));
  const collectionMap = new Map(taxonomy.collections.map(item => [item.id, item]));
  const filtered = filterPrompts(prompts, {
    query, tag, category, collection, stack, library: libraryId, kind,
  });
  // The strip under a card always shows that game's complete lane set, so it is
  // built from every prompt rather than from the filtered results — otherwise a
  // search that matched only the parent would report it as having no variants.
  const { variantsByParent } = groupPromptVariants(prompts);
  const laneFiltered = lane
    ? filtered.filter(prompt => prompt.derivation?.laneId === lane)
    : filtered;
  // Picking a lane, or asking for variants only, IS the flat view: every row is
  // already a variant, so there is nothing left to collapse.
  const showFlat = flat || Boolean(lane) || kind === 'variant';
  const shown = showFlat ? laneFiltered : groupPromptVariants(laneFiltered).bases;
  const laneFacet = [...new Set(prompts.map(prompt => prompt.derivation?.laneId).filter(Boolean))].sort();
  const runCounts = promptRunCounts(prompts, games);
  const activeFilters = [category, collection, stack, tag, lane, libraryId, kind].filter(Boolean).length;

  return html`
    <div class="gf-library">
      <div class="gf-lib-controls">
        <input class="gf-search" type="text" placeholder="Search games…" value=${query}
          onInput=${e => setQuery(e.target.value)} />
        <button class="gf-btn" onClick=${() => setAdding(true)}><i class="fas fa-plus"></i> New prompt</button>
        <button class="gf-btn" onClick=${() => setSweeping(true)}
          title="Derive library variants of the filtered prompts">
          <i class="fas fa-code-branch"></i> Create variants
        </button>
        <button class="gf-btn" onClick=${() => importRef.current?.click()}><i class="fas fa-file-import"></i> Import</button>
        <button class="gf-btn" onClick=${exportLibrary}><i class="fas fa-file-export"></i> Export</button>
        <input ref=${importRef} type="file" accept="application/json,.json" hidden onChange=${importLibrary} />
      </div>
      <nav class="gf-categorybar" aria-label="Prompt categories">
        <button class=${`gf-category ${!category ? 'active' : ''}`} onClick=${() => setCategory(null)}>
          <i class="fas fa-layer-group"></i><span>All</span><small>${prompts.length}</small>
        </button>
        ${taxonomy.categories.filter(item => facets.categories.includes(item.id)).map(item => html`
          <button class=${`gf-category ${category === item.id ? 'active' : ''}`}
            onClick=${() => setCategory(category === item.id ? null : item.id)}>
            <i class=${`fas ${item.icon || 'fa-gamepad'}`}></i><span>${item.title}</span>
            <small>${prompts.filter(prompt => prompt.category === item.id).length}</small>
          </button>`)}
      </nav>
      ${(category === 'vr' || collection === 'quest-vr') && html`
        <p class="gf-vr-intro">
          <i class="fas fa-vr-cardboard"></i> Build for Quest 3 Browser VR.
          These briefs include tracked controllers, in-world menus and desktop controls.
          After building, open the game on Quest over HTTPS and choose Enter VR.
          Each generated game still needs a headset playtest.
        </p>`}
      <div class="gf-facetbar">
        <label>Collection
          <select value=${collection || ''} onChange=${event => setCollection(event.target.value || null)}>
            <option value="">All collections</option>
            ${facets.collections.map(id => html`<option value=${id}>${collectionMap.get(id)?.title || id}</option>`)}
          </select>
        </label>
        <label>Target
          <select value=${stack || ''} onChange=${event => setStack(event.target.value || null)}>
            <option value="">All stacks</option>
            ${facets.stacks.map(id => html`<option value=${id}>${id.toUpperCase()}</option>`)}
          </select>
        </label>
        <label>Tag
          <select value=${tag || ''} onChange=${event => setTag(event.target.value || null)}>
            <option value="">All tags</option>
            ${facets.tags.map(id => html`<option value=${id}>${id}</option>`)}
          </select>
        </label>
        ${facets.libraries.length > 0 && html`
          <label>Library
            <select value=${libraryId || ''} onChange=${event => setLibraryId(event.target.value || null)}>
              <option value="">Any library</option>
              ${facets.libraries.map(id => html`<option value=${id}>${PROJECT_LIBRARIES[id]?.label || id}</option>`)}
            </select>
          </label>`}
        ${laneFacet.length > 0 && html`
          <label>Kind
            <select value=${kind || ''} onChange=${event => setKind(event.target.value || null)}>
              <option value="">Originals and variants</option>
              <option value="base">Originals only</option>
              <option value="variant">Variants only</option>
            </select>
          </label>`}
        ${laneFacet.length > 0 && html`
          <label>Lane
            <select value=${lane || ''} onChange=${event => setLane(event.target.value || null)}>
              <option value="">All lanes</option>
              ${laneFacet.map(id => html`<option value=${id}>${laneLabel(lanes, id)}</option>`)}
            </select>
          </label>`}
        ${laneFacet.length > 0 && !lane && html`
          <label class="gf-facet-toggle" title="Show every variant as its own card">
            <input type="checkbox" checked=${flat} onChange=${event => setFlat(event.target.checked)} />
            Variants as cards
          </label>`}
        <span class="gf-result-count">${shown.length} prompt${shown.length === 1 ? '' : 's'}</span>
        ${activeFilters > 0 && html`
          <button class="gf-btn" onClick=${() => {
            setCategory(null); setCollection(null); setStack(null);
            setTag(null); setLane(null); setLibraryId(null); setKind(null);
          }}>
            <i class="fas fa-filter-circle-xmark"></i> Clear filters
          </button>`}
      </div>
      ${hidden.length > 0 && html`
        <div class="gf-hidden-bar">
          <i class="fas fa-eye-slash"></i>
          <span>${hidden.length} hidden prompt${hidden.length === 1 ? '' : 's'} — nothing was deleted.</span>
          ${hidden.map(item => html`
            <button class="gf-btn gf-restore-btn" key=${item.id}
              title=${`Restore "${item.title}" with all ${item.promptVersion || 1} of its versions`}
              onClick=${async () => {
                await restorePrompt(item.id);
                await reload();
                setMessage(`Restored ${item.title}.`);
              }}>
              <i class="fas fa-rotate-left"></i> ${item.title}
            </button>`)}
        </div>`}
      ${message && html`<div class="gf-library-message">${message}</div>`}

      <div class="gf-grid">
        ${shown.map(p => html`
          <div class="gf-card" key=${p.id}>
            <div class="gf-card-head">
              <span class="gf-category-badge"><i class=${`fas ${categoryMap.get(p.category)?.icon || 'fa-box-archive'}`}></i> ${categoryMap.get(p.category)?.title || p.category}</span>
              <span class="gf-era">${p.era}</span>
              ${p.source === 'user' && html`<span class="gf-era gf-user">custom</span>`}
              ${p.source === 'user' && html`<span class="gf-era">v${p.promptVersion || 1}</span>`}
              ${/^(ai-|agent-)|assisted/.test(p.authoring?.source || '') && html`
                <span class="gf-era gf-ai-badge" title=${`Drafted with ${p.authoring.modelDisplayLabel || p.authoring.modelId || 'AI'}`}>
                  <i class="fas fa-wand-magic-sparkles"></i> AI
                </span>`}
              ${p.derivation?.laneId
                ? html`<span class="gf-era gf-lane-badge"
                    title=${`${laneLabel(lanes, p.derivation.laneId)} variant of ${p.derivation.parentPromptId} v${p.derivation.parentPromptVersion || 1} · ${p.derivation.variantMode || 'adapted'}`}>
                    <i class="fas fa-code-branch"></i> ${laneLabel(lanes, p.derivation.laneId)}
                  </span>`
                : p.derivation && html`
                  <span class="gf-era" title=${`Derived from ${p.derivation.parentPromptId || 'another prompt'} v${p.derivation.parentPromptVersion || 1}`}>
                    <i class="fas fa-code-branch"></i> variant
                  </span>`}
              <${RunCountBadge} prompt=${p} counts=${runCounts} onOpenRuns=${onOpenRuns} />
              <${ProjectLibraryBadges} value=${p.libraries} />
              <span class="gf-stack">${p.targetStack}</span>
            </div>
            <h3>${p.title}</h3>
            <p class="gf-card-prompt">${p.prompt}</p>
            ${p.watchFor && html`<p class="gf-watch"><b>Watch for:</b> ${p.watchFor}</p>`}
            <div class="gf-card-tags">${(p.tags || []).map(t => html`<span class="gf-tag">${t}</span>`)}</div>
            <div class="gf-card-actions">
              <button class="gf-btn gf-primary" onClick=${() => onBuild(p)}><i class="fas fa-hammer"></i> Build</button>
              <button class="gf-icon-btn" onClick=${() => setEditing(p)}
                title=${p.source === 'seed'
                  ? 'Edit this curated prompt. It is copied into your library as version 1 and your change is saved as version 2 — the original wording is never lost.'
                  : 'Edit as a new prompt version'}>
                <i class="fas fa-pen"></i>
              </button>
              <button class="gf-icon-btn" title=${`Hide "${p.title}" from the library. Nothing is deleted — every version stays on disk and a Restore button appears above the grid.`}
                onClick=${async () => { await softDelete(p.id); await reload(); setMessage(`Hid ${p.title}. Restore it from the bar above.`); }}>
                <i class="fas fa-eye-slash"></i>
              </button>
              ${!showFlat && (variantsByParent.get(p.id)?.length > 0) && html`
                <button class=${`gf-btn gf-variant-chip ${expanded.has(p.id) ? 'active' : ''}`}
                  onClick=${() => toggleExpanded(p.id)}
                  title="Library variants derived from this prompt">
                  <i class="fas fa-code-branch"></i> ${variantsByParent.get(p.id).length} lanes
                  <i class=${`fas ${expanded.has(p.id) ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                </button>`}
            </div>
            ${!showFlat && expanded.has(p.id) && html`
              <div class="gf-variant-strip">
                ${variantsByParent.get(p.id).map(variant => html`
                  <div class="gf-variant-row" key=${variant.id}>
                    <span class="gf-variant-lane">${laneLabel(lanes, variant.derivation.laneId)}</span>
                    <span class=${`gf-variant-mode gf-mode-${variant.derivation.variantMode || 'adapted'}`}>
                      ${variant.derivation.variantMode === 'held-constant' ? 'held constant' : (variant.derivation.variantMode || 'adapted')}
                    </span>
                    <${ProjectLibraryBadges} value=${variant.libraries} />
                    <span class="gf-variant-version">v${variant.promptVersion || 1}</span>
                    <${RunCountBadge} prompt=${variant} counts=${runCounts} onOpenRuns=${onOpenRuns} />
                    <button class="gf-btn gf-primary" onClick=${() => onBuild(variant)}>
                      <i class="fas fa-hammer"></i> Build
                    </button>
                    <button class="gf-icon-btn" title="Edit as a new prompt version" onClick=${() => setEditing(variant)}>
                      <i class="fas fa-pen"></i>
                    </button>
                    <button class="gf-icon-btn" title="Hide this variant (version history is preserved)"
                      onClick=${async () => { await softDelete(variant.id); await reload(); }}>
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>`)}
              </div>`}
          </div>`)}
        ${shown.length === 0 && html`<div class="gf-empty">No games match.</div>`}
      </div>

      ${adding && html`<${AddDialog}
        taxonomy=${taxonomy}
        models=${models} defaultProviderId=${providerId} defaultModelId=${modelId}
        modelsLoading=${modelsLoading} onProviderSettings=${onProviderSettings}
        hasRoot=${hasRoot} onConnectRoot=${onConnectRoot}
        onClose=${() => setAdding(false)} onSave=${async value => {
        await addUserPrompt(value); setAdding(false); await reload();
      }} />`}
      ${editing && html`<${AddDialog}
        initial=${editing}
        taxonomy=${taxonomy}
        models=${models} defaultProviderId=${providerId} defaultModelId=${modelId}
        modelsLoading=${modelsLoading} onProviderSettings=${onProviderSettings}
        hasRoot=${hasRoot} onConnectRoot=${onConnectRoot}
        onClose=${() => setEditing(null)}
        onSave=${async value => {
          const updated = await savePromptEdit(editing, value);
          setEditing(null);
          setMessage(editing.source === 'seed'
            ? `Saved ${updated.title} as version ${updated.promptVersion}. The curated original is kept as version 1.`
            : `Saved ${updated.title} as version ${updated.promptVersion}.`);
          await reload();
        }}
      />`}
      ${sweeping && html`<${VariantSweepDialog}
        prompts=${groupPromptVariants(filtered).bases}
        existing=${prompts}
        lanes=${lanes}
        models=${models} defaultProviderId=${providerId} defaultModelId=${modelId}
        modelsLoading=${modelsLoading} onProviderSettings=${onProviderSettings}
        hasRoot=${hasRoot} onConnectRoot=${onConnectRoot}
        onLanesChanged=${async () => setLanes(await getAllLanes())}
        onClose=${() => setSweeping(false)}
        onDone=${async record => {
          await reload();
          const { succeeded, failed } = record.counts;
          setMessage(`Sweep finished: ${succeeded} variant${succeeded === 1 ? '' : 's'} saved${failed ? `, ${failed} failed` : ''}.`);
        }}
      />`}
    </div>`;
}

function AddDialog({
  initial = null, models, defaultProviderId, defaultModelId,
  modelsLoading, onProviderSettings, hasRoot, onConnectRoot, onClose, onSave, taxonomy,
}) {
  const [title, setTitle] = useState(initial?.title || '');
  const [prompt, setPrompt] = useState(initial?.prompt || '');
  const [era, setEra] = useState(initial?.era || 'Custom');
  const [targetStack, setTargetStack] = useState(initial?.targetStack || 'web');
  const initialTaxonomy = normalizePromptTaxonomy(initial || {});
  const [category, setCategory] = useState(initialTaxonomy.category);
  const [subcategory, setSubcategory] = useState(initialTaxonomy.subcategory);
  const [collections, setCollections] = useState(initialTaxonomy.collections.join(', '));
  const [libraries, setLibraries] = useState(() => normalizeLibraryIds(initial?.libraries));
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [watchFor, setWatchFor] = useState(initial?.watchFor || '');
  const [guided, setGuided] = useState(true);
  const [wizardStep, setWizardStep] = useState(1);
  const [authoring, setAuthoring] = useState(() => initial
    ? {
      source: 'human-edit',
      parentVersion: initial.promptVersion || 1,
      basedOn: initial.authoring ? {
        source: initial.authoring.source || null,
        providerId: initial.authoring.providerId || null,
        modelId: initial.authoring.modelId || null,
      } : null,
    }
    : { source: 'human' });
  const [draftProviderId, setDraftProviderId] = useState(
    () => localStorage.getItem('game-forge-v2-prompt-provider') || defaultProviderId || ''
  );
  const [draftModelId, setDraftModelId] = useState(
    () => localStorage.getItem('game-forge-v2-prompt-model') || defaultModelId || ''
  );
  const [draftTarget, setDraftTarget] = useState(
    () => localStorage.getItem('game-forge-v2-prompt-target') || (hasRoot ? 'codex' : 'provider')
  );
  const [agentModel, setAgentModel] = useState(
    () => localStorage.getItem(`game-forge-v2-prompt-agent-model-${
      localStorage.getItem('game-forge-v2-prompt-target') || (hasRoot ? 'codex' : 'provider')
    }`) || ''
  );
  const [availableAgentModels, setAvailableAgentModels] = useState([]);
  const [drafting, setDrafting] = useState(false);
  const [draftMode, setDraftMode] = useState(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [reviewNotes, setReviewNotes] = useState([]);
  const draftAbortRef = useRef(null);

  useEffect(() => () => draftAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!draftProviderId && defaultProviderId) setDraftProviderId(defaultProviderId);
    if (!draftModelId && defaultModelId) setDraftModelId(defaultModelId);
  }, [defaultProviderId, defaultModelId]);
  useEffect(() => {
    if (draftTarget === 'provider') {
      setAvailableAgentModels([]);
      return undefined;
    }
    let active = true;
    listAgentModels(draftTarget).then(items => {
      if (active) setAvailableAgentModels(items);
    });
    return () => { active = false; };
  }, [draftTarget]);

  const selectDraftModel = (nextProviderId, nextModelId) => {
    setDraftProviderId(nextProviderId);
    setDraftModelId(nextModelId);
    localStorage.setItem('game-forge-v2-prompt-provider', nextProviderId);
    localStorage.setItem('game-forge-v2-prompt-model', nextModelId);
  };

  const selectDraftTarget = target => {
    setDraftTarget(target);
    setAgentModel(target === 'provider'
      ? ''
      : localStorage.getItem(`game-forge-v2-prompt-agent-model-${target}`) || '');
    setDraftError('');
    localStorage.setItem('game-forge-v2-prompt-target', target);
  };

  const selectAgentModel = value => {
    setAgentModel(value);
    localStorage.setItem(`game-forge-v2-prompt-agent-model-${draftTarget}`, value);
  };

  const currentFields = () => ({
    title, prompt, era, targetStack, libraries, category, subcategory,
    collections: collections.split(',').map(value => value.trim()).filter(Boolean),
    tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
    watchFor,
  });

  const runDraft = async mode => {
    draftAbortRef.current?.abort();
    const controller = new AbortController();
    draftAbortRef.current = controller;
    setDrafting(true);
    setDraftMode(mode);
    setDraftRaw('');
    setSuggestion(null);
    setDraftError('');
    setDraftStatus(draftTarget === 'provider' ? 'Contacting model…' : 'Starting local coding agent…');
    try {
      let result;
      let draftAuthoring;
      if (draftTarget === 'provider') {
        result = await generatePromptDraft({
          mode,
          fields: currentFields(),
          providerId: draftProviderId,
          modelId: draftModelId,
          signal: controller.signal,
          onChunk: text => {
            setDraftRaw(text);
            setDraftStatus('Writing the structured brief…');
          },
        });
        const selected = models.find(model =>
          model.providerId === draftProviderId && model.modelId === draftModelId
        );
        draftAuthoring = {
          source: 'ai-assisted',
          mode,
          providerId: draftProviderId,
          providerName: selected?.providerName || draftProviderId,
          providerType: selected?.providerType || null,
          modelId: draftModelId,
          modelName: selected?.name || draftModelId,
          modelDisplayLabel: selected?.displayLabel || selected?.name || draftModelId,
          generatedAt: new Date().toISOString(),
        };
      } else {
        const agent = AGENTS.find(item => item.id === draftTarget);
        result = await generatePromptDraftWithAgent({
          mode,
          fields: currentFields(),
          agentId: draftTarget,
          agentModel,
          signal: controller.signal,
          onChunk: text => setDraftRaw(text),
          onEvent: event => {
            if (event.type === 'session') setDraftStatus(`${agent?.label || draftTarget} started…`);
            else if (event.type === 'reasoning') setDraftStatus('Thinking through the brief…');
            else if (event.type === 'message') setDraftStatus('Writing the structured brief…');
          },
        });
        draftAuthoring = {
          source: 'agent-assisted',
          mode,
          agentId: draftTarget,
          agentName: agent?.label || draftTarget,
          modelId: agentModel || null,
          modelName: agentModel || 'CLI default',
          modelDisplayLabel: `${agent?.label || draftTarget}${agentModel ? ` / ${agentModel}` : ''}`,
          jobId: result.jobId,
          bridgeRunId: result.bridgeRunId,
          generatedAt: new Date().toISOString(),
        };
      }
      const nextSuggestion = {
        ...result.suggestion,
        authoring: draftAuthoring,
      };
      setSuggestion(nextSuggestion);
      setReviewNotes(nextSuggestion.reviewNotes || []);
      if (guided) {
        applySuggestion('all', nextSuggestion);
        setWizardStep(3);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setDraftError(error.message);
    } finally {
      if (draftAbortRef.current === controller) {
        draftAbortRef.current = null;
        setDrafting(false);
      }
    }
  };

  const applySuggestion = (scope, value = suggestion) => {
    if (!value) return;
    if (scope === 'all') {
      setTitle(value.title);
      setPrompt(value.prompt);
      setEra(value.era);
      setTargetStack(value.targetStack);
      setCategory(value.category);
      setSubcategory(value.subcategory);
      setCollections((value.collections || []).join(', '));
      setLibraries(normalizeLibraryIds(value.libraries));
      setTags(value.tags.join(', '));
      setWatchFor(value.watchFor);
    } else if (scope === 'prompt') {
      setTitle(value.title);
      setPrompt(value.prompt);
    } else if (scope === 'watch') {
      setWatchFor(value.watchFor);
    }
    setAuthoring({ ...value.authoring, appliedScope: scope });
    setSuggestion(null);
    setDraftRaw('');
  };

  const close = () => {
    draftAbortRef.current?.abort();
    onClose();
  };

  const canDraft = !!(title.trim() || prompt.trim())
    && (draftTarget === 'provider' ? !!draftProviderId && !!draftModelId : !!hasRoot);
  const save = () => onSave({
    title: title.trim(),
    prompt: prompt.trim(),
    era: era.trim() || 'Custom',
    targetStack: targetStack.trim() || 'web',
    category,
    subcategory,
    collections: collections.split(',').map(value => value.trim()).filter(Boolean),
    libraries: normalizeLibraryIds(libraries),
    tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
    watchFor: watchFor.trim(),
    authoring,
  });

  const fullFields = () => html`
    <div class="gf-prompt-fields">
      <label>Title<input value=${title} onInput=${e => setTitle(e.target.value)} placeholder="e.g. Breakout" /></label>
      <label class="gf-field-wide">Build prompt<textarea rows="7" value=${prompt}
        onInput=${e => setPrompt(e.target.value)}
        placeholder="Describe the game, controls, mechanics, and what complete means…"></textarea></label>
      <label>Era<input value=${era} onInput=${e => setEra(e.target.value)} placeholder="Custom" /></label>
      <label>Target stack<input value=${targetStack} onInput=${e => setTargetStack(e.target.value)} placeholder="web" /></label>
      <label>Category<select value=${category} onChange=${e => setCategory(e.target.value)}>
        ${(taxonomy?.categories || FALLBACK_PROMPT_CATEGORIES).map(item => html`<option value=${item.id}>${item.title}</option>`)}
      </select></label>
      <label>Subcategory<input value=${subcategory} onInput=${e => setSubcategory(e.target.value)} placeholder="e.g. metroidvania" /></label>
      <label>Collections<input value=${collections} onInput=${e => setCollections(e.target.value)} placeholder="arcade-classics, beginner" /></label>
      <label>Tags (comma-separated)<input value=${tags} onInput=${e => setTags(e.target.value)} placeholder="arcade, puzzle" /></label>
      <div class="gf-field-wide">
        <${ProjectLibraryPicker}
          value=${libraries}
          onChange=${setLibraries}
          domain="game"
          targetStack=${targetStack}
        />
      </div>
      <label class="gf-field-wide">Watch for<textarea rows="3" value=${watchFor}
        onInput=${e => setWatchFor(e.target.value)}
        placeholder="Likely shortcuts, missing mechanics, or shallow implementations…"></textarea></label>
    </div>`;

  const drafterPicker = () => html`
    <div class="gf-drafter-picker">
      <div class="gf-drafter-grid">
        ${AGENTS.map(agent => html`
          <button class=${`gf-drafter-card ${draftTarget === agent.id ? 'active' : ''}`}
            onClick=${() => selectDraftTarget(agent.id)}>
            <i class=${`fas ${agent.id === 'claude-code' ? 'fa-brain' : agent.id === 'codex' ? 'fa-code' : 'fa-robot'}`}></i>
            <span>${agent.label}</span>
            <small>Local coding agent</small>
          </button>`)}
        <button class=${`gf-drafter-card ${draftTarget === 'provider' ? 'active' : ''}`}
          onClick=${() => selectDraftTarget('provider')}>
          <i class="fas fa-magnifying-glass"></i>
          <span>Provider / local model</span>
          <small>Search every configured model</small>
        </button>
      </div>
      ${draftTarget === 'provider' ? html`
        <div class="gf-drafter-config">
          <div>
            <strong>Search and select a model</strong>
            <span>Includes LM Studio, Unsloth Studio, Lemonade, any OpenAI-compatible endpoint, OpenRouter, and custom model IDs.</span>
          </div>
          <${ProviderModelSelector}
            models=${models}
            providerId=${draftProviderId}
            modelId=${draftModelId}
            onChange=${selectDraftModel}
            loading=${modelsLoading}
            onSettingsClick=${onProviderSettings}
          />
        </div>` : html`
        <div class="gf-drafter-config">
          <div>
            <strong>${AGENTS.find(agent => agent.id === draftTarget)?.label} model</strong>
            <span>Leave blank to use the CLI default, or type to search/choose a reported model.</span>
          </div>
          <input class="gf-agent-model-search" list="gf-prompt-agent-models"
            value=${agentModel} onInput=${e => selectAgentModel(e.target.value)}
            placeholder="CLI default model" />
          <datalist id="gf-prompt-agent-models">
            ${availableAgentModels.map(item => html`<option value=${item}></option>`)}
          </datalist>
        </div>
        ${!hasRoot && html`
          <div class="gf-ai-error">
            Coding agents need a connected data root for their path-jailed draft job.
            <button class="gf-btn" onClick=${onConnectRoot}><i class="fas fa-folder-open"></i> Connect data root</button>
          </div>`}
        <div class="gf-agent-note">
          Runs through the local <code>serve.py</code> bridge using your CLI login.
          The agent is instructed to return JSON only and receives a short drafting budget.
        </div>`}
    </div>`;

  const activity = () => html`
    ${drafting && html`
      <div class="gf-ai-status">
        <i class="fas fa-spinner fa-spin"></i>
        ${draftStatus || `${draftMode} in progress…`}
        <button class="gf-btn gf-danger" onClick=${() => draftAbortRef.current?.abort()}>
          <i class="fas fa-stop"></i> Stop
        </button>
      </div>`}
    ${draftError && html`<div class="gf-ai-error">${draftError}</div>`}
    ${drafting && draftRaw && html`<pre class="gf-ai-stream">${draftRaw}</pre>`}
  `;

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-prompt-modal">
        <div class="gf-prompt-dialog-head">
          <div>
            <h2>${initial ? `Edit prompt · version ${initial.promptVersion || 1}` : 'Create a game prompt'}</h2>
            <p>${guided ? 'The wizard will turn a plain-English idea into a build-ready brief.' : 'Edit every field and use advanced drafting actions.'}</p>
          </div>
          <div class="gf-dialog-head-actions">
            <div class="gf-mode-switch">
              <button class=${guided ? 'active' : ''} onClick=${() => setGuided(true)}>
                <i class="fas fa-route"></i> Guided wizard
              </button>
              <button class=${!guided ? 'active' : ''} onClick=${() => setGuided(false)}>
                <i class="fas fa-sliders"></i> Full editor
              </button>
            </div>
            <button class="gf-icon-btn" title="Close prompt editor" onClick=${close}><i class="fas fa-xmark"></i></button>
          </div>
        </div>

        ${guided ? html`
          <div class="gf-wizard-steps" aria-label="Prompt wizard progress">
            ${['Describe your game', 'Choose a drafter', 'Review and save'].map((label, index) => html`
              <div class=${`${wizardStep === index + 1 ? 'active' : ''} ${wizardStep > index + 1 ? 'done' : ''}`}>
                <span>${wizardStep > index + 1 ? '✓' : index + 1}</span>${label}
              </div>`)}
          </div>
          <div class="gf-wizard-page">
            ${wizardStep === 1 && html`
              <div class="gf-wizard-copy">
                <h3>What game do you want?</h3>
                <p>Use ordinary language. A sentence or two is enough—the drafter will add controls, states, and acceptance checks.</p>
              </div>
              <label>Working title
                <input value=${title} onInput=${e => setTitle(e.target.value)} placeholder="e.g. Crystal Cave Runner" />
              </label>
              <label>Your idea
                <textarea rows="10" value=${prompt} onInput=${e => setPrompt(e.target.value)}
                  placeholder="A cave platform game where you collect crystals and escape before time runs out."></textarea>
              </label>
              <label>Target
                <select value=${targetStack} onChange=${e => setTargetStack(e.target.value)}>
                  <option value="web">Web game — playable in the preview</option>
                  <option value="python">Python</option>
                  <option value="rust">Rust</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                </select>
              </label>
              <label>Category
                <select value=${category} onChange=${e => setCategory(e.target.value)}>
                  ${(taxonomy?.categories || FALLBACK_PROMPT_CATEGORIES).map(item => html`
                    <option value=${item.id}>${item.title}</option>`)}
                </select>
              </label>
              <${ProjectLibraryPicker}
                value=${libraries}
                onChange=${setLibraries}
                domain="game"
                targetStack=${targetStack}
              />`}
            ${wizardStep === 2 && html`
              <div class="gf-wizard-copy">
                <h3>Who should write the detailed prompt?</h3>
                <p>Claude Code, Codex, and Antigravity use their local CLIs. Provider/local model lets you search every configured model.</p>
              </div>
              ${drafterPicker()}
              ${activity()}`}
            ${wizardStep === 3 && html`
              <div class="gf-wizard-copy">
                <h3>Review the finished brief</h3>
                <p>Everything remains editable. Nothing enters the library until you press Save.</p>
              </div>
              ${authoring?.modelDisplayLabel && html`
                <div class="gf-authoring-summary">
                  <i class="fas fa-wand-magic-sparkles"></i>
                  Drafted with <strong>${authoring.modelDisplayLabel}</strong>
                </div>`}
              ${reviewNotes.length > 0 && html`
                <div class="gf-review-notes"><strong>What the drafter improved</strong>
                  <ul>${reviewNotes.map(note => html`<li>${note}</li>`)}</ul>
                </div>`}
              ${fullFields()}`}
          </div>
          <div class="gf-wizard-actions">
            <button class="gf-btn" onClick=${close}>Cancel</button>
            <div>
              ${wizardStep > 1 && html`
                <button class="gf-btn" disabled=${drafting} onClick=${() => setWizardStep(step => step - 1)}>
                  <i class="fas fa-arrow-left"></i> Back
                </button>`}
              ${wizardStep === 1 && html`
                <button class="gf-btn gf-primary" disabled=${!title.trim() && !prompt.trim()}
                  onClick=${() => setWizardStep(2)}>Choose drafter <i class="fas fa-arrow-right"></i></button>`}
              ${wizardStep === 2 && html`
                <button class="gf-btn gf-primary" disabled=${!canDraft || drafting}
                  onClick=${() => runDraft(initial ? 'improve' : 'draft')}>
                  <i class="fas fa-wand-magic-sparkles"></i> Write my build brief
                </button>`}
              ${wizardStep === 3 && html`
                <button class="gf-btn" disabled=${drafting} onClick=${() => setWizardStep(2)}>
                  <i class="fas fa-rotate"></i> Choose another drafter
                </button>
                <button class="gf-btn gf-primary" disabled=${drafting || !title.trim() || !prompt.trim()} onClick=${save}>
                  <i class="fas fa-floppy-disk"></i> ${initial ? 'Save new version' : 'Save prompt'}
                </button>`}
            </div>
          </div>` : html`
          <div class="gf-full-editor">
            ${fullFields()}
            <section class="gf-ai-author">
              <div class="gf-ai-author-head">
                <div>
                  <strong><i class="fas fa-wand-magic-sparkles"></i> AI prompt author</strong>
                  <span>Select a coding agent or search your configured provider/local models.</span>
                </div>
              </div>
              ${drafterPicker()}
              <div class="gf-ai-author-actions">
                <button class="gf-btn" disabled=${!canDraft || drafting} onClick=${() => runDraft('draft')}><i class="fas fa-feather"></i> Draft</button>
                <button class="gf-btn" disabled=${!canDraft || drafting} onClick=${() => runDraft('improve')}><i class="fas fa-arrow-trend-up"></i> Improve</button>
                <button class="gf-btn" disabled=${!canDraft || drafting} onClick=${() => runDraft('review')}><i class="fas fa-magnifying-glass"></i> Review</button>
                <button class="gf-btn" disabled=${!canDraft || drafting} onClick=${() => runDraft('watch')}><i class="fas fa-triangle-exclamation"></i> Watch-for</button>
              </div>
              ${activity()}
              ${suggestion && html`
                <div class="gf-ai-suggestion">
                  <div class="gf-ai-suggestion-head"><strong>Draft suggestion</strong><span>${suggestion.authoring.modelDisplayLabel}</span></div>
                  <h3>${suggestion.title}</h3>
                  <p>${suggestion.prompt}</p>
                  ${suggestion.watchFor && html`<p class="gf-watch"><b>Watch for:</b> ${suggestion.watchFor}</p>`}
                  ${suggestion.reviewNotes.length > 0 && html`<ul>${suggestion.reviewNotes.map(note => html`<li>${note}</li>`)}</ul>`}
                  <div class="gf-ai-apply">
                    <button class="gf-btn gf-primary" onClick=${() => applySuggestion('all')}>Replace all fields</button>
                    <button class="gf-btn" onClick=${() => applySuggestion('prompt')}>Title + prompt</button>
                    <button class="gf-btn" onClick=${() => applySuggestion('watch')}>Watch-for only</button>
                    <button class="gf-btn" onClick=${() => { setSuggestion(null); setDraftRaw(''); }}>Discard</button>
                  </div>
                </div>`}
            </section>
            <div class="gf-modal-actions">
              <button class="gf-btn" onClick=${close}>Cancel</button>
              <button class="gf-btn gf-primary" disabled=${drafting || !title.trim() || !prompt.trim()} onClick=${save}>
                ${initial ? 'Save new version' : 'Save prompt'}
              </button>
            </div>
          </div>`}
      </div>
    </div>`;
}

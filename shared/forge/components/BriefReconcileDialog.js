import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ProjectLibraryPicker } from './ProjectLibraryPicker.js';
import { AGENTS } from '../../services/agent-backend.js';
import {
  briefFieldDiff,
  libraryChange,
  reconcileBrief,
  reconcileBriefWithAgent,
  reconciliationProvenance,
} from '../services/briefReconciliation.js';

function display(value) {
  if (Array.isArray(value)) return value.join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value ?? '');
}

export function BriefReconcileDialog({
  brief,
  domain,
  domainLabel,
  appTitle,
  appId,
  hasRoot = true,
  backend = 'model',
  providerId,
  modelId,
  agentId,
  agentModel,
  runAgent,
  modelDisplayLabel,
  normalizeBrief = value => value,
  canSaveVersion = false,
  onApply,
  onSaveVariant,
  onSaveVersion,
  onClose,
}) {
  const baseline = useRef(structuredClone(brief)).current;
  const [candidate, setCandidate] = useState(() => structuredClone(brief));
  const [mode, setMode] = useState('preserve');
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState('');
  const controllerRef = useRef(null);
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);
  useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);

  const changes = useMemo(() => briefFieldDiff(baseline, candidate), [baseline, candidate]);
  const libraries = libraryChange(baseline.libraries, candidate.libraries);
  const usesAgent = backend === 'agent';
  const agentLabel = AGENTS.find(agent => agent.id === agentId)?.label || agentId || 'CLI agent';
  const canAdapt = usesAgent
    ? !!hasRoot && !!appId && !!agentId && typeof runAgent === 'function'
    : !!providerId && !!modelId;
  const executionLabel = usesAgent
    ? `${agentLabel} · ${agentModel || 'CLI default'}`
    : (modelDisplayLabel || modelId || 'No in-app model selected');
  const patch = field => event => {
    setCandidate(current => ({ ...current, [field]: event.target.value }));
    setResult(null);
  };

  const normalizeCandidate = value => ({
    ...baseline,
    ...normalizeBrief({
      ...baseline,
      ...value,
      libraries: value.libraries,
    }, baseline),
    libraries: value.libraries,
  });
  const normalizedCandidate = () => normalizeCandidate(candidate);

  const adapt = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setRaw('');
    setError('');
    setResult(null);
    try {
      const options = {
        brief: normalizedCandidate(),
        domain,
        domainLabel,
        mode,
        previousLibraries: baseline.libraries,
        selectedLibraries: candidate.libraries,
        intent,
        providerId,
        modelId,
        appTitle,
        signal: controller.signal,
        onChunk: setRaw,
      };
      const next = usesAgent
        ? await reconcileBriefWithAgent({
            ...options,
            appId,
            agentId,
            agentModel,
            runAgent,
          })
        : await reconcileBrief(options);
      const normalized = normalizeCandidate({
        ...next.brief,
        libraries: candidate.libraries,
      });
      setCandidate(normalized);
      setResult(next);
    } catch (caught) {
      if (caught?.name !== 'AbortError') setError(caught.message);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  const resolved = () => {
    const value = normalizedCandidate();
    if (!value.title?.trim() || !value.prompt?.trim()) throw new Error('Title and prompt are required.');
    const provenance = reconciliationProvenance({
      parent: baseline,
      mode,
      intent,
      previousLibraries: baseline.libraries,
      selectedLibraries: value.libraries,
      backend,
      providerId,
      modelId,
      agentId,
      agentModel,
      modelDisplayLabel,
    });
    return {
      ...value,
      authoring: result ? provenance.authoring : {
        source: 'human-edit',
        parentVersion: Number(baseline.promptVersion) || 1,
        editedAt: new Date().toISOString(),
      },
      derivation: {
        ...provenance.derivation,
        kind: result ? 'library-reconciliation' : 'manual-brief-variant',
      },
    };
  };

  const commit = async (kind) => {
    setError('');
    setSaving(kind);
    try {
      const value = resolved();
      if (kind === 'run') onApply(value);
      else if (kind === 'variant') onApply(await onSaveVariant(value));
      else onApply(await onSaveVersion(value));
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving('');
    }
  };

  return html`
    <div class="gf-modal-backdrop">
      <div class="gf-modal gf-prompt-modal forge-brief-dialog" role="dialog" aria-modal="true"
        aria-label="Brief and libraries" onClick=${event => event.stopPropagation()}>
        <div class="gf-prompt-dialog-head">
          <div>
            <h2>Brief & libraries</h2>
            <p>Edit directly, or ask a model to reconcile the complete brief with the selected libraries.</p>
          </div>
          <button class="gf-icon-btn" title="Close brief editor" onClick=${onClose}>
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <div class="gf-full-editor forge-brief-editor">
          <section class="forge-brief-fields">
            <label>Title
              <input value=${candidate.title || ''} onInput=${patch('title')} />
            </label>
            <label>Build prompt
              <textarea rows="12" value=${candidate.prompt || ''} onInput=${patch('prompt')}></textarea>
            </label>
            <label>Watch for
              <textarea rows="5" value=${candidate.watchFor || ''} onInput=${patch('watchFor')}></textarea>
            </label>
          </section>

          <section class="forge-brief-libraries">
            <${ProjectLibraryPicker}
              value=${candidate.libraries || []}
              onChange=${value => {
                setCandidate(current => ({ ...current, libraries: value }));
                setResult(null);
              }}
              domain=${domain}
              targetStack=${candidate.targetStack || 'web'}
            />
          </section>

          <section class="forge-brief-ai">
            <div>
              <h3>Adapt with AI</h3>
              <p>The selected Build backend rewrites the complete brief. You review the field-level changes before saving.</p>
              <p class="gf-muted"><b>Using:</b> ${executionLabel}</p>
            </div>
            <div class="gf-mode-switch">
              <button class=${mode === 'preserve' ? 'active' : ''}
                onClick=${() => setMode('preserve')}>Preserve concept</button>
              <button class=${mode === 'transform' ? 'active' : ''}
                onClick=${() => setMode('transform')}>Transform concept</button>
            </div>
            <label>Optional intent
              <textarea rows="3" value=${intent} onInput=${event => setIntent(event.target.value)}
                placeholder="For example: turn the sprite presentation into a fully 3D rail shooter."></textarea>
            </label>
            ${!canAdapt ? html`
              <div class="gf-ai-error">${usesAgent
                ? 'Select a CLI backend on the Build screen and connect a data root. Manual editing still works.'
                : 'Select an in-app provider model in the Forge toolbar. Manual editing still works.'}</div>` : ''}
            <button class="gf-btn btn-generate" disabled=${busy || !canAdapt}
              onClick=${adapt}>
              <i class=${`fas ${busy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
              ${busy ? 'Reconciling…' : 'Adapt brief'}
            </button>
            ${busy && raw && html`<pre class="gf-ai-stream">${raw}</pre>`}
            ${result?.summary && html`<div class="gf-done"><i class="fas fa-check"></i> ${result.summary}</div>`}
            ${result?.conflicts?.length > 0 && html`
              <div class="gf-warn"><b>Conflicts resolved:</b> ${result.conflicts.join(' · ')}</div>`}
          </section>

          <section class="forge-brief-review">
            <h3>Review changes</h3>
            ${libraries.changed && !result && html`
              <div class="gf-warn">The library selection changed. Adapt the brief or edit its wording before building.</div>`}
            ${changes.length ? changes.map(change => html`
              <details open=${change.field === 'prompt' || change.field === 'libraries'}>
                <summary>${change.field}</summary>
                <div class="forge-brief-diff">
                  <div><b>Before</b><pre>${display(change.before)}</pre></div>
                  <div><b>After</b><pre>${display(change.after)}</pre></div>
                </div>
              </details>`) : html`<p class="gf-muted">No changes yet.</p>`}
          </section>
          ${error && html`<div class="gf-ai-error">${error}</div>`}
        </div>

        <div class="gf-wizard-actions">
          <span>Seed prompts stay immutable. Saved variants contain a complete resolved snapshot.</span>
          <div>
            <button class="gf-btn" disabled=${!!saving || busy} onClick=${onClose}>Cancel</button>
            <button class="gf-btn" disabled=${!!saving || busy || !changes.length}
              onClick=${() => commit('run')}>Use for this run</button>
            ${canSaveVersion && html`
              <button class="gf-btn" disabled=${!!saving || busy || !changes.length}
                onClick=${() => commit('version')}>Save new version</button>`}
            <button class="gf-btn gf-primary" disabled=${!!saving || busy || !changes.length}
              onClick=${() => commit('variant')}>
              ${saving === 'variant' ? 'Saving…' : 'Save as variant'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// Unified in-app provider + local CLI model picker.
// Apps keep backend state at the top level; this component only presents the
// available choices through the existing grouped model-selector UI.

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ProviderModelSelector } from './ProviderModelSelector.js';
import {
  AGENTS,
  getAgentModelEffort,
  groupAgentModelOptions,
  isAgentBridgeReachable,
  listAgentModelOptions,
  resolveAgentModelSelection,
  saveAgentModelEffort,
} from '../services/agent-backend.js';
import {
  buildExecutorModels,
  buildExecutorMetadata,
  CLI_DEFAULT_MODEL,
  CLI_PROVIDER_PREFIX,
  decodeExecutorSelection,
} from '../services/executor-models.js';

export { buildExecutorModels, buildExecutorMetadata, CLI_DEFAULT_MODEL, CLI_PROVIDER_PREFIX, decodeExecutorSelection };

const EFFORT_LABELS = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra',
};

export function ExecutorModelSelector({
  models = [],
  backend = 'model',
  providerId = '',
  modelId = '',
  agentId = 'claude-code',
  agentModelId = '',
  onChange,
  disabled = false,
  loading = false,
  onSettingsClick,
}) {
  const [agentModels, setAgentModels] = useState({});
  const [effortRevision, setEffortRevision] = useState(0);
  // null while probing, so the CLI rows never flicker in and out on load.
  const [bridgeReachable, setBridgeReachable] = useState(null);

  useEffect(() => {
    let live = true;
    isAgentBridgeReachable().then(async (reachable) => {
      if (!live) return;
      setBridgeReachable(reachable);
      if (!reachable) return;
      const entries = await Promise.all(AGENTS.map(async agent => [agent.id, await listAgentModelOptions(agent.id)]));
      if (live) setAgentModels(Object.fromEntries(entries));
    });
    return () => { live = false; };
  }, []);

  // An agent chosen in a previous session is meaningless without the bridge;
  // hand the app back its own provider selection instead of a dead row.
  useEffect(() => {
    if (bridgeReachable === false && backend === 'agent') {
      onChange?.(decodeExecutorSelection(providerId, modelId));
    }
  }, [bridgeReachable, backend, providerId, modelId, onChange]);

  const allModels = useMemo(
    () => buildExecutorModels(models, agentModels, { bridgeReachable: bridgeReachable !== false }),
    [models, agentModels, bridgeReachable],
  );
  const selectedProviderId = backend === 'agent' ? `${CLI_PROVIDER_PREFIX}${agentId}` : providerId;
  const choices = backend === 'agent' ? groupAgentModelOptions(agentModels[agentId] || []) : [];
  const storedEffort = useMemo(
    () => getAgentModelEffort(agentId, agentModelId),
    [agentId, agentModelId, effortRevision],
  );
  const agentSelection = resolveAgentModelSelection(
    agentModelId,
    storedEffort,
    choices,
  );
  const selectedModelId = backend === 'agent' ? (agentSelection.modelId || CLI_DEFAULT_MODEL) : modelId;
  const selectedChoice = choices.find(choice => choice.id === agentSelection.modelId);
  const effortOptions = selectedChoice?.efforts || [];
  const fixedEffort = selectedChoice?.fixedEffort || '';
  const selectedEffort = effortOptions.includes(agentSelection.effort)
    ? agentSelection.effort
    : (selectedChoice?.defaultEffort || effortOptions[0] || '');
  const effortDescription = selectedChoice?.effortDescriptions?.[selectedEffort] || '';

  const handleModelChange = (nextProviderId, nextModelId) => {
    const next = decodeExecutorSelection(nextProviderId, nextModelId);
    if (next.backend === 'agent' && next.modelId) {
      const nextChoices = groupAgentModelOptions(agentModels[next.agentId] || []);
      const nextChoice = nextChoices.find(choice => choice.id === next.modelId);
      const nextEffort = getAgentModelEffort(next.agentId, next.modelId, nextChoice?.defaultEffort || '');
      if (nextEffort) saveAgentModelEffort(next.agentId, next.modelId, nextEffort);
    }
    onChange?.(next);
  };

  const handleEffortChange = (event) => {
    if (!saveAgentModelEffort(agentId, agentSelection.modelId, event.target.value)) return;
    setEffortRevision(value => value + 1);
  };

  return html`
    <div class="executor-model-controls">
      <${ProviderModelSelector}
        models=${allModels}
        providerId=${selectedProviderId}
        modelId=${selectedModelId}
        onChange=${handleModelChange}
        disabled=${disabled || allModels.length === 0}
        loading=${loading && backend !== 'agent'}
        onSettingsClick=${onSettingsClick}
      />
      ${backend === 'agent' && (effortOptions.length > 0 || fixedEffort) && html`
        <label class="executor-effort" title=${effortDescription || 'Reasoning effort'}>
          <span class="sr-only">Reasoning effort</span>
          ${fixedEffort
            ? html`<select value=${fixedEffort} disabled><option value=${fixedEffort}>Thinking (fixed)</option></select>`
            : html`<select value=${selectedEffort} onChange=${handleEffortChange} disabled=${disabled || effortOptions.length === 1}>
                ${effortOptions.map(level => html`
                  <option value=${level}>${EFFORT_LABELS[level] || level}${level === selectedChoice?.defaultEffort ? ' (default)' : ''}${effortOptions.length === 1 ? ' (fixed)' : ''}</option>`)}
              </select>`}
        </label>`}
    </div>
  `;
}

// Unified in-app provider + local CLI model picker.
// Apps keep backend state at the top level; this component only presents the
// available choices through the existing grouped model-selector UI.

import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ProviderModelSelector } from './ProviderModelSelector.js';
import { AgentEffortSelect, seedAgentModelEffort } from './AgentEffortSelect.js';
import {
  AGENTS,
  getAgentModelEffort,
  groupAgentModelOptions,
  isAgentBridgeReachable,
  listAgentModelOptions,
  resolveAgentModelSelection,
} from '../services/agent-backend.js';
import {
  buildExecutorModels,
  buildExecutorMetadata,
  CLI_DEFAULT_MODEL,
  CLI_PROVIDER_PREFIX,
  decodeExecutorSelection,
} from '../services/executor-models.js';

export { buildExecutorModels, buildExecutorMetadata, CLI_DEFAULT_MODEL, CLI_PROVIDER_PREFIX, decodeExecutorSelection };

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
  const agentSelection = resolveAgentModelSelection(
    agentModelId,
    getAgentModelEffort(agentId, agentModelId),
    choices,
  );
  const selectedModelId = backend === 'agent' ? (agentSelection.modelId || CLI_DEFAULT_MODEL) : modelId;

  const handleModelChange = (nextProviderId, nextModelId) => {
    const next = decodeExecutorSelection(nextProviderId, nextModelId);
    if (next.backend === 'agent') {
      seedAgentModelEffort(next.agentId, next.modelId, groupAgentModelOptions(agentModels[next.agentId] || []));
    }
    onChange?.(next);
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
      ${backend === 'agent' && html`
        <${AgentEffortSelect}
          agentId=${agentId}
          modelId=${agentSelection.modelId}
          choices=${choices}
          disabled=${disabled}
        />`}
    </div>
  `;
}

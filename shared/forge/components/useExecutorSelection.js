// One executor picker for a Forge: in-app models and local CLI agents together.
//
// A CLI row is a build *backend* — the tool-calling build loop cannot drive it
// as a provider — so a selection is routed into the app's backend state here,
// and a CLI agent left stored as the in-app provider is repaired on sight
// (otherwise every build dies on "tool-calling requests are not supported").
// Apps keep the state at the top level; this only owns the wiring.

import { useCallback, useEffect } from 'preact/hooks';
import { repairExecutorSelection } from '../../services/executor-models.js';

/**
 * @returns {(selection: object) => void} `onChange` for `ExecutorModelSelector`.
 */
export function useExecutorSelection({
  backend, providerId, modelId, providerModels,
  setBackend, setAgentId, setAgentModels, setProviderId, setModelId,
}) {
  const handleExecutorChange = useCallback((selection) => {
    if (selection.backend === 'agent') {
      setBackend('agent');
      setAgentId(selection.agentId);
      setAgentModels(prev => ({ ...prev, [selection.agentId]: selection.modelId || '' }));
      return;
    }
    setBackend('model');
    setProviderId(selection.providerId);
    setModelId(selection.modelId);
  }, [setBackend, setAgentId, setAgentModels, setProviderId, setModelId]);

  useEffect(() => {
    const repaired = repairExecutorSelection({ backend, providerId, modelId, providerModels });
    if (!repaired) return;
    if (repaired.agent) handleExecutorChange(repaired.agent);
    setProviderId(repaired.providerId);
    setModelId(repaired.modelId);
  }, [backend, providerId, modelId, providerModels, handleExecutorChange, setProviderId, setModelId]);

  return handleExecutorChange;
}

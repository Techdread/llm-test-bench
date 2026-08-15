// Pure helpers for presenting provider/local models and local CLI agents in one picker.

import { AGENTS, groupAgentModelOptions } from './agent-backend.js';

export const CLI_PROVIDER_PREFIX = 'cli-agent:';
export const CLI_DEFAULT_MODEL = '__cli_default__';

/**
 * Merge the provider models with one row per local CLI agent. When the bridge
 * is unreachable the CLI rows are omitted entirely rather than offered and
 * failing on use.
 */
export function buildExecutorModels(providerModels = [], agentModels = {}, { bridgeReachable = true } = {}) {
  if (!bridgeReachable) return providerModels.filter(model => model.providerType !== 'cli-agent');
  // Rebuild synthetic rows from the bridge catalogue so effort variants can be
  // grouped and capability metadata is never lost to a stale provider cache.
  const providerOnly = providerModels.filter(model => model.providerType !== 'cli-agent');
  const cliModels = AGENTS.flatMap(agent => {
    const models = groupAgentModelOptions(agentModels[agent.id] || []);
    return [
      {
        providerId: `${CLI_PROVIDER_PREFIX}${agent.id}`,
        providerName: `${agent.label} CLI`,
        providerType: 'cli-agent',
        modelId: CLI_DEFAULT_MODEL,
        name: 'CLI default',
        displayLabel: `${agent.label} CLI / default`,
        raw: {},
      },
      ...models.map(model => ({
        providerId: `${CLI_PROVIDER_PREFIX}${agent.id}`,
        providerName: `${agent.label} CLI`,
        providerType: 'cli-agent',
        modelId: model.id,
        name: model.label || model.id,
        displayLabel: `${agent.label} CLI / ${model.label || model.id}`,
        raw: { ...model, agentId: agent.id },
      })),
    ];
  });
  return [...providerOnly, ...cliModels];
}

export function decodeExecutorSelection(providerId, modelId) {
  if (String(providerId || '').startsWith(CLI_PROVIDER_PREFIX)) {
    return {
      backend: 'agent',
      agentId: providerId.slice(CLI_PROVIDER_PREFIX.length),
      modelId: modelId === CLI_DEFAULT_MODEL ? '' : modelId,
    };
  }
  return { backend: 'model', providerId, modelId };
}

/** Build the durable, human-readable metadata snapshot for one selection. */
export function buildExecutorMetadata({
  backend = 'model',
  providerId = '',
  modelId = '',
  agentId = 'claude-code',
  agentModelId = '',
  providerModels = [],
} = {}) {
  if (backend === 'agent') {
    const agent = AGENTS.find(item => item.id === agentId);
    if (!agent) return null;
    const modelName = agentModelId || `${agent.label} CLI default`;
    return {
      backend: 'cli-agent',
      providerId: `${CLI_PROVIDER_PREFIX}${agent.id}`,
      providerName: `${agent.label} CLI`,
      providerType: 'cli-agent',
      agentId: agent.id,
      model: modelName,
      modelId: agentModelId || '',
      modelName,
      modelDisplayLabel: `${agent.label} CLI / ${agentModelId || 'default'}`,
    };
  }

  if (!providerId || !modelId) return null;
  const selected = providerModels.find(model => model.providerId === providerId && model.modelId === modelId);
  const modelName = selected?.name || modelId;
  return {
    backend: 'model',
    providerId,
    providerName: selected?.providerName || providerId,
    providerType: selected?.providerType || '',
    model: modelId,
    modelId,
    modelName,
    modelDisplayLabel: selected?.displayLabel || `${selected?.providerName || providerId} / ${modelName}`,
  };
}

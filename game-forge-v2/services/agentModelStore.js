// Promoted to shared/forge/services/agentModelStore.js (spec 305 / 328 kernel
// slice). Bound to Game Forge V2's data root, so agent-models.json stays where
// it already is.
import { createAgentModelStore } from '../../shared/forge/services/agentModelStore.js';
import { getAppRoot } from './runStore.js';

export { parseModelList } from '../../shared/forge/services/agentModelStore.js';

const store = createAgentModelStore(getAppRoot);

export const { loadAgentModels, saveAgentModels } = store;

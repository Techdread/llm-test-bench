// Promoted to shared/forge/services/agentTools.js (spec 305 / 328 kernel slice).
// This shim keeps Game Forge V2's imports and its media-generation app id valid.
export {
  DEFAULT_CAPABILITY_POLICIES,
  TOOLS,
  TOOL_CAPABILITIES,
  getOpenAIToolsArray,
  normalizeToolArgs,
  runTool,
} from '../../shared/forge/services/agentTools.js';

export const APP_ID = 'game-forge-v2';

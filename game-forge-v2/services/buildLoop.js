// Promoted to shared/forge/services/buildLoop.js (spec 305 / 328 kernel slice).
// This shim keeps Game Forge V2's imports valid. The shared loop's app-identity
// defaults are still Game Forge V2's, so its behaviour is unchanged.
export {
  GAME_SYSTEM_PROMPT,
  WEB_SYSTEM_PROMPT,
  buildTask,
  compactToolHistory,
  createProgressTracker,
  inspectProjectCompletion,
  runBuild,
  systemPromptForStack,
} from '../../shared/forge/services/buildLoop.js';

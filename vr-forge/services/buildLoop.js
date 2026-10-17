// Promoted to shared/forge/services/buildLoop.js (spec 305 / 328 kernel slice).
// This shim keeps VR Forge's imports valid. The shared loop's app-identity
// defaults are still VR Forge's, so its behaviour is unchanged.
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

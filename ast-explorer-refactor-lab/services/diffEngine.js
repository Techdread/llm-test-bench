// Thin re-export of the shared diff-engine. The original local implementation
// has been promoted to shared/services/diff-engine.js (spec 59).
//
// Note: `buildHunks` is now async (it lazy-loads jsdiff from shared/lib). Callers
// must `await` it. `applyHunks` and `summariseHunks` remain synchronous.

export {
  buildHunks,
  applyHunks,
  summariseHunks,
} from '../../shared/services/diff-engine.js';

// Promoted to shared/forge/services/runStore.js (spec 305 / 328 kernel slice).
// This shim binds VR Forge's data-root namespace and slug default, so its
// imports and every already-saved run folder stay exactly as they were.
import { createRunStore } from '../../shared/forge/services/runStore.js';

const store = createRunStore({ appId: 'vr-forge', defaultSlug: 'project', readableRunNames: true });

export const {
  getAppRoot, slugify, createRun, writeMeta, patchMeta, writeTrace, readTrace,
  createTraceAppender, writeValidation, readValidation, writeRunArtifact,
  readRunArtifact, readMeta, listGames, listRuns, getProjectHandle,
  getRunHandles, updateMeta,
} = store;

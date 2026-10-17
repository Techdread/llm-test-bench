// Promoted to shared/forge/services/projectWorkbench.js (spec 305 / 328 kernel
// slice). The two Game-Forge-specific defaults (ZIP filename and editor-handoff
// source label) are re-bound here so nothing user-visible changes.
import {
  downloadProjectZip as sharedDownloadProjectZip,
  openProjectInCodeMorphLab as sharedOpenProjectInCodeMorphLab,
} from '../../shared/forge/services/projectWorkbench.js';

export {
  EVALUATION_CRITERIA,
  copyProject,
  createProjectZip,
  diffProjects,
  evaluationAverage,
  isTextPath,
  iterationMetadata,
  iterationTask,
  normalizeEvaluation,
  projectManifest,
  projectZipEntries,
  readProjectText,
  textFingerprint,
  writeProjectFile,
} from '../../shared/forge/services/projectWorkbench.js';

export function downloadProjectZip(projectHandle, filename = 'game-forge-project.zip') {
  return sharedDownloadProjectZip(projectHandle, filename);
}

export function openProjectInCodeMorphLab(projectHandle, options = {}) {
  return sharedOpenProjectInCodeMorphLab(projectHandle, {
    title: 'Game Forge project', source: 'Game Forge V2', ...options,
  });
}

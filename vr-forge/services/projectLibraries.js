// VR Forge compatibility shim over the shared Forge library platform.

export {
  PROJECT_LIBRARIES,
  PROJECT_LIBRARY_GROUPS,
  ProjectLibraryProvisionError,
  clearProjectLibraryGroup,
  isVendoredLibraryPath,
  librariesFor,
  librarySelectionErrors,
  normalizeLibraryIds,
  projectLibrariesForDomain,
  selectProjectLibrary,
  sha256Hex,
  unknownLibraryIds,
  vendoredLibraryPaths,
  verifyProjectLibraries,
  withProjectLibraryBudget,
} from '../../shared/forge/services/projectLibraries.js';

import {
  libraryBriefing as sharedLibraryBriefing,
  projectLibraryValidationIssues as sharedValidationIssues,
  provisionProjectLibraries as sharedProvisionProjectLibraries,
} from '../../shared/forge/services/projectLibraries.js';

export function libraryBriefing(value) {
  return sharedLibraryBriefing(value, { domain: 'vr' });
}

export function provisionProjectLibraries(projectHandle, value, options = {}) {
  return sharedProvisionProjectLibraries(projectHandle, value, {
    domain: 'vr',
    ...options,
  });
}

export function projectLibraryValidationIssues(projectHandle, value, options = {}) {
  return sharedValidationIssues(projectHandle, value, {
    domain: 'vr',
    targetStack: 'web',
    ...options,
  });
}

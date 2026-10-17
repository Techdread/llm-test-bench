// Runtime distribution flags read from the root <html> element.
//
// The private DevTools Hub does not set these attributes, so every existing
// capability remains enabled. Small public exports can opt out of cross-app
// handoffs without carrying placeholder apps that would only lead to 404s:
//
//   <html data-distribution="public" data-cross-app-handoffs="off">
//
// When some target apps *are* published, the build lists them and handoffs to
// exactly those stay on:
//
//   <html … data-cross-app-handoffs="off" data-handoff-targets="code-morph-lab-v3">

// Keep the document injectable so this service remains deterministic in Node.

export function distributionName(documentRef = globalThis.document) {
  return documentRef?.documentElement?.dataset?.distribution || 'private-hub';
}

export function isPublicDistribution(documentRef = globalThis.document) {
  return distributionName(documentRef) === 'public';
}

/**
 * @param {Document} [documentRef]
 * @param {string} [targetApp]  The receiving app's folder name. Given one, a
 *   distribution that switched handoffs off still allows it when the target is
 *   listed in `data-handoff-targets` (i.e. it was published alongside).
 */
export function crossAppHandoffsEnabled(documentRef = globalThis.document, targetApp = '') {
  const dataset = documentRef?.documentElement?.dataset;
  const value = dataset?.crossAppHandoffs;
  if (value === 'on') return true;
  if (value === 'off') {
    if (!targetApp) return false;
    return String(dataset?.handoffTargets || '').split(/\s+/).includes(targetApp);
  }
  return !isPublicDistribution(documentRef);
}

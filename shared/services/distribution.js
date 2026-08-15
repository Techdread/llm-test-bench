// Runtime distribution flags read from the root <html> element.
//
// The private DevTools Hub does not set these attributes, so every existing
// capability remains enabled. Small public exports can opt out of cross-app
// handoffs without carrying placeholder apps that would only lead to 404s:
//
//   <html data-distribution="public" data-cross-app-handoffs="off">

// Keep the document injectable so this service remains deterministic in Node.

export function distributionName(documentRef = globalThis.document) {
  return documentRef?.documentElement?.dataset?.distribution || 'private-hub';
}

export function crossAppHandoffsEnabled(documentRef = globalThis.document) {
  const value = documentRef?.documentElement?.dataset?.crossAppHandoffs;
  if (value === 'on') return true;
  if (value === 'off') return false;
  return distributionName(documentRef) !== 'public';
}

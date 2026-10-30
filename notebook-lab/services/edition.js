// What the public web edition of Notebook Lab leaves out.
//
// The private hub runs every cell kind. The public site (neuroviz.uk) is a
// static host: Java, Go and Scala compile inside the Debian v86 guest,
// whose disk image cannot be served from it, and Rust runs by posting the code
// to play.rust-lang.org, a third-party request the site promises not to make.
// One list drives every place that offers or runs a cell kind, and the public
// builder (tools/build-public-mvp.mjs) imports it to drop bundled notebooks
// that use any of these kinds. Clojure runs in the browser (Scittle), so it stays.
//
// DOM-free: the document is injectable, so node tests and the builder can
// call it. Without a document this reports the private hub.

import { isPublicDistribution } from '../../shared/services/distribution.js';

export const PUBLIC_UNAVAILABLE_KINDS = Object.freeze(['rust', 'java', 'go', 'scala']);

/** Notebook opened on a first visit to the public edition (no draft, no link). */
export const PUBLIC_START_TUTORIAL = 'tutorial-01-notebook-basics.json';

export function isWebEdition(documentRef = globalThis.document) {
  return isPublicDistribution(documentRef);
}

export function unavailableKinds(documentRef = globalThis.document) {
  return new Set(isWebEdition(documentRef) ? PUBLIC_UNAVAILABLE_KINDS : []);
}

export function kindAvailable(kind, documentRef = globalThis.document) {
  return !unavailableKinds(documentRef).has(kind);
}

/** Keep only the options whose kind this edition can run. */
export function availableKindOptions(options, key = 'kind', documentRef = globalThis.document) {
  const missing = unavailableKinds(documentRef);
  return options.filter(option => !missing.has(option[key]));
}

export function unavailableKindMessage(kind) {
  return `${kind} cells need the full Notebook Lab: the web edition runs JavaScript, Python, C, Lua, Clojure, SQL, HTML, controls and charts in your browser.`;
}

/** Cell kinds a notebook uses (markdown included). */
export function notebookKinds(notebook) {
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
  return new Set(cells.map(cell => cell?.kind || 'md'));
}

/** Kinds in `notebook` that the given edition cannot run. Empty = runs fully. */
export function missingKinds(notebook, missing = PUBLIC_UNAVAILABLE_KINDS) {
  const blocked = new Set(missing);
  return [...notebookKinds(notebook)].filter(kind => blocked.has(kind)).sort();
}

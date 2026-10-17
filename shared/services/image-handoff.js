// Cross-app image handoff.
//
// Shim over hub-pipes.js (spec 246 Milestone 1). The IDB-blob transport
// mechanism is now shared with audio-handoff via createBlobTransport().
// Public API, IndexedDB name (`devtools-hub-image-handoff`), localStorage
// pointer prefix (`devtools-hub-image-handoff:`), TTL, and the
// IMAGE_HANDOFF_TARGETS registry are all unchanged.
//
// Adding a new receiver is the same as before:
//   1. Register in IMAGE_HANDOFF_TARGETS below.
//   2. Call takeImageHandoff(<own appId>) at boot.

import { createBlobTransport, navigateToLab, logExecution } from './hub-pipes.js';

const _transport = createBlobTransport({
  dbName: 'devtools-hub-image-handoff',
  lsPrefix: 'devtools-hub-image-handoff:',
  idPrefix: 'ho',
});

export const IMAGE_HANDOFF_TARGETS = [
  {
    id: 'character-mesh-foundry',
    label: 'Mesh Foundry',
    icon: 'fa-cube',
    description: 'Open in Character Mesh Foundry as a fresh image variant — ready to drive a 3D mesh job.',
    path: '',
  },
  {
    id: 'sprite-studio',
    label: 'Sprite Studio',
    icon: 'fa-table-cells-large',
    description: 'Open in Sprite Studio as a new sprite (RGBA) — quantise to a palette and edit.',
    path: '',
  },
  {
    id: 'pixel-art-editor',
    label: 'Pixel Art Editor',
    icon: 'fa-paintbrush',
    description: 'Open in the Pixel Art Editor as a stencil underlay — trace it as pixel art or convert it to pixels.',
    path: '',
  },
  {
    id: 'composition-studio',
    label: 'Composition Studio',
    icon: 'fa-object-group',
    description: 'Open in Composition Studio as a reference underlay — trace an Ideogram 4 layout over it.',
    path: '',
  },
  {
    id: 'understory-studio',
    label: 'Understory Studio',
    icon: 'fa-cube',
    description: 'Open in Understory Studio as a reference picture — the model designs an editable, multi-level 3D asset from it.',
    path: '',
  },
  {
    id: 'image-to-mesh-modly',
    label: 'Image-to-Mesh',
    icon: 'fa-cube',
    description: 'Open in Image-to-Mesh (Modly) as the source image — reconstruct a real .glb mesh via Trellis2 and MeshFlow it.',
    path: '',
  },
];

/**
 * Send a blob + metadata to a target app and navigate there. See the
 * original handoff doc for the full set of optional fields — Milestone 1
 * preserves the shape verbatim.
 *
 * @param {object} opts
 * @param {Blob}   opts.blob              Required.
 * @param {string} opts.targetApp         Required — receiver's URL path segment.
 * @param {string} opts.source            Required — sender's app id.
 * @param {string} [opts.fileName]
 * @param {boolean} [opts.navigate=true]
 * @param {string} [opts.targetPath]
 * @param {string} [opts.prompt]
 * @param {string} [opts.subject]
 * @param {string} [opts.style]
 * @param {string} [opts.styleId]
 * @param {string} [opts.styleLabel]
 * @param {string} [opts.negativePrompt]
 * @param {string} [opts.modelType]
 * @param {string} [opts.modelLabel]
 * @param {string} [opts.providerId]
 * @param {string} [opts.providerName]
 * @param {string} [opts.nodeId]
 * @param {string} [opts.nodeName]
 * @param {number} [opts.seed]
 * @param {string} [opts.resolution]
 * @param {string} [opts.size]
 * @param {string} [opts.jobId]
 * @param {number} [opts.computeMs]
 * @param {number} [opts.queuedMs]
 * @param {string} [opts.notes]
 * @param {object} [opts.extra]
 */
export async function sendImageToApp(opts) {
  if (!opts || !opts.blob || !(opts.blob instanceof Blob)) {
    throw new Error('sendImageToApp: opts.blob (Blob) is required');
  }
  if (!opts.targetApp) throw new Error('sendImageToApp: opts.targetApp is required');
  if (!opts.source)    throw new Error('sendImageToApp: opts.source is required');

  const payload = {
    targetApp: opts.targetApp,
    source: opts.source,
    fileName: opts.fileName || 'image.png',
    blob: opts.blob,
    blobMime: opts.blob.type || 'image/png',
    blobSize: opts.blob.size,
    prompt: opts.prompt || '',
    subject: opts.subject || '',
    style: opts.style || '',
    styleId: opts.styleId || '',
    styleLabel: opts.styleLabel || '',
    negativePrompt: opts.negativePrompt || '',
    modelType: opts.modelType || '',
    modelLabel: opts.modelLabel || '',
    providerId: opts.providerId || '',
    providerName: opts.providerName || '',
    nodeId: opts.nodeId || '',
    nodeName: opts.nodeName || '',
    seed: Number.isFinite(opts.seed) ? opts.seed : null,
    resolution: opts.resolution || '',
    size: opts.size || '',
    jobId: opts.jobId || '',
    computeMs: Number.isFinite(opts.computeMs) ? opts.computeMs : null,
    queuedMs: Number.isFinite(opts.queuedMs) ? opts.queuedMs : null,
    notes: opts.notes || '',
    extra: opts.extra || null,
  };

  const { id } = await _transport.stash({
    targetApp: opts.targetApp,
    source: opts.source,
    payload,
  });

  logExecution({
    source: opts.source,
    targetApp: opts.targetApp,
    kind: 'image/static',
    title: payload.fileName,
    meta: { jobId: payload.jobId || null, modelType: payload.modelType || null },
  });

  if (opts.navigate !== false) {
    const target = IMAGE_HANDOFF_TARGETS.find(t => t.id === opts.targetApp);
    const path = opts.targetPath ?? target?.path ?? '';
    navigateToLab({ targetApp: opts.targetApp, hash: path ? `/${path.replace(/^\/+/, '')}` : '' });
  }

  return { id };
}

export function peekImageHandoff(targetApp) { return _transport.peek(targetApp); }
export function takeImageHandoff(targetApp) { return _transport.take(targetApp); }
export function clearImageHandoff(targetApp, id) { return _transport.clear(targetApp, id); }

/** Convert a payload's blob into a File for receivers that work with File. */
export function payloadToFile(payload) {
  if (!payload?.blob) return null;
  return new File(
    [payload.blob],
    payload.fileName || 'image.png',
    { type: payload.blobMime || payload.blob.type || 'image/png' },
  );
}

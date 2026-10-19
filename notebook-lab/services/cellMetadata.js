export function hashSource(source = '') {
  let hash = 2166136261;
  const text = String(source);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildAiMetadata({
  prompt,
  kind,
  providerId,
  modelId,
  useWebSearch,
  source,
  previous,
}) {
  const now = new Date().toISOString();
  return {
    ...(previous || {}),
    prompt,
    kind,
    providerId,
    modelId,
    useWebSearch: !!useWebSearch,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    generatedSourceHash: hashSource(source || ''),
  };
}

export function withAiMetadata(cell, aiMetadata) {
  return {
    ...(cell.metadata || {}),
    ai: aiMetadata,
  };
}

export function withoutAiMetadata(cell) {
  if (!cell.metadata?.ai) return cell.metadata || null;
  const { ai, ...rest } = cell.metadata;
  return Object.keys(rest).length ? rest : null;
}

export function isCellModifiedSinceAi(cell) {
  const ai = cell?.metadata?.ai;
  if (!ai) return false;
  if (ai.kind && cell.kind !== ai.kind) return true;
  if (!ai.generatedSourceHash) return false;
  return hashSource(cell.source || '') !== ai.generatedSourceHash;
}

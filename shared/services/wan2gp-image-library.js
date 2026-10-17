// Shared WAN2GP output-image discovery.
//
// The Agent API keeps its recent jobs (up to the server's configured history
// limit) and exposes every generated file through /api/file. This module turns
// that job history into a provider-neutral image-library shape for reusable UI.

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i;

function filePath(file) {
  if (typeof file === 'string') return file;
  return String(file?.path || file?.file || file?.name || '');
}

function fileName(path) {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'image';
}

function jobId(job) {
  return String(job?.job_id || job?.jobId || job?.id || '');
}

function jobTime(job) {
  const value = job?.completed_at || job?.created_at || job?.generated_at || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Convert WAN2GP job records into newest-first, de-duplicated image entries. */
export function normalizeWan2gpImages(payload) {
  const jobs = Array.isArray(payload)
    ? payload
    : (payload?.jobs || payload?.items || payload?.results || []);
  const seen = new Set();
  const images = [];

  for (const job of jobs) {
    if (String(job?.status || '').toLowerCase() !== 'completed') continue;
    const id = jobId(job);
    const createdAt = jobTime(job);
    const request = job?.request && typeof job.request === 'object' ? job.request : {};
    const files = Array.isArray(job?.files) ? job.files : [];

    files.forEach((file, index) => {
      const path = filePath(file);
      if (!IMAGE_EXTENSION.test(path) || seen.has(path)) return;
      seen.add(path);
      images.push({
        id: `${id || 'job'}:${index}:${path}`,
        jobId: id,
        path,
        name: fileName(path),
        createdAt,
        createdAtIso: job?.completed_at || job?.created_at || '',
        prompt: String(request.prompt || request.text || ''),
        negativePrompt: String(request.negative_prompt || ''),
        modelType: String(job?.model_type || request.model_type || ''),
        capability: String(job?.capability || ''),
        seed: Number.isFinite(request.seed) ? request.seed : null,
        resolution: String(request.resolution || request.size || ''),
      });
    });
  }

  // Array#sort is stable: files emitted by the same job keep the server's
  // output order while jobs themselves remain newest-first.
  return images.sort((a, b) => b.createdAt - a.createdAt);
}

/** Fetch recent output-image metadata from the resolved WAN2GP node. */
export async function listWan2gpImages({ limit = 96, nodeId, appId, signal } = {}) {
  const wan = await import('./wan2gp.js');
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 96));
  const payload = await wan.listJobs(safeLimit, { nodeId, appId, signal });
  return {
    images: normalizeWan2gpImages(payload),
    node: wan.resolveNode({ nodeId, appId }),
    limit: safeLimit,
  };
}

/** Download one selected or thumbnail image as a Blob. */
export async function loadWan2gpImageBlob(image, { nodeId, appId, signal } = {}) {
  if (!image?.path) throw new Error('WAN2GP image path is missing');
  const wan = await import('./wan2gp.js');
  return wan.downloadFile(image.path, { nodeId, appId, signal });
}

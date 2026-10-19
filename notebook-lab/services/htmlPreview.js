export const HTML_PREVIEW_DEFAULTS = {
  width: 1920,
  height: 1080,
  scale: 1,
};

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normaliseHtmlPreview(preview = {}) {
  const value = preview || {};
  return {
    width: Math.round(clampNumber(value.width, 320, 3840, HTML_PREVIEW_DEFAULTS.width)),
    height: Math.round(clampNumber(value.height, 240, 2160, HTML_PREVIEW_DEFAULTS.height)),
    scale: clampNumber(value.scale, 0.25, 2, HTML_PREVIEW_DEFAULTS.scale),
  };
}

export function htmlPreviewForCell(cell) {
  return normaliseHtmlPreview(cell?.metadata?.htmlPreview || {});
}

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

/** Below this width an HTML cell tries the screen's own width before shrinking its design. */
export const PHONE_LAYOUT_MAX = 640;

/**
 * How to show an HTML cell in a shell `shellWidth` pixels wide.
 *
 * On a desktop the cell renders at its design width and is scaled to fit. On a
 * phone that made a 900-pixel design 36% size: unreadable, and too small to tap.
 * So a narrow shell first renders the cell at the shell's own width ("native"),
 * where a fluid layout simply reflows. If the content turned out wider than
 * that (a fixed 800-pixel canvas, say), or the reader asks for the desktop
 * layout, or a scale was chosen by hand, it falls back to the scaled design.
 */
export function htmlFrameLayout({ shellWidth = 0, settings, overflows = false, preferDesktop = false, contentHeight = 0 } = {}) {
  const s = normaliseHtmlPreview(settings);
  const width = Math.max(1, Math.round(shellWidth || s.width));
  const phone = shellWidth > 0 && shellWidth < Math.min(s.width, PHONE_LAYOUT_MAX);
  const native = phone && !preferDesktop && s.scale === 1 && !overflows;
  if (native) {
    // A layout that stacked to fit the width is taller than the design, so the
    // frame grows with it (up to 2.5 times) rather than scrolling inside itself,
    // which traps a finger trying to scroll the page.
    const height = Math.round(Math.min(s.height * 2.5, Math.max(s.height, contentHeight || 0)));
    return { phone, native, overflows, scale: 1, frameWidth: width, frameHeight: height, shellHeight: height };
  }
  const scale = Math.min(1, width / s.width) * s.scale;
  return { phone, native, overflows, scale, frameWidth: s.width, frameHeight: s.height, shellHeight: Math.max(1, Math.ceil(s.height * scale)) };
}

/**
 * Whether a size report from the frame shows content too wide for a phone. Only
 * a report taken while the frame was at the phone's width counts: the first
 * report comes from the desktop-width load, before the shell has been measured.
 */
export function sizeReportOverflows(report, nativeWidth) {
  if (!report || !Number.isFinite(report.width) || !Number.isFinite(report.viewport)) return false;
  return Math.abs(report.viewport - nativeWidth) <= 2 && report.width > report.viewport + 2;
}

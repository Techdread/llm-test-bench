// Shared GIF export utility.
// Renders SVG (or canvas) content to a single-frame GIF and triggers download.
// Uses gifenc (lazy-loaded from shared/lib) for colour quantisation and LZW encoding.

// Use the package's own ESM dist (esm.sh collapses gifenc's
// CJS named exports into a single default, losing quantize/applyPalette).
const GIFENC_URL = new URL('../lib/gifenc/1.0.3/gifenc.esm.js', import.meta.url).href;
let gifencPromise = null;
function loadGifenc() {
  if (!gifencPromise) {
    gifencPromise = import(GIFENC_URL).then(mod => {
      const GIFEncoder = mod.GIFEncoder ?? mod.default?.GIFEncoder ?? mod.default;
      const quantize = mod.quantize ?? mod.default?.quantize;
      const applyPalette = mod.applyPalette ?? mod.default?.applyPalette;
      if (typeof quantize !== 'function') {
        throw new Error('gifenc: quantize not found in module exports');
      }
      return { GIFEncoder, quantize, applyPalette };
    });
  }
  return gifencPromise;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestampFilename(prefix, ext = 'gif') {
  const d = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-${stamp}.${ext}`;
}

/**
 * Render an SVG string onto a canvas and return the canvas.
 * Dimensions are inferred from the SVG's width/height/viewBox attributes,
 * falling back to the supplied overrides or 512×512.
 * @param {string} svgString - Raw SVG markup
 * @param {number} [width]  - Override output width
 * @param {number} [height] - Override output height
 * @returns {Promise<HTMLCanvasElement>}
 */
export function svgToCanvas(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;

    // Try to determine natural dimensions from the SVG
    const svgW = parseFloat(svgEl.getAttribute('width')) || 0;
    const svgH = parseFloat(svgEl.getAttribute('height')) || 0;
    const vb = svgEl.getAttribute('viewBox');
    let vbW = 0, vbH = 0;
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4) { vbW = parts[2]; vbH = parts[3]; }
    }

    const outW = width || svgW || vbW || 512;
    const outH = height || svgH || vbH || 512;

    // Ensure the SVG element has explicit dimensions for rasterisation
    svgEl.setAttribute('width', String(outW));
    svgEl.setAttribute('height', String(outH));

    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterise SVG'));
    };
    img.src = url;
  });
}

/**
 * Export SVG string content as a GIF download.
 * @param {string} svgString
 * @param {object} [opts]
 * @param {string} [opts.prefix='svg-benchmark'] - Filename prefix
 * @param {number} [opts.width]  - Override width (auto-detected from SVG if omitted)
 * @param {number} [opts.height] - Override height (auto-detected from SVG if omitted)
 * @returns {Promise<void>}
 */
export async function exportSvgAsGif(svgString, { prefix = 'svg-benchmark', width, height } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const canvas = await svgToCanvas(svgString, width, height);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);

  const palette = quantize(imageData.data, 256);
  const index = applyPalette(imageData.data, palette);

  const gif = GIFEncoder();
  gif.writeFrame(index, w, h, { palette });
  gif.finish();

  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  triggerDownload(blob, timestampFilename(prefix));
}

/**
 * Export a canvas element as a GIF download.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {string} [opts.prefix='export'] - Filename prefix
 * @returns {Promise<void>}
 */
export async function exportCanvasAsGif(canvas, { prefix = 'export' } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);

  const palette = quantize(imageData.data, 256);
  const index = applyPalette(imageData.data, palette);

  const gif = GIFEncoder();
  gif.writeFrame(index, w, h, { palette });
  gif.finish();

  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  triggerDownload(blob, timestampFilename(prefix));
}

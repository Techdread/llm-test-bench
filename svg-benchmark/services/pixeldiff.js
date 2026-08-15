// Canvas-based pixel comparison for SVG vs reference image
// All operations are client-side using offscreen canvases

const DEFAULT_SIZE = 400;

/**
 * Render an SVG string to a canvas at a fixed resolution
 * @param {string} svgString - Raw SVG markup
 * @param {number} width
 * @param {number} height
 * @returns {Promise<HTMLCanvasElement>}
 */
export function renderSvgToCanvas(svgString, width = DEFAULT_SIZE, height = DEFAULT_SIZE) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const img = new Image();
    const encoded = encodeURIComponent(svgString);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to render SVG to canvas'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encoded;
  });
}

/**
 * Load an image (data URL or blob URL) into a canvas at a fixed resolution
 * @param {string} src - Image source (data URL or blob URL)
 * @param {number} width
 * @param {number} height
 * @returns {Promise<HTMLCanvasElement>}
 */
export function renderImageToCanvas(src, width = DEFAULT_SIZE, height = DEFAULT_SIZE) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const img = new Image();
    img.onload = () => {
      // Scale to fit while preserving aspect ratio
      const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const x = (width - w) / 2;
      const y = (height - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to load reference image'));
    img.src = src;
  });
}

/**
 * Compare two canvases pixel-by-pixel
 * @param {HTMLCanvasElement} canvasA
 * @param {HTMLCanvasElement} canvasB
 * @returns {{ score: number, diffCanvas: HTMLCanvasElement }}
 *   score: 0–1 (1 = identical), diffCanvas: visualization (green=match, red=diff)
 */
export function compareCanvases(canvasA, canvasB) {
  const width = canvasA.width;
  const height = canvasA.height;

  const ctxA = canvasA.getContext('2d');
  const ctxB = canvasB.getContext('2d');

  const dataA = ctxA.getImageData(0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height);

  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext('2d');
  const diffData = diffCtx.createImageData(width, height);

  let totalDist = 0;
  const maxDist = width * height * 255 * 3; // max possible distance (R+G+B per pixel)

  for (let i = 0; i < dataA.data.length; i += 4) {
    const rA = dataA.data[i], gA = dataA.data[i + 1], bA = dataA.data[i + 2];
    const rB = dataB.data[i], gB = dataB.data[i + 1], bB = dataB.data[i + 2];

    const dr = Math.abs(rA - rB);
    const dg = Math.abs(gA - gB);
    const db = Math.abs(bA - bB);

    const pixelDist = dr + dg + db;
    totalDist += pixelDist;

    // Diff visualization: green where matching, red where different
    const diffAmount = pixelDist / (255 * 3);
    if (diffAmount < 0.05) {
      // Match — show green tinted original
      diffData.data[i] = Math.round(rA * 0.3);
      diffData.data[i + 1] = Math.round(128 + gA * 0.3);
      diffData.data[i + 2] = Math.round(bA * 0.3);
    } else {
      // Difference — show red proportional to diff
      diffData.data[i] = Math.round(200 + 55 * diffAmount);
      diffData.data[i + 1] = Math.round(50 * (1 - diffAmount));
      diffData.data[i + 2] = Math.round(50 * (1 - diffAmount));
    }
    diffData.data[i + 3] = 255; // alpha
  }

  diffCtx.putImageData(diffData, 0, 0);

  const score = 1 - (totalDist / maxDist);
  return { score, diffCanvas };
}

/**
 * Full pixel-diff comparison: SVG string vs reference image
 * @param {string} svgString
 * @param {string} referenceSrc - Data URL or blob URL of reference image
 * @param {number} size - Resolution for comparison
 * @returns {Promise<{ score: number, diffCanvas: HTMLCanvasElement, svgCanvas: HTMLCanvasElement, refCanvas: HTMLCanvasElement }>}
 */
export async function compareSvgToReference(svgString, referenceSrc, size = DEFAULT_SIZE) {
  const [svgCanvas, refCanvas] = await Promise.all([
    renderSvgToCanvas(svgString, size, size),
    renderImageToCanvas(referenceSrc, size, size),
  ]);

  const { score, diffCanvas } = compareCanvases(svgCanvas, refCanvas);
  return { score, diffCanvas, svgCanvas, refCanvas };
}

/**
 * Analyze an SVG string for metadata
 * @param {string} svgString
 * @returns {{ elementCount: number, hasViewBox: boolean, hasAnimation: boolean, fileSize: number }}
 */
export function analyzeSvg(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    return { elementCount: 0, hasViewBox: false, hasAnimation: false, fileSize: svgString.length };
  }

  const allElements = svg.querySelectorAll('*');
  const hasViewBox = svg.hasAttribute('viewBox');
  const hasAnimation = svg.querySelector('animate, animateTransform, animateMotion, set') !== null;

  return {
    elementCount: allElements.length,
    hasViewBox,
    hasAnimation,
    fileSize: svgString.length,
  };
}

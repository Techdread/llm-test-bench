// Gallery thumbnails: a picture of a generation, saved beside it as
// {variantKey}.thumb.jpg, so the gallery can show every card at once instead of
// running six pages live and leaving the rest blank.
//
// In the browser, a thumbnail is read from the page's own largest <canvas>
// (nearly every generation here is three.js or 2D-canvas). The preview injects
// THUMBNAIL_SHIM, which keeps WebGL drawing buffers readable and answers a
// capture request. Pages with no canvas get no thumbnail here: the headless
// backfill (tools/prompt-gallery-thumbnails.mjs) screenshots those, and until
// then their card runs live as before.
//
// Nothing here touches browser globals at module load, so the maths is tested
// under node.

export const THUMB_WIDTH = 640;
export const THUMB_HEIGHT = 360;
export const THUMB_QUALITY = 0.8;
const CAPTURE_MESSAGE = 'pg-thumbnail-capture';

const SHIM_JS = `(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){if(/webgl/i.test(String(t)))o=Object.assign({},o,{preserveDrawingBuffer:true});return g.call(this,t,o)};addEventListener('message',e=>{if(e.data!=='${CAPTURE_MESSAGE}')return;const cs=[...document.querySelectorAll('canvas')].filter(c=>c.width>=64&&c.height>=64).sort((a,b)=>b.width*b.height-a.width*a.height);let url='';try{url=cs[0]?cs[0].toDataURL('image/png'):''}catch(err){}parent.postMessage({type:'${CAPTURE_MESSAGE}',url},'*')})})();`;
export const THUMBNAIL_SHIM = `<script>${SHIM_JS}<\/script>`;

/** Put the shim first in <head>, before any page script asks for a WebGL context. */
export function withThumbnailShim(html) {
  const text = String(html || '');
  const head = text.match(/<head[^>]*>/i);
  if (head) return text.replace(head[0], `${head[0]}${THUMBNAIL_SHIM}`);
  return THUMBNAIL_SHIM + text;
}

/** The source rectangle that cover-crops sw x sh into a dw x dh frame (centred). */
export function coverCrop(sw, sh, dw = THUMB_WIDTH, dh = THUMB_HEIGHT) {
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

/**
 * True when every sampled pixel is (nearly) one colour: an unrendered page or a
 * WebGL read-back of an empty buffer. Not worth saving as a thumbnail.
 * @param {Uint8ClampedArray|number[]} rgba
 */
export function looksBlank(rgba, samples = 400) {
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return true;
  const step = Math.max(1, Math.floor(pixels / samples)) * 4;
  for (let i = step; i < rgba.length; i += step) {
    if (Math.abs(rgba[i] - rgba[0]) + Math.abs(rgba[i + 1] - rgba[1]) + Math.abs(rgba[i + 2] - rgba[2]) > 12) return false;
  }
  return true;
}

/** Ask a preview iframe (loaded with the shim) for its largest canvas. Resolves to a data URL or ''. */
export function requestCanvasCapture(iframe, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const win = iframe?.contentWindow;
    if (!win) return resolve('');
    const timer = setTimeout(done, timeoutMs, '');
    function onMessage(e) {
      if (e.source !== win || e.data?.type !== CAPTURE_MESSAGE) return;
      done(typeof e.data.url === 'string' && e.data.url !== 'data:,' ? e.data.url : '');
    }
    function done(url) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(url);
    }
    window.addEventListener('message', onMessage);
    win.postMessage(CAPTURE_MESSAGE, '*');
  });
}

/** Cover-crop an image URL to the thumbnail size and encode it as JPEG bytes; null if blank. */
export async function encodeThumbnail(url) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('unreadable capture'));
    el.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  const crop = coverCrop(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  if (looksBlank(ctx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data)) return null;
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', THUMB_QUALITY));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Capture a preview iframe's canvas as thumbnail bytes, or null when there is nothing worth keeping. */
export async function captureThumbnail(iframe) {
  const url = await requestCanvasCapture(iframe);
  if (!url) return null;
  try {
    return await encodeThumbnail(url);
  } catch {
    return null;
  }
}

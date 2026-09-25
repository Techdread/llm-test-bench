// Poster images for showcase tiles: capture, normalise, and sanity-check.
// Browser-only (canvas, getDisplayMedia).

export const POSTER_WIDTH = 960;
export const POSTER_HEIGHT = 600;
const MAX_BYTES = 950_000;

/**
 * Injected at the top of the preview document: forces WebGL contexts to keep
 * their drawing buffer (otherwise toDataURL reads back blank) and answers a
 * capture request with the largest canvas as a data URL.
 */
export const CAPTURE_SHIM = `<script>(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){if(/webgl/i.test(String(t)))o=Object.assign({},o,{preserveDrawingBuffer:true});return g.call(this,t,o)};addEventListener('message',e=>{if(e.data!=='showcase-capture')return;const all=[...document.querySelectorAll('canvas')];const cs=all.filter(c=>c.width*c.height>0).sort((a,b)=>b.width*b.height-a.width*a.height);let url='',error='';try{url=cs[0]?cs[0].toDataURL('image/png'):''}catch(err){error=err.name||'Error'}parent.postMessage({type:'showcase-capture',url,error,canvases:all.length,sizes:all.map(c=>c.width+'x'+c.height)},'*')})})();<\/script>`;

export function withCaptureShim(html) {
  const text = String(html || '');
  const head = text.match(/<head[^>]*>/i);
  if (head) return text.replace(head[0], `${head[0]}${CAPTURE_SHIM}`);
  return CAPTURE_SHIM + text;
}

/** Ask the sandboxed preview for its largest canvas. Resolves to an image or throws. */
export function captureFromPreview(iframe, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', onMessage); reject(new Error('The preview did not answer (no canvas, or still loading).')); }, timeoutMs);
    function onMessage(e) {
      if (e.source !== iframe.contentWindow || e.data?.type !== 'showcase-capture') return;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      if (!e.data.url || e.data.url === 'data:,') {
        const why = e.data.error === 'SecurityError'
          ? 'the page draws cross-origin images, so the browser will not let its canvas be read'
          : e.data.canvases ? `its canvas is empty (${e.data.sizes.join(', ')})` : 'it has no canvas';
        return reject(new Error(`Nothing to capture: ${why}. If the preview looks right, use Capture screen or Upload.`));
      }
      loadImage(e.data.url).then(resolve, reject);
    }
    addEventListener('message', onMessage);
    iframe.contentWindow.postMessage('showcase-capture', '*');
  });
}

/** One frame of the current tab via the browser's share prompt, cropped to `element`. */
export async function captureScreen(element) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
  });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = element.getBoundingClientRect();
    const scaleX = video.videoWidth / window.innerWidth;
    const scaleY = video.videoHeight / window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * scaleX);
    canvas.height = Math.round(rect.height * scaleY);
    canvas.getContext('2d').drawImage(video, rect.left * scaleX, rect.top * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

export async function imageFromBytes(bytes, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** True when every sampled pixel is the same colour (a blank WebGL read-back). */
export function looksBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(4, Math.floor(data.length / 4 / 400)) * 4;
  for (let i = step; i < data.length; i += step) {
    if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 12) return false;
  }
  return true;
}

/** Cover-crop any image/canvas to 960x600 and encode as JPEG under ~1 MB. */
export async function normalizePoster(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error('Empty image.');
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const scale = Math.max(POSTER_WIDTH / sw, POSTER_HEIGHT / sh);
  const w = sw * scale;
  const h = sh * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#06080e';
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  ctx.drawImage(source, (POSTER_WIDTH - w) / 2, (POSTER_HEIGHT - h) / 2, w, h);
  const blank = looksBlank(canvas);
  for (const quality of [0.86, 0.78, 0.68, 0.55]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), blank };
    }
  }
  throw new Error('Could not get the poster under 1 MB.');
}

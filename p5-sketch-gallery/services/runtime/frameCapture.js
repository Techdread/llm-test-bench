// Captures a frame from a CanvasPreview iframe by exchanging messages.
// Requires the iframe contentWindow to be available.
export function captureFromIframe(iframe, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const win = iframe?.contentWindow;
    if (!win) return resolve(null);

    const onMsg = (e) => {
      if (e.source !== win) return;
      if (e.data?.type !== 'frame') return;
      window.removeEventListener('message', onMsg);
      clearTimeout(t);
      resolve(e.data.dataUrl || null);
    };
    const t = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      resolve(null);
    }, timeoutMs);

    window.addEventListener('message', onMsg);
    win.postMessage({ type: 'capture' }, '*');
  });
}

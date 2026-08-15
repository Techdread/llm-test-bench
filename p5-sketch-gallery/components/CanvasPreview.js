import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { buildSrcDoc } from '../services/runtime/sketchRunner.js';
import { captureFromIframe } from '../services/runtime/frameCapture.js';

// Live p5 sketch preview. Forwards an imperative ref via the registerApi prop:
//   registerApi({ capture, restart, play, pause, applyParams, applySeed })

export function CanvasPreview({
  code,
  params,
  seed,
  playing = true,
  registerApi,
  onError,
  onFps,
  onReady,
}) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState('');

  // Send command to iframe (handles not-yet-ready case)
  const send = (msg) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(msg, '*');
  };

  // Listen for iframe messages
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data || {};
      if (data.type === 'ready') {
        readyRef.current = true;
        setError('');
        send({ type: 'init', code, params, seed, playing });
        onReady && onReady();
      } else if (data.type === 'error') {
        setError(data.message || 'Unknown error');
        onError && onError(data.message);
      } else if (data.type === 'fps') {
        setFps(data.fps);
        onFps && onFps(data.fps);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [code, params, seed, playing, onReady, onError, onFps]);

  // Push code/params/seed/playing changes when they shift
  useEffect(() => {
    if (!readyRef.current) return;
    setError('');
    send({ type: 'update', code, params, seed, playing });
  }, [code, seed]);

  useEffect(() => {
    if (!readyRef.current) return;
    send({ type: 'setParams', params });
  }, [params]);

  useEffect(() => {
    if (!readyRef.current) return;
    send({ type: playing ? 'play' : 'pause' });
  }, [playing]);

  // Imperative API
  useEffect(() => {
    if (!registerApi) return;
    registerApi({
      capture: () => captureFromIframe(iframeRef.current),
      restart: () => send({ type: 'restart' }),
      play: () => send({ type: 'play' }),
      pause: () => send({ type: 'pause' }),
      applyParams: (p) => send({ type: 'setParams', params: p }),
      applySeed: (s) => send({ type: 'setSeed', seed: s }),
    });
  }, [registerApi]);

  return html`
    <div class="canvas-preview">
      <iframe
        ref=${iframeRef}
        srcdoc=${buildSrcDoc()}
        sandbox="allow-scripts allow-modals"
        title="p5 sketch preview"
      />
      <div class="canvas-overlay">
        <span class="fps">${fps} fps</span>
        ${error && html`<span class="err-flag" title=${error}>⚠ runtime error</span>`}
      </div>
    </div>
  `;
}

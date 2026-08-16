// Build the iframe srcdoc that runs a user sketch in p5 instance mode.
// Communication is via postMessage. Parent sends { type, ... } commands;
// iframe replies with { type: 'ready'|'error'|'frame'|'fps', ... }.

const P5_URL = new URL('../../../shared/lib/p5.js/1.9.4/p5.min.js', import.meta.url).href;

export function defaultSketchCode() {
  return `// Define p5 sketch in instance mode.
// p — the p5 instance.
// ctx.seed — current seed (number).
// ctx.params — current parameter values from the right panel.
function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
  };
  p.draw = () => {
    p.background(220, 30, 10);
    p.noFill();
    p.strokeWeight(1.4);
    const n = ctx.params.count ?? 80;
    const r = ctx.params.radius ?? 140;
    for (let i = 0; i < n; i++) {
      const t = p.frameCount * 0.005 + i * 0.07;
      const x = p.width/2 + p.cos(t) * r;
      const y = p.height/2 + p.sin(t * 1.3) * r;
      p.stroke((i * 6 + p.frameCount * 0.4) % 360, 80, 100, 0.9);
      p.circle(x, y, 18 + p.sin(t * 2) * 6);
    }
  };
}
`;
}

export function defaultParams() {
  return { count: 80, radius: 140 };
}

export function buildSrcDoc() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    html, body { margin:0; padding:0; background:#0b0b0e; color:#e6e6ea;
      font: 12px/1.4 system-ui, sans-serif; overflow:hidden; }
    #wrap { display:flex; align-items:center; justify-content:center; width:100vw; height:100vh; }
    canvas { display:block; }
    #err { position:fixed; left:0; right:0; bottom:0; padding:8px 10px;
      background:rgba(220,40,40,0.92); color:#fff; font-family: ui-monospace, monospace;
      white-space: pre-wrap; max-height:40vh; overflow:auto; display:none; }
  </style>
  <script src="${P5_URL}"><\/script>
</head>
<body>
  <div id="wrap"></div>
  <div id="err"></div>
  <script>
  (function() {
    const wrap = document.getElementById('wrap');
    const errEl = document.getElementById('err');
    let p5Instance = null;
    let userSketch = null;
    let ctx = { seed: 1, params: {}, playing: true };
    let lastFps = 0;
    let fpsTimer = 0;

    function showError(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      parent.postMessage({ type: 'error', message: msg }, '*');
    }
    function clearError() {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
    window.addEventListener('error', (e) => {
      showError(\`\${e.message}\\n  at line \${e.lineno || '?'}\`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      showError('Unhandled rejection: ' + (e.reason && e.reason.message || e.reason));
    });

    function destroy() {
      if (p5Instance) {
        try { p5Instance.remove(); } catch (e) {}
        p5Instance = null;
      }
      wrap.innerHTML = '';
    }

    function instantiate() {
      destroy();
      clearError();
      if (!userSketch) return;
      try {
        p5Instance = new p5((p) => {
          // Wrap setup/draw to surface errors and FPS
          const origDraw = () => p.draw && p.draw();
          userSketch(p, ctx);
          if (typeof p.draw === 'function') {
            const userDraw = p.draw.bind(p);
            p.draw = () => {
              if (!ctx.playing) { p.noLoop(); return; }
              try { userDraw(); } catch (e) { showError(String(e && e.stack || e)); p.noLoop(); }
              const now = performance.now();
              if (now - fpsTimer > 500) {
                lastFps = Math.round(p.frameRate());
                parent.postMessage({ type: 'fps', fps: lastFps }, '*');
                fpsTimer = now;
              }
            };
          }
          if (typeof p.setup === 'function') {
            const userSetup = p.setup.bind(p);
            p.setup = () => {
              try { userSetup(); }
              catch (e) { showError(String(e && e.stack || e)); }
            };
          }
        }, wrap);
        if (!ctx.playing && p5Instance) p5Instance.noLoop();
      } catch (e) {
        showError(String(e && e.stack || e));
      }
    }

    function loadCode(code) {
      try {
        // Define a fresh sketch fn in this scope
        userSketch = null;
        const wrapper = new Function('return (function(){ var sketch; ' + code + '\\nreturn typeof sketch === "function" ? sketch : null; })();');
        userSketch = wrapper();
        if (!userSketch) {
          showError('Sketch must define a function named "sketch(p, ctx)".');
          return;
        }
        instantiate();
      } catch (e) {
        showError(String(e && e.stack || e));
      }
    }

    function captureFrame() {
      try {
        const c = wrap.querySelector('canvas');
        if (!c) { parent.postMessage({ type: 'frame', dataUrl: null }, '*'); return; }
        parent.postMessage({ type: 'frame', dataUrl: c.toDataURL('image/png') }, '*');
      } catch (e) {
        parent.postMessage({ type: 'frame', dataUrl: null, error: String(e) }, '*');
      }
    }

    window.addEventListener('message', (e) => {
      const msg = e.data || {};
      switch (msg.type) {
        case 'init':
          ctx.seed = msg.seed | 0;
          ctx.params = msg.params || {};
          ctx.playing = msg.playing !== false;
          loadCode(msg.code || '');
          break;
        case 'update':
          ctx.seed = msg.seed | 0;
          ctx.params = msg.params || {};
          ctx.playing = msg.playing !== false;
          loadCode(msg.code || '');
          break;
        case 'setParams':
          ctx.params = msg.params || {};
          break;
        case 'setSeed':
          ctx.seed = msg.seed | 0;
          instantiate();
          break;
        case 'play':
          ctx.playing = true;
          if (p5Instance) p5Instance.loop();
          break;
        case 'pause':
          ctx.playing = false;
          if (p5Instance) p5Instance.noLoop();
          break;
        case 'restart':
          instantiate();
          break;
        case 'capture':
          captureFrame();
          break;
      }
    });

    parent.postMessage({ type: 'ready' }, '*');
  })();
  <\/script>
</body>
</html>`;
}

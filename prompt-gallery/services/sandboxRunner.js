// Hidden-iframe sandbox runner for generated HTML. In addition to the legacy
// console/error fields it collects compact deterministic evidence for the
// opt-in Verified Generation pilot. The iframe remains opaque and script-only.

const DEFAULT_TIMEOUT_MS = 10000;
const SETTLE_MS = 2500;
const PROBE_SETTLE_MS = 900;
const OUTPUT_CAP = 8000;

function truncate(value, cap = OUTPUT_CAP) {
  const str = String(value || '');
  return str.length <= cap ? str : `${str.slice(0, cap)}\n[... ${str.length - cap} chars truncated]`;
}

let runCounter = 0;

function injectCapture(htmlContent, runId, { probe = false, settleMs = SETTLE_MS } = {}) {
  const captureScript = `<script>
    (function(){
      var logs = [], warnings = [], errors = [], probeErrors = [];
      var origLog = console.log, origWarn = console.warn, origError = console.error;
      function bounded(v, n){ v = String(v == null ? '' : v).replace(/\\s+/g, ' ').trim(); return v.slice(0, n || 500); }
      function argsText(args){ return Array.prototype.map.call(args, function(v){ try { return bounded(v, 1000); } catch(e){ return '[unprintable]'; } }).join(' '); }
      console.log = function(){ logs.push(argsText(arguments)); origLog.apply(console, arguments); };
      console.info = console.log;
      console.warn = function(){ warnings.push(argsText(arguments)); origWarn.apply(console, arguments); };
      console.error = function(){ errors.push(argsText(arguments)); origError.apply(console, arguments); };
      window.onerror = function(msg, src, line, col, err){ errors.push(bounded((err && err.stack) ? err.stack : msg + ' at line ' + line + ':' + col, 2000)); };
      window.addEventListener('unhandledrejection', function(e){ errors.push(bounded('Unhandled rejection: ' + ((e.reason && e.reason.stack) || (e.reason && e.reason.message) || String(e.reason)), 2000)); });

      function labelFor(el){
        var aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder'));
        var labelled = '';
        if (el.labels && el.labels.length) labelled = Array.prototype.map.call(el.labels, function(x){ return x.textContent; }).join(' ');
        return bounded(aria || labelled || el.textContent || el.value || el.name || el.id || '', 120);
      }
      function signature(){
        try { return bounded(document.body ? document.body.innerText + '|' + document.body.innerHTML.length : '', 2000); }
        catch(e){ probeErrors.push('DOM signature: ' + bounded(e.message, 200)); return ''; }
      }
      function fingerprint(canvas){
        try {
          var ctx = canvas.getContext('2d');
          if (!ctx) return { readable:false, value:'' };
          var w = Math.max(1, canvas.width || 1), h = Math.max(1, canvas.height || 1);
          var data = ctx.getImageData(0, 0, Math.min(w, 64), Math.min(h, 64)).data;
          var hash = 2166136261;
          for (var i=0; i<data.length; i+=16) { hash ^= data[i] + data[i+1] * 3 + data[i+2] * 7 + data[i+3] * 11; hash = Math.imul(hash, 16777619); }
          return { readable:true, value:String(hash >>> 0) };
        } catch(e) { return { readable:false, value:'' }; }
      }
      function resources(){
        var found = [];
        try {
          document.querySelectorAll('[src],[href]').forEach(function(el){
            var raw = el.getAttribute('src') || el.getAttribute('href') || '';
            if (/^(?:https?:)?\\/\\//i.test(raw) && found.indexOf(raw) < 0 && found.length < 20) found.push(bounded(raw, 300));
          });
        } catch(e) { probeErrors.push('Resource scan: ' + bounded(e.message, 200)); }
        return found;
      }

      function beginEvidence(){
        var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'), 0, 8);
        var firstFrames = canvases.map(fingerprint);
        var beforeDom = signature();
        var beforeCanvas = firstFrames.map(function(x){ return x.value; }).join('|');

        if (${probe ? 'true' : 'false'}) {
          try {
            ['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].forEach(function(key){
              var code = key === ' ' ? 'Space' : key.length === 1 ? 'Key' + key.toUpperCase() : key;
              document.dispatchEvent(new KeyboardEvent('keydown', { key:key, code:code, bubbles:true }));
              document.dispatchEvent(new KeyboardEvent('keyup', { key:key, code:code, bubbles:true }));
            });
          } catch(e) { probeErrors.push('Keyboard probe: ' + bounded(e.message, 200)); }
          try {
            var buttons = Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'));
            var obvious = buttons.find(function(el){ return /^(?:start|play|begin|restart|reset|try again)$/i.test(labelFor(el)); });
            if (obvious) obvious.click();
          } catch(e) { probeErrors.push('Button probe: ' + bounded(e.message, 200)); }
        }

        setTimeout(function(){
        var secondFrames = canvases.map(fingerprint);
        var afterDom = signature();
        var afterCanvas = secondFrames.map(function(x){ return x.value; }).join('|');
        var evidence = {
          documentTitle: bounded(document.title, 240),
          elementCounts: {
            button: document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]').length,
            input: document.querySelectorAll('input,select,textarea').length,
            canvas: document.querySelectorAll('canvas').length,
            svg: document.querySelectorAll('svg').length
          },
          buttonLabels: Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'),0,20).map(labelFor).filter(Boolean),
          inputLabels: Array.prototype.slice.call(document.querySelectorAll('input,select,textarea'),0,20).map(labelFor).filter(Boolean),
          canvas: canvases.map(function(canvas, i){ return { width:canvas.width || 0, height:canvas.height || 0, frameChanged:!!(firstFrames[i].value && secondFrames[i].value && firstFrames[i].value !== secondFrames[i].value), readable:firstFrames[i].readable && secondFrames[i].readable }; }),
          domChangedAfterProbe: ${probe ? 'true' : 'false'} && (beforeDom !== afterDom || beforeCanvas !== afterCanvas),
          probeErrors: probeErrors.slice(0,20).map(function(x){ return bounded(x,500); }),
          externalResources: resources()
        };
        parent.postMessage({ type:'pg-sandbox-result', runId:${JSON.stringify(runId)}, probe:${probe ? 'true' : 'false'}, logs:logs.slice(0,50), warnings:warnings.slice(0,50), errors:errors.slice(0,50), evidence:evidence }, '*');
        }, ${settleMs});
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beginEvidence, { once:true });
      else beginEvidence();
    })();
  <\/script>`;

  if (/<head[\s>]/i.test(htmlContent)) return htmlContent.replace(/<head(\s[^>]*)?>/i, '$&' + captureScript);
  if (/<html[\s>]/i.test(htmlContent)) return htmlContent.replace(/<html(\s[^>]*)?>/i, '$&<head>' + captureScript + '</head>');
  return captureScript + htmlContent;
}

function runOne(htmlContent, { timeoutMs, probe, settleMs }) {
  return new Promise(resolve => {
    const runId = `pg-run-${++runCounter}-${Date.now().toString(36)}`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0;';
    iframe.sandbox = 'allow-scripts';
    document.body.appendChild(iframe);
    const start = performance.now();
    let settled = false;
    const timeout = setTimeout(() => finish({
      ok: false,
      errors: [`Execution timed out after ${timeoutMs}ms — possible infinite loop or blocked load`],
      warnings: [], logs: [], duration: Math.round(performance.now() - start), timedOut: true,
      evidence: { documentTitle: '', elementCounts: { button: 0, input: 0, canvas: 0, svg: 0 }, buttonLabels: [], inputLabels: [], canvas: [], domChangedAfterProbe: false, probeErrors: [], externalResources: [] },
    }), timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      try { document.body.removeChild(iframe); } catch (e) { /* already removed */ }
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }
    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type !== 'pg-sandbox-result' || data.runId !== runId) return;
      const errors = (data.errors || []).slice(0, 50).map(error => truncate(error));
      finish({
        ok: errors.length === 0,
        errors,
        warnings: (data.warnings || []).slice(0, 50).map(warning => truncate(warning)),
        logs: (data.logs || []).slice(0, 50).map(log => truncate(log)),
        duration: Math.round(performance.now() - start),
        timedOut: false,
        evidence: data.evidence || {},
      });
    }
    window.addEventListener('message', onMessage);
    iframe.srcdoc = injectCapture(htmlContent, runId, { probe, settleMs });
  });
}

function mergeEvidence(base, probe) {
  const first = base?.evidence || {};
  const second = probe?.evidence || {};
  return {
    documentTitle: truncate(first.documentTitle || second.documentTitle || '', 240),
    elementCounts: first.elementCounts || second.elementCounts || { button: 0, input: 0, canvas: 0, svg: 0 },
    buttonLabels: (first.buttonLabels || second.buttonLabels || []).slice(0, 20).map(value => truncate(value, 120)),
    inputLabels: (first.inputLabels || second.inputLabels || []).slice(0, 20).map(value => truncate(value, 120)),
    canvas: (first.canvas || second.canvas || []).slice(0, 8),
    domChangedAfterProbe: !!second.domChangedAfterProbe,
    probeErrors: [
      ...(first.probeErrors || []),
      ...(second.probeErrors || []),
      ...((probe?.errors || []).map(error => `Probe runtime: ${error}`)),
      ...(probe?.timedOut ? ['Probe run timed out'] : []),
    ].slice(0, 20).map(value => truncate(value, 500)),
    externalResources: (first.externalResources || second.externalResources || []).slice(0, 20).map(value => truncate(value, 300)),
  };
}

/** Run HTML invisibly and capture legacy status fields plus bounded evidence. */
export async function runHtmlSandbox(htmlContent, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = await runOne(htmlContent, { timeoutMs, probe: false, settleMs: SETTLE_MS });
  if (base.timedOut) return { ...base, evidence: mergeEvidence(base, null) };
  const remaining = Math.max(1200, timeoutMs - base.duration);
  const probe = await runOne(htmlContent, { timeoutMs: remaining, probe: true, settleMs: PROBE_SETTLE_MS });
  return { ...base, evidence: mergeEvidence(base, probe) };
}

export function runStatusLabel(status) {
  if (!status) return 'not run';
  if (status.timedOut) return 'timed out';
  if (status.errors.length > 0) return `${status.errors.length} error${status.errors.length === 1 ? '' : 's'}`;
  if (status.warnings.length > 0) return `clean (${status.warnings.length} warning${status.warnings.length === 1 ? '' : 's'})`;
  return 'clean';
}

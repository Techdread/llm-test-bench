// Hidden-iframe sandbox runner for generated HTML, trimmed down from
// code-morph-lab-v3's runHtml.js (console + error capture only, no SVG
// snapshot). Used by the Refine tab to ground-truth whether a generation
// runs clean before/after the model touches it.

const DEFAULT_TIMEOUT_MS = 10000;
const SETTLE_MS = 2500; // how long the page gets to run before reporting
const OUTPUT_CAP = 8000;

function truncate(str, cap) {
  if (str.length <= cap) return str;
  return str.slice(0, cap) + `\n[... ${str.length - cap} chars truncated]`;
}

let runCounter = 0;

/**
 * Run an HTML document invisibly and capture console errors/warnings,
 * uncaught exceptions, and unhandled rejections.
 *
 * @param {string} htmlContent
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], logs:string[], duration:number, timedOut:boolean}>}
 */
export function runHtmlSandbox(htmlContent, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const runId = `pg-run-${++runCounter}-${Date.now().toString(36)}`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0;';
    iframe.sandbox = 'allow-scripts';
    document.body.appendChild(iframe);

    let settled = false;
    const start = performance.now();

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: false,
        errors: [`Execution timed out after ${timeoutMs}ms — possible infinite loop or blocked load`],
        warnings: [],
        logs: [],
        duration: Math.round(performance.now() - start),
        timedOut: true,
      });
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      try { document.body.removeChild(iframe); } catch (e) { /* already gone */ }
    }

    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type !== 'pg-sandbox-result' || data.runId !== runId) return;
      if (settled) return;
      settled = true;
      cleanup();
      const errors = (data.errors || []).map(e => truncate(String(e), OUTPUT_CAP));
      resolve({
        ok: errors.length === 0,
        errors,
        warnings: (data.warnings || []).map(w => truncate(String(w), OUTPUT_CAP)),
        logs: (data.logs || []).map(l => truncate(String(l), OUTPUT_CAP)),
        duration: Math.round(performance.now() - start),
        timedOut: false,
      });
    }

    window.addEventListener('message', onMessage);

    const captureScript = `<script>
      (function(){
        var logs = [], warnings = [], errors = [];
        var origLog = console.log, origWarn = console.warn, origError = console.error;
        console.log   = function(){ logs.push(Array.prototype.map.call(arguments, String).join(' ')); origLog.apply(console, arguments); };
        console.info  = console.log;
        console.warn  = function(){ warnings.push(Array.prototype.map.call(arguments, String).join(' ')); origWarn.apply(console, arguments); };
        console.error = function(){ errors.push(Array.prototype.map.call(arguments, String).join(' ')); origError.apply(console, arguments); };
        window.onerror = function(msg, src, line, col, err){
          errors.push((err && err.stack) ? err.stack : msg + ' at line ' + line + ':' + col);
        };
        window.addEventListener('unhandledrejection', function(e){
          errors.push('Unhandled rejection: ' + ((e.reason && e.reason.stack) || (e.reason && e.reason.message) || String(e.reason)));
        });
        setTimeout(function(){
          parent.postMessage({
            type: 'pg-sandbox-result',
            runId: ${JSON.stringify(runId)},
            logs: logs.slice(0, 50),
            warnings: warnings.slice(0, 50),
            errors: errors.slice(0, 50),
          }, '*');
        }, ${SETTLE_MS});
      })();
    <\/script>`;

    let modified;
    if (/<head[\s>]/i.test(htmlContent)) {
      modified = htmlContent.replace(/<head(\s[^>]*)?>/i, '$&' + captureScript);
    } else if (/<html[\s>]/i.test(htmlContent)) {
      modified = htmlContent.replace(/<html(\s[^>]*)?>/i, '$&<head>' + captureScript + '</head>');
    } else {
      modified = captureScript + htmlContent;
    }

    iframe.srcdoc = modified;
  });
}

/** Short human label for a run result, e.g. "clean" / "3 errors" / "timed out". */
export function runStatusLabel(status) {
  if (!status) return 'not run';
  if (status.timedOut) return 'timed out';
  if (status.errors.length > 0) return `${status.errors.length} error${status.errors.length === 1 ? '' : 's'}`;
  if (status.warnings.length > 0) return `clean (${status.warnings.length} warning${status.warnings.length === 1 ? '' : 's'})`;
  return 'clean';
}

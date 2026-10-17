// Python runner via Pyodide in a sandboxed iframe.
// Pyodide init is slow (~3–5s on cold load), so Python runs get a longer timeout.

const PY_TIMEOUT_MS = 30000;
const OUTPUT_CAP = 10000;

function truncate(str, cap) {
  if (str.length <= cap) return str;
  return str.slice(0, cap) + `\n[... ${str.length - cap} chars truncated]`;
}

export function runPython(code, allFiles = {}) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.sandbox = 'allow-scripts';
    document.body.appendChild(iframe);

    let settled = false;
    const start = performance.now();

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'Execution timed out after ' + PY_TIMEOUT_MS + 'ms',
          duration: PY_TIMEOUT_MS,
          timedOut: true,
        });
      }
    }, PY_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      try { document.body.removeChild(iframe); } catch {}
    }

    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type === 'cml-run-result') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            exitCode: data.exitCode,
            stdout: truncate(data.stdout || '', OUTPUT_CAP),
            stderr: truncate(data.stderr || '', OUTPUT_CAP),
            duration: Math.round(performance.now() - start),
            timedOut: false,
          });
        }
      }
    }

    window.addEventListener('message', onMessage);

    // Escape < as \u003c so </script> in user code can't break the HTML template.
    const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
    const escapedCode = safeJson(code);
    const fileWrites = Object.entries(allFiles)
      .filter(([name]) => name.endsWith('.py'))
      .map(([name, content]) => `pyodide.FS.writeFile(${safeJson(name)}, ${safeJson(content)});`)
      .join('\n');
    const pyodideModuleUrl = safeJson(
      new URL('../../../shared/lib/pyodide/0.25.0/full/pyodide.mjs', import.meta.url).href
    );
    const pyodideBaseUrl = safeJson(
      new URL('../../../shared/lib/pyodide/0.25.0/full/', import.meta.url).href
    );

    const runnerHtml = `<!DOCTYPE html><html><head><script type="module">
      async function run() {
        let exitCode = 0;
        let stdout = '';
        let stderr = '';
        try {
          const pyodideModule = await import(${pyodideModuleUrl});
          const pyodide = await pyodideModule.loadPyodide({
            indexURL: ${pyodideBaseUrl}
          });
          ${fileWrites}
          pyodide.runPython("import sys, io\\nsys.stdout = io.StringIO()\\nsys.stderr = io.StringIO()");
          try {
            pyodide.runPython(${escapedCode});
          } catch (pyErr) {
            stderr = pyErr.message || String(pyErr);
            exitCode = 1;
          }
          stdout = pyodide.runPython('sys.stdout.getvalue()') || '';
          const pyStderr = pyodide.runPython('sys.stderr.getvalue()') || '';
          if (pyStderr) stderr = pyStderr + (stderr ? '\\n' + stderr : '');
        } catch (e) {
          stderr = e.stack || e.message || String(e);
          exitCode = 1;
        }
        parent.postMessage({
          type: 'cml-run-result',
          exitCode, stdout, stderr,
        }, '*');
      }
      run();
    <\/script></head><body></body></html>`;

    iframe.srcdoc = runnerHtml;
  });
}

// HTML runner — sandboxed iframe, captures console + global errors.
// Returns a run result + a previewDataUrl the HtmlPreview component can render directly.

const HTML_TIMEOUT_MS = 10000;
const OUTPUT_CAP = 10000;

function truncate(str, cap) {
  if (str.length <= cap) return str;
  return str.slice(0, cap) + `\n[... ${str.length - cap} chars truncated]`;
}

/**
 * @param {string} htmlContent
 * @param {Object} [allFiles] - full workspace (for future multi-file support)
 * @returns {Promise<RunResult>}
 */
export function runHtml(htmlContent, allFiles = {}) {
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
          stderr: 'Execution timed out after ' + HTML_TIMEOUT_MS + 'ms',
          duration: HTML_TIMEOUT_MS,
          timedOut: true,
          previewDataUrl: toDataUrl(htmlContent),
        });
      }
    }, HTML_TIMEOUT_MS);

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
            previewDataUrl: toDataUrl(htmlContent),
            renderedSvg: data.renderedSvg || '',
          });
        }
      }
    }

    window.addEventListener('message', onMessage);

    const captureScript = `<script>
      const _logs = [];
      const _errors = [];
      console.log   = (...a) => _logs.push(a.map(String).join(' '));
      console.info  = (...a) => _logs.push(a.map(String).join(' '));
      console.debug = (...a) => _logs.push(a.map(String).join(' '));
      console.warn  = (...a) => _errors.push('[warn] ' + a.map(String).join(' '));
      console.error = (...a) => _errors.push(a.map(String).join(' '));
      window.onerror = (msg, src, line, col, err) => {
        _errors.push((err && err.stack) ? err.stack : msg + ' at line ' + line);
      };
      window.addEventListener('unhandledrejection', (e) => {
        _errors.push('Unhandled rejection: ' + (e.reason?.message || String(e.reason)));
      });
      function _cssText() {
        const chunks = [];
        for (const style of document.querySelectorAll('style')) {
          if (style.textContent) chunks.push(style.textContent);
        }
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            const text = Array.from(sheet.cssRules || []).map(rule => rule.cssText).join('\\n');
            if (text && !chunks.includes(text)) chunks.push(text);
          } catch {}
        }
        return chunks.join('\\n');
      }
      function _svgSize(svg) {
        const viewBox = svg.getAttribute('viewBox') || '';
        const parts = viewBox.trim().split(/[\\s,]+/).map(Number);
        const vbWidth = parts.length === 4 && Number.isFinite(parts[2]) ? parts[2] : 0;
        const vbHeight = parts.length === 4 && Number.isFinite(parts[3]) ? parts[3] : 0;
        const rect = svg.getBoundingClientRect();
        const width = parseFloat(svg.getAttribute('width')) || vbWidth || Math.round(rect.width) || 600;
        const height = parseFloat(svg.getAttribute('height')) || vbHeight || Math.round(rect.height) || 400;
        return { width, height, viewBox: viewBox || '0 0 ' + width + ' ' + height };
      }
      function _renderedSvgSnapshot() {
        const sourceSvg = document.querySelector('svg');
        if (!sourceSvg) return '';
        const { width, height, viewBox } = _svgSize(sourceSvg);
        const bodyClone = document.body.cloneNode(true);
        bodyClone.querySelectorAll('script, iframe').forEach(el => el.remove());

        const ns = 'http://www.w3.org/2000/svg';
        const wrapper = document.createElementNS(ns, 'svg');
        wrapper.setAttribute('xmlns', ns);
        wrapper.setAttribute('viewBox', viewBox);
        wrapper.setAttribute('width', String(width));
        wrapper.setAttribute('height', String(height));

        const foreign = document.createElementNS(ns, 'foreignObject');
        foreign.setAttribute('x', '0');
        foreign.setAttribute('y', '0');
        foreign.setAttribute('width', '100%');
        foreign.setAttribute('height', '100%');

        const root = document.createElement('div');
        root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        root.setAttribute('class', 'cml-render-root');
        const bodyStyle = getComputedStyle(document.body);
        for (const prop of ['display', 'align-items', 'justify-content', 'place-items', 'flex-direction', 'background', 'background-color', 'color', 'font-family', 'overflow']) {
          const value = bodyStyle.getPropertyValue(prop);
          if (value) root.style.setProperty(prop, value);
        }
        root.style.width = width + 'px';
        root.style.height = height + 'px';
        root.style.margin = '0';
        root.style.padding = '0';
        root.style.overflow = 'hidden';

        const style = document.createElement('style');
        style.textContent = [
          '.cml-render-root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }',
          '.cml-render-root * { box-sizing: border-box; }',
          _cssText(),
        ].join('\\n');
        root.appendChild(style);

        const content = document.createElement('div');
        content.className = 'cml-render-content';
        content.style.width = '100%';
        content.style.height = '100%';
        content.innerHTML = bodyClone.innerHTML;
        root.appendChild(content);
        foreign.appendChild(root);
        wrapper.appendChild(foreign);
        return wrapper.outerHTML;
      }
      setTimeout(() => {
        parent.postMessage({
          type: 'cml-run-result',
          exitCode: _errors.length > 0 ? 1 : 0,
          stdout: _logs.join('\\n'),
          stderr: _errors.join('\\n'),
          renderedSvg: _renderedSvgSnapshot(),
        }, '*');
      }, 1500);
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

function toDataUrl(html) {
  // base64 encode for a stable data URL the preview iframe can consume
  try {
    return 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(html)));
  } catch {
    return null;
  }
}

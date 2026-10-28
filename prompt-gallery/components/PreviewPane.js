import { html } from 'htm/preact';
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'preact/hooks';
import { injectPreviewConsole, PREVIEW_CONSOLE_MESSAGE } from '../services/previewConsole.js';

let loadCounter = 0;

/**
 * Live preview of the Create response. Its errors and warnings are posted to
 * `onConsoleEntry`; `onConsoleReset` fires whenever a new document loads.
 */
export function PreviewPane({ htmlContent, onConsoleEntry, onConsoleReset }) {
  const [srcdoc, setSrcdoc] = useState(htmlContent);
  const timerRef = useRef(null);
  const frameRef = useRef(null);
  const entryRef = useRef(onConsoleEntry);
  entryRef.current = onConsoleEntry;

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSrcdoc(htmlContent);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [htmlContent]);

  // A new channel per document, so a late message from the previous page is ignored.
  const load = useMemo(() => {
    if (!srcdoc) return null;
    const channel = `pg-preview-${++loadCounter}`;
    return { channel, doc: injectPreviewConsole(srcdoc, channel) };
  }, [srcdoc]);

  // Layout effects run in the same commit that sets srcdoc, so they are in
  // place before the new page can throw anything.
  useLayoutEffect(() => {
    onConsoleReset?.();
  }, [load?.channel]);

  useLayoutEffect(() => {
    if (!load) return undefined;
    const onMessage = (event) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data;
      if (data?.type !== PREVIEW_CONSOLE_MESSAGE || data.channel !== load.channel) return;
      entryRef.current?.(data.entry);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load?.channel]);

  return html`
    <div class="preview-container">
      ${load
      ? html`<iframe
            ref=${frameRef}
            srcdoc=${load.doc}
            sandbox="allow-scripts allow-modals allow-pointer-lock"
            title="Preview"
          />`
      : html`
          <div class="gallery-empty" style=${{ background: 'var(--bg-primary)' }}>
            <i class="fa-solid fa-eye"></i>
            <p>Paste or type HTML in the response editor to see a live preview</p>
          </div>
        `
    }
    </div>
  `;
}

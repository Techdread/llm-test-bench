import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';

export function PreviewPane({ htmlContent }) {
  const [srcdoc, setSrcdoc] = useState(htmlContent);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSrcdoc(htmlContent);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [htmlContent]);

  return html`
    <div class="preview-container">
      ${srcdoc
      ? html`<iframe
            srcdoc=${srcdoc}
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

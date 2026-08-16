import { html } from 'htm/preact';
import { useRef, useEffect } from 'preact/hooks';

export function SvgPreview({ svgContent, size }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (svgContent && svgContent.trim()) {
      containerRef.current.innerHTML = svgContent;
    } else {
      containerRef.current.innerHTML = '';
    }
  }, [svgContent]);

  return html`
    <div class="svg-preview">
      <div class="section-header">
        <span><i class="fa-solid fa-eye"></i> Preview</span>
      </div>
      <div class="svg-preview-container" ref=${containerRef}
        style=${{ width: size ? `${size}px` : '100%', height: size ? `${size}px` : '100%' }}
      >
        ${!svgContent && html`
          <div class="svg-preview-empty">
            <i class="fa-solid fa-image"></i>
            <p>SVG preview will appear here</p>
          </div>
        `}
      </div>
    </div>
  `;
}
